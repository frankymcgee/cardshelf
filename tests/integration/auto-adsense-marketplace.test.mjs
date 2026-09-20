// Disposable production-server HTTP/PostgreSQL checks; never execute Google's
// JavaScript, send an ad request or access live credentials in this test suite.
import test from 'node:test';
import assert from 'node:assert/strict';
import postgres from 'postgres';
import { randomUUID } from 'node:crypto';
import { randomToken,digest,hashPassword } from '../../lib/security.mjs';
import { closeDatabase } from '../../lib/db.mjs';
const base=process.env.TEST_BASE_URL,dbUrl=process.env.DATABASE_URL;
if(process.env.ALLOW_TEST_DATABASE!=='yes'||!base||!new URL(dbUrl||'http://invalid').pathname.endsWith('_test'))throw Error('Use the disposable _test database only.');
const sql=postgres(dbUrl,{max:4}),origin=process.env.APP_ORIGIN||base,suffix=randomUUID().replaceAll('-','');
const password='Synthetic advertisement test password 123',publisher='ca-pub-1234567890123456',slot='1234567890',users=[],listings=[];
async function request(path,{cookie,method='GET',body,headers={}}={}){
  const r=await fetch(base+path,{method,redirect:'manual',headers:{Origin:origin,'X-Requested-With':'cardshelf',...(cookie?{Cookie:cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json'}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
  const text=await r.text();let data;try{data=JSON.parse(text);}catch{data=text;}return {status:r.status,data,headers:r.headers};
}
async function account(kind){
  const id=randomUUID(),email='ad-'+kind+'-'+suffix+'@example.test',token=randomToken();users.push(id);
  await sql`INSERT INTO app_users(id,name,email,password_hash,role) VALUES(${id},${'Ad '+kind},${email},${await hashPassword(password)},${kind==='admin'?'admin':'user'})`;
  await sql`INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(${digest(token)},${id},now()+interval '1 hour')`;
  if(kind==='free'){
    await sql`DELETE FROM account_access_grants WHERE user_id=${id}`;await sql`INSERT INTO free_accounts(user_id) VALUES(${id})`;
    await sql`UPDATE account_memberships SET plan_code='free' WHERE user_id=${id}`;
  }else if(['collector','plus','complimentary'].includes(kind)){
    await sql`DELETE FROM account_access_grants WHERE user_id=${id}`;
    await sql`INSERT INTO account_tier_overrides(user_id,tier,reason) VALUES(${id},${kind},'Synthetic existing access')`;
  }
  return{id,email,cookie:'cardshelf_session='+token};
}
await test('Free-only Auto ads and marketplace display units preserve private data and paid controls',async t=>{
  let oldSettings=[],admin,free,pro,collector,tester,complimentary,settings,printingId;
  const setId='en:ad-'+suffix,cardId=setId+'-1';
  const ad=(cookie,path)=>request('/api/ads/adsense?path='+encodeURIComponent(path),{cookie});
  const form=(extra={})=>({enabled:false,verification_enabled:true,publisher_id:publisher,slot_id:'',auto_ads_enabled:false,
    marketplace_enabled:false,marketplace_slot_id:'',revision:settings?.revision??0,password,reason:'Reviewed synthetic configuration',
    confirm_approval:true,confirm_consent:true,confirm_auto_ads:true,confirm_auto_ads_off:true,confirm_scope:true,...extra});
  async function save(extra){const r=await request('/api/admin/adsense/settings',{cookie:admin.cookie,method:'POST',body:form(extra)});assert.equal(r.status,200,JSON.stringify(r.data));settings=r.data;return r;}
  try{
    oldSettings=await sql`SELECT * FROM adsense_settings`;await sql`DELETE FROM adsense_settings`;
    admin=await account('admin');free=await account('free');pro=await account('plus');collector=await account('collector');tester=await account('tester');complimentary=await account('complimentary');
    await sql`INSERT INTO card_sets(id,provider_id,language,game,name,card_count) VALUES(${setId},${'ad-'+suffix},'en','pokemon','Synthetic ad test set',1)`;
    await sql`INSERT INTO cards(id,provider_id,set_id,language,game,local_id,name) VALUES(${cardId},${'ad-'+suffix+'-1'},${setId},'en','pokemon','1',${'Ad card '+suffix})`;
    const [printing]=await sql`INSERT INTO printings(card_id,key,label,source) VALUES(${cardId},'normal','Normal','tcgdex') RETURNING id`;printingId=printing.id;
    const {default:sharp}=await import('sharp');
    const photo=await sharp({create:{width:4,height:4,channels:3,background:{r:1,g:2,b:3}}}).webp().toBuffer();
    for(let i=0;i<6;i++){
      const id=randomUUID();listings.push(id);
      await sql`INSERT INTO marketplace_listings(id,seller_id,request_id,input_hash,printing_id,seller_alias,condition,price_minor,delivery,postage_minor,region,description,hidden)
        VALUES(${id},${pro.id},${randomUUID()},${digest(id)},${printingId},'Synthetic seller','NM',100,'pickup',0,'Test city','Synthetic listing for ad integration testing',${i===5})`;
      for(const side of ['front','back'])await sql`INSERT INTO marketplace_photos(listing_id,side,data) VALUES(${id},${side},${photo})`;
    }
    await sql`INSERT INTO collection_entries(user_id,printing_id,condition,quantity,notes) VALUES(${free.id},${printingId},'NM',2,'PRIVATE_AD_TEST_NOTE')`;
    const inventory=await sql`SELECT * FROM collection_entries WHERE user_id=${free.id}`;
    const billing=await sql`SELECT * FROM stripe_billing_controls`,sponsor=await sql`SELECT * FROM free_platform_settings`;
    await t.test('new flags start off and the revised database guard is installed',async()=>{
      const r=await request('/api/admin/adsense',{cookie:admin.cookie});assert.equal(r.status,200);settings=r.data;
      assert.equal(settings.enabled,false);assert.equal(settings.auto_ads_enabled,false);assert.equal(settings.marketplace_enabled,false);assert.equal(settings.marketplace_slot_id,'');
      const names=await sql`SELECT conname FROM pg_constraint WHERE conrelid='adsense_settings'::regclass AND contype='c'`;
      assert.ok(names.some(r=>r.conname==='adsense_enabled_modes'));assert.ok(names.some(r=>r.conname==='adsense_marketplace_slot'));
      for(const path of ['/','/app','/marketplace'])assert.deepEqual((await ad(free.cookie,path)).data,{eligible:false});
    });
    await t.test('configuration remains role, password and same-origin protected',async()=>{
      assert.equal((await request('/api/admin/adsense')).status,401);
      assert.equal((await request('/api/admin/adsense/settings',{cookie:free.cookie,method:'POST',body:form()})).status,403);
      assert.equal((await request('/api/admin/adsense/settings',{cookie:admin.cookie,method:'POST',body:form(),headers:{Origin:'https://evil.test'}})).status,403);
      assert.equal((await request('/api/admin/adsense/settings',{cookie:admin.cookie,method:'POST',body:form({password:'incorrect'})})).status,403);
    });
    await t.test('Auto activation without scope/consent is rejected without mutating configuration',async()=>{
      for(const key of ['confirm_auto_ads','confirm_scope','confirm_consent']){
        const r=await request('/api/admin/adsense/settings',{cookie:admin.cookie,method:'POST',body:form({enabled:true,auto_ads_enabled:true,[key]:false})});assert.equal(r.status,400);
      }
      assert.deepEqual((await request('/api/admin/adsense',{cookie:admin.cookie})).data,settings);
    });
    await t.test('Auto-only persists with an empty display slot and without modifying other services',async()=>{
      await save({enabled:true,auto_ads_enabled:true});assert.equal(settings.slot_id,'');assert.equal(settings.auto_ads_enabled,true);
      assert.deepEqual(await sql`SELECT * FROM stripe_billing_controls`,billing);assert.deepEqual(await sql`SELECT * FROM free_platform_settings`,sponsor);
      assert.deepEqual(await sql`SELECT * FROM collection_entries WHERE user_id=${free.id}`,inventory);
    });
    await t.test('Free frontend and workspace responses expose only the public loader contract',async()=>{
      for(const [path,kind] of [['/','marketing'],['/features','marketing'],['/pricing','marketing'],['/app','workspace'],['/cards','workspace'],['/explore','catalogue'],['/marketplace','marketplace']]){
        const r=await ad(free.cookie,path);assert.equal(r.status,200);assert.deepEqual(r.data,{eligible:true,publisher_id:publisher,slot_id:'',auto_ads:true,page_kind:kind,revision:settings.revision});
        assert.match(r.headers.get('cache-control'),/private.*no-store/);assert.match(r.headers.get('vary'),/Cookie/);
      }
    });
    await t.test('guests, paid accounts, administrator, testers and Complimentary never get the loader',async()=>{
      for(const cookie of [undefined,admin.cookie,pro.cookie,collector.cookie,tester.cookie,complimentary.cookie])for(const path of ['/','/app','/marketplace'])assert.deepEqual((await ad(cookie,path)).data,{eligible:false});
    });
    await t.test('private paths, My listings and explicit ad-free views cannot inherit Auto ads',async()=>{
      for(const path of ['/account','/settings','/admin/adsense','/login','/reset-password','/membership','/binders','/battle','/marketplace/inbox',
        '/marketplace/new','/marketplace/moderation','/marketplace/'+listings[0],'/marketplace?mine=1','/marketplace?mine=true',
        '/marketplace?mine=false&mine=true','/cards?ads=off','/cards?card='+cardId,'/privacy','/early-access'])assert.deepEqual((await ad(free.cookie,path)).data,{eligible:false},path);
    });
    await t.test('HTML nonce and cache scope are per Free document, never shared with paid visitors',async()=>{
      for(const path of ['/','/features','/pricing','/app','/cards','/marketplace']){
        const r=await request(path,{cookie:free.cookie});assert.equal(r.status,200,path);assert.match(r.headers.get('content-security-policy'),/nonce-[a-f0-9]{32}/);
        assert.match(r.headers.get('cache-control'),/private.*no-store/);assert.ok(r.data.includes('cardshelf-adsense-revision'));assert.ok(!r.data.includes('PRIVATE_AD_TEST_NOTE'));
        const paid=await request(path,{cookie:pro.cookie});assert.equal(paid.status,200);assert.ok(!paid.data.includes('cardshelf-adsense-revision'));assert.ok(!paid.headers.get('content-security-policy').includes('strict-dynamic'));
      }
    });
    await t.test('private editor and own-listing HTML never receive a Google-capable document',async()=>{
      for(const path of ['/cards?ads=off&card='+encodeURIComponent(cardId),'/marketplace?mine=1','/marketplace/inbox','/account','/battle']){
        const r=await request(path,{cookie:free.cookie});assert.equal(r.status,200,path);assert.ok(!r.data.includes('cardshelf-adsense-revision'));assert.ok(!r.headers.get('content-security-policy').includes('strict-dynamic'));
      }
    });
    await t.test('manual marketplace and catalogue slots coexist without reusing the wrong ID',async()=>{
      await save({enabled:true,auto_ads_enabled:true,slot_id:'9999999999',marketplace_enabled:true,marketplace_slot_id:slot});
      assert.equal((await ad(free.cookie,'/marketplace')).data.slot_id,slot);assert.equal((await ad(free.cookie,'/explore')).data.slot_id,'9999999999');
      assert.equal((await ad(free.cookie,'/app')).data.slot_id,'');
    });
    await t.test('Free marketplace browsing lists sale records only, retaining filtering and counts',async()=>{
      const r=await request('/api/marketplace/listings?mine=false&q='+suffix,{cookie:free.cookie});assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(r.data.total,5);assert.equal(r.data.items.length,5);
      assert.ok(r.data.items.every(item=>!item.hidden && item.id!==listings[5]));assert.ok(!JSON.stringify(r.data).includes('PRIVATE_AD_TEST_NOTE'));assert.ok(!JSON.stringify(r.data).includes(pro.email));
      assert.equal((await request('/api/marketplace/listings?mine=false')).status,401);
      const empty=await request('/api/marketplace/listings?mine=true',{cookie:free.cookie});assert.equal(empty.status,200);assert.equal(empty.data.items.length,0);
    });
    await t.test('Free viewing does not grant paid selling, enquiry or ownership-write permissions',async()=>{
      const r=await request('/api/marketplace/access',{cookie:free.cookie});assert.equal(r.status,200);assert.equal(r.data.can_browse,true);assert.equal(r.data.can_enquire,false);assert.equal(r.data.can_sell,false);
      const detail=await request('/api/marketplace/listings/'+listings[0],{cookie:free.cookie});assert.equal(detail.status,200);assert.equal(detail.data.can_enquire,false);
      const visiblePhoto=await request(detail.data.photos[0].url,{cookie:free.cookie});assert.equal(visiblePhoto.status,200);assert.match(visiblePhoto.headers.get('content-type'),/^image\/webp/);
      for(const path of ['/api/marketplace/listings','/api/marketplace/listings/'+listings[0]+'/enquiries'])assert.equal((await request(path,{cookie:free.cookie,method:'POST',body:{}})).status,403);
      assert.equal((await request('/api/collection',{cookie:free.cookie,method:'PUT',body:{}})).status,403);
      const paid=await request('/api/marketplace/access',{cookie:collector.cookie});assert.equal(paid.status,200);assert.equal(paid.data.can_enquire,true);
    });
    await t.test('hidden seller listings remain inaccessible to a Free browser',async()=>{
      assert.equal((await request('/api/marketplace/listings/'+listings[5],{cookie:free.cookie})).status,404);
      // Read the real API-issued image URL; a guessed route or missing fixture
      // must not produce a false-positive privacy assertion.
      const seller=await request('/api/marketplace/listings/'+listings[5],{cookie:pro.cookie});assert.equal(seller.status,200);
      const hiddenPhoto=seller.data.photos[0].url;assert.equal((await request(hiddenPhoto,{cookie:pro.cookie})).status,200);
      assert.equal((await request(hiddenPhoto,{cookie:free.cookie})).status,404);
    });
    await t.test('paid upgrades and invalidated sessions immediately stop new placements',async()=>{
      await sql`INSERT INTO account_tier_overrides(user_id,tier,reason) VALUES(${free.id},'plus','Synthetic paid upgrade')`;
      assert.deepEqual((await ad(free.cookie,'/marketplace')).data,{eligible:false});await sql`DELETE FROM account_tier_overrides WHERE user_id=${free.id}`;
      const token=randomToken();await sql`INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(${digest(token)},${free.id},now()+interval '1 hour')`;
      assert.equal((await ad('cardshelf_session='+token,'/')).data.eligible,true);await sql`DELETE FROM sessions WHERE token_hash=${digest(token)}`;
      assert.deepEqual((await ad('cardshelf_session='+token,'/')).data,{eligible:false});
    });
    await t.test('pending billing suppresses ads even when a Free marker remains',async()=>{
      const [old]=await sql`SELECT environment FROM stripe_connections WHERE environment='sandbox'`;
      let offerId,subscriptionId;
      try{
        if(!old)await sql`INSERT INTO stripe_connections(environment,account_id,api_secret,webhook_secret) VALUES('sandbox','acct_synthetic_ads','not-a-real-credential','not-a-real-credential')`;
        const [offer]=await sql`INSERT INTO stripe_offers(environment,price_id,plan_code,cadence,amount_minor,total_minor,tax_minor,terms,terms_hash)
          VALUES('sandbox',${'price_ads_'+suffix},'collector','MONTHLY',100,100,0,'Synthetic test terms only',${digest(suffix)}) RETURNING id`;offerId=offer.id;
        const [sub]=await sql`INSERT INTO stripe_subscriptions(user_id,environment,request_id,offer_id,offer_snapshot,checkout_expires_at,next_sync_at)
          VALUES(${free.id},'sandbox',${randomUUID()},${offerId},'{}'::jsonb,now()+interval '1 hour',now()+interval '1 day') RETURNING id`;subscriptionId=sub.id;
        assert.deepEqual((await ad(free.cookie,'/marketplace')).data,{eligible:false});
      }finally{
        if(subscriptionId)await sql`DELETE FROM stripe_subscriptions WHERE id=${subscriptionId}`;
        if(offerId)await sql`DELETE FROM stripe_offers WHERE id=${offerId}`;
        if(!old)await sql`DELETE FROM stripe_connections WHERE environment='sandbox'`;
      }
    });
    await t.test('conflicting administrative changes cannot silently overwrite enabled modes',async()=>{
      const stale=await request('/api/admin/adsense/settings',{cookie:admin.cookie,method:'POST',body:form({revision:0})});assert.equal(stale.status,409);
      const results=await Promise.all([0,1].map(()=>request('/api/admin/adsense/settings',{cookie:admin.cookie,method:'POST',body:form({enabled:false})})));
      assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);settings=results.find(r=>r.status===200).data;
    });
    await t.test('master pause retains verification, data and all account access',async()=>{
      for(const path of ['/','/app','/marketplace','/explore'])assert.deepEqual((await ad(free.cookie,path)).data,{eligible:false});
      assert.equal((await request('/ads.txt')).data,'google.com, pub-1234567890123456, DIRECT, f08c47fec0942fa0\n');
      assert.deepEqual(await sql`SELECT * FROM collection_entries WHERE user_id=${free.id}`,inventory);
      assert.deepEqual(await sql`SELECT * FROM stripe_billing_controls`,billing);assert.deepEqual(await sql`SELECT * FROM free_platform_settings`,sponsor);
      assert.equal((await request('/api/session',{cookie:free.cookie})).data.user.id,free.id);
    });
  }finally{
    await sql`DELETE FROM adsense_settings`;if(oldSettings.length)await sql`INSERT INTO adsense_settings ${sql(oldSettings)}`;
    if(listings.length)await sql`DELETE FROM marketplace_listings WHERE id IN ${sql(listings)}`;
    if(users.length)await sql`DELETE FROM app_users WHERE id IN ${sql(users)}`;
    if(printingId)await sql`DELETE FROM printings WHERE id=${printingId}`;
    await sql`DELETE FROM cards WHERE id=${cardId}`;await sql`DELETE FROM card_sets WHERE id=${setId}`;
    await closeDatabase();await sql.end();
  }
});
