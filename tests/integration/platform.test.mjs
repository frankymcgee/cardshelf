// Run after api.test.mjs against the disposable CI database only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { hashPassword,randomToken,digest } from '../../lib/security.mjs';
const url=process.env.TEST_BASE_URL,dbUrl=process.env.DATABASE_URL;
if(process.env.ALLOW_TEST_DATABASE!=='yes'||!url||!new URL(dbUrl||'http://invalid').pathname.endsWith('_test'))throw new Error('Use the disposable _test database only.');
const sql=postgres(dbUrl,{max:3}),origin=process.env.APP_ORIGIN||url;
async function request(path,{method='GET',body,cookie,headers={}}={}){
 const r=await fetch(url+path,{method,redirect:'manual',headers:{Origin:origin,'X-Requested-With':'cardshelf',...(body!==undefined?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{}),...headers},body:body!==undefined?JSON.stringify(body):undefined});
 const text=await r.text();let data;try{data=JSON.parse(text)}catch{data=text}return {status:r.status,data,headers:r.headers};
}
await test('public site and subscription preparation',async t=>{
 const id=randomUUID(),adminId=randomUUID(),token=randomToken(),adminToken=randomToken();
 try{
  const hash=await hashPassword('Testing password for platform 123');
  await sql`INSERT INTO app_users(id,email,name,password_hash) VALUES(${id},${'platform-'+id+'@example.test'},'Platform tester',${hash})`;
  await sql`INSERT INTO app_users(id,email,name,password_hash,role) VALUES(${adminId},${'admin-'+adminId+'@example.test'},'Platform admin',${hash},'admin')`;
  await sql`INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(${digest(token)},${id},now()+interval '1 hour'),(${digest(adminToken)},${adminId},now()+interval '1 hour')`;
  const cookie='cardshelf_session='+token,adminCookie='cardshelf_session='+adminToken;
  await t.test('migration backfills older users without changing their credentials or sessions',async()=>{
   const schema='migration_'+randomUUID().replaceAll('-','');
   await sql.begin(async tx=>{
    await tx.unsafe(`CREATE SCHEMA "${schema}"`);await tx.unsafe(`SET LOCAL search_path TO "${schema}", public`);
    await tx.unsafe('CREATE TABLE app_users(id uuid PRIMARY KEY,email text,password_hash text)');
    await tx.unsafe('CREATE TABLE sessions(token text,user_id uuid)');
    const legacy=randomUUID();await tx`INSERT INTO app_users VALUES(${legacy},'legacy@example.test','untouched-hash')`;
    await tx`INSERT INTO sessions VALUES('untouched-session',${legacy})`;
    await tx.unsafe(await readFile(new URL('../../migrations/004_public_platform.sql',import.meta.url),'utf8'));
    const [g]=await tx`SELECT * FROM account_access_grants WHERE user_id=${legacy}`;
    assert.equal(g.kind,'legacy_tester');assert.equal(g.expires_at,null);
    assert.equal((await tx`SELECT password_hash FROM app_users`)[0].password_hash,'untouched-hash');
    assert.equal((await tx`SELECT token FROM sessions`)[0].token,'untouched-session');
    const newUser=randomUUID();await tx`INSERT INTO app_users VALUES(${newUser},'new@example.test','new-hash')`;
    assert.equal((await tx`SELECT kind FROM account_access_grants WHERE user_id=${newUser}`)[0].kind,'beta_tester');
    await tx.unsafe('SET LOCAL search_path TO public');await tx.unsafe(`DROP SCHEMA "${schema}" CASCADE`);
   });
  });
  await t.test('every public page is server-rendered without login',async()=>{
   for(const [path,title] of [['/','One beautiful home.'],['/features','Everything in its place.'],['/pokemon-arena','Your seat at the table.'],['/pricing','Your level of detail.'],['/early-access','Let’s make an introduction.'],['/privacy','Accounts and collections']]){
    const r=await request(path);assert.equal(r.status,200,path);assert.ok(r.data.includes(title),path+' server HTML');assert.match(r.headers.get('x-robots-tag'),/index, follow/);assert.ok(!r.data.includes('Platform tester'));assert.ok(!r.data.includes('untouched-session'));
   }
  });
  await t.test('public plan comparison preserves free testing access',async()=>{
   const r=await request('/pricing');assert.equal(r.status,200);
   // Scoped Vue styles add data-v-* attributes. Assert heading content, not compiler output.
   assert.match(r.data,/<h2\b[^>]*>\s*Collector\s*<\/h2>/);
   assert.match(r.data,/<h2\b[^>]*>\s*Collector Plus\s*<\/h2>/);
   assert.match(r.data,/no payment required\./i);
   assert.ok(r.data.includes('New subscription checkout is paused. Existing renewals are not cancelled.'));
   assert.ok(r.data.includes('Already testing? Keep everything.'));
   // Verify the underlying default policy too: marketing copy alone is not a billing guard.
   const offers=await request('/api/public/subscription-offers');
   assert.equal(offers.status,200);assert.match(offers.headers.get('content-type'),/json/);
   assert.equal(offers.data.enabled,false);assert.deepEqual(offers.data.offers,[]);
  });
  await t.test('public SSR never includes an authenticated account identity',async()=>{const r=await request('/',{cookie});assert.ok(!r.data.includes('platform-'+id));assert.ok(!r.data.includes('Platform tester'))});
  await t.test('sitemap includes public pages only',async()=>{const r=await request('/sitemap.xml');assert.equal(r.status,200);assert.match(r.data,/<loc>https?:\/\//);for(const path of ['/binders','/account','/api/','/shared/','/marketplace'])assert.ok(!r.data.includes(path));assert.match((await request('/robots.txt')).data,/Disallow: \/api\//)});
  await t.test('private page shell and APIs remain non-indexable and protected',async()=>{assert.match((await request('/app')).headers.get('x-robots-tag'),/noindex/);assert.equal((await request('/api/account/membership')).status,401);assert.equal((await request('/api/admin/platform')).status,401);assert.equal((await request('/api/admin/platform/plans')).status,401);assert.equal((await request('/api/dashboard')).status,401)});
  await t.test('newly created testers have non-expiring access with all current features',async()=>{
   const r=await request('/api/account/membership',{cookie});assert.equal(r.status,200);
   assert.equal(r.data.grant.kind,'beta_tester');assert.equal(r.data.access.expires_at,null);
   assert.equal(r.data.access.allowed,true);assert.equal(r.data.access.payment_required,false);
   assert.equal(r.data.access.billing_enabled,false);assert.equal(r.data.access.enforcement_enabled,false);
   // Independently enumerate expected capabilities so accidentally lost access fails.
   const expected=['tracking_binders','collection','binders','series','prices','condition','sharing','printing','exports','marketplace_browse','marketplace_sell'];
   assert.deepEqual(r.data.access.features.map(feature=>feature.code).sort(),expected.sort());
  });
  await t.test('membership status does not introduce a billing restriction',async()=>{await sql`UPDATE account_memberships SET subscription_status='past_due' WHERE user_id=${id}`;const r=await request('/api/account/membership',{cookie});assert.equal(r.data.access.allowed,true);assert.equal((await request('/api/dashboard',{cookie})).status,200)});
  await t.test('visitors can request access but do not get an account',async()=>{
   const email='request-'+id+'@example.test',body={name:'Future tester',email,message:'Please invite me.',consent:true,purpose:'early_access',role:'admin',plan:'plus'};
   const a=await request('/api/public/access-requests',{method:'POST',body});const b=await request('/api/public/access-requests',{method:'POST',body});assert.equal(a.status,200);assert.deepEqual(a.data,b.data);
   assert.equal((await sql`SELECT * FROM platform_requests WHERE email=${email}`).length,1);assert.equal((await sql`SELECT id FROM app_users WHERE email=${email}`).length,0);
  });
  await t.test('public forms retain origin checks and bounded JSON bodies',async()=>{assert.equal((await request('/api/public/access-requests',{method:'POST',body:{},headers:{Origin:'https://evil.test'}})).status,403);assert.equal((await request('/api/public/access-requests',{method:'POST',body:{message:'x'.repeat(17000)}})).status,413)});
  await t.test('the public form honeypot does not store a contact',async()=>{const email='bot-'+id+'@example.test';const r=await request('/api/public/access-requests',{method:'POST',body:{website:'spam',email}});assert.equal(r.status,200);assert.equal((await sql`SELECT id FROM platform_requests WHERE email=${email}`).length,0)});
  await t.test('collectors cannot read requests or edit plans',async()=>{assert.equal((await request('/api/admin/platform',{cookie})).status,403);assert.equal((await request('/api/admin/platform/plans',{cookie})).status,403);assert.equal((await request('/api/admin/platform/plans/collector',{method:'PUT',cookie,body:{name:'x',revision:1}})).status,403)});
  await t.test('administrators can edit only unpublished draft pricing',async()=>{
   const plans=await request('/api/admin/platform/plans',{cookie:adminCookie});assert.equal(plans.status,200);assert.ok(plans.data.some(p=>p.code==='free'));assert.ok(!JSON.stringify(plans.data).includes('password_hash'));
   const inbox=await request('/api/admin/platform?view=requests',{cookie:adminCookie});assert.equal(inbox.status,200);assert.equal(inbox.data.members,undefined);assert.equal(inbox.data.plans,undefined);assert.ok(Array.isArray(inbox.data.requests));
   const overview=await request('/api/admin/platform',{cookie:adminCookie});assert.equal(overview.status,200);assert.equal(overview.data.billing_enabled,false);
   const plan=overview.data.plans.find(p=>p.code==='collector');const body={name:'Future collector',description:'Planning only',monthly_price_minor:1299,annual_price_minor:null,revision:plan.revision};
   assert.equal((await request('/api/admin/platform/plans/collector',{method:'PUT',cookie:adminCookie,body})).status,200);
   assert.equal((await request('/api/admin/platform/plans/collector',{method:'PUT',cookie:adminCookie,body})).status,409);
   assert.equal((await request('/api/admin/platform/plans/testing',{method:'PUT',cookie:adminCookie,body})).status,400);
   assert.equal((await request('/api/account/membership',{cookie})).data.access.payment_required,false);
   assert.ok(!(await request('/pricing')).data.includes('12.99'));
  });
  await t.test('request status and deletion do not change tester accounts',async()=>{
   const [r]=await sql`SELECT id,revision FROM platform_requests WHERE email=${'request-'+id+'@example.test'}`;
   assert.equal((await request('/api/admin/platform/requests/'+r.id,{method:'PATCH',cookie:adminCookie,body:{status:'contacted',revision:r.revision}})).status,200);
   assert.equal((await request('/api/admin/platform/requests/'+r.id,{method:'DELETE',cookie:adminCookie,body:{revision:r.revision+1}})).status,200);
   assert.equal((await request('/api/session',{cookie})).data.user.id,id);
  });
 }finally{await sql`DELETE FROM app_users WHERE id IN (${id},${adminId})`;await sql.end()}
});
