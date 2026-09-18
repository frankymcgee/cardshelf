// Disposable database / production-server integration tests. No real email or
// advertising requests: the internal mail worker receives a recording sender.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { hashPassword,verifyPassword,randomToken,digest } from '../../lib/security.mjs';
import { closeDatabase } from '../../lib/db.mjs';
import { processRecoveryMail } from '../../lib/password-recovery.mjs';
import { RECOVERY_MESSAGE } from '../../shared/password-recovery.mjs';
const base=process.env.TEST_BASE_URL,dbUrl=process.env.DATABASE_URL;
if(process.env.ALLOW_TEST_DATABASE!=='yes'||!base||!new URL(dbUrl||'http://invalid').pathname.endsWith('_test')||process.env.RECOVERY_EMAIL_ENABLED==='true')throw Error('Use a disposable _test database with real recovery email disabled.');
const sql=postgres(dbUrl,{max:4}),origin=process.env.APP_ORIGIN||base;
async function request(path,{cookie,method='GET',body,headers={}}={}) {
  const r=await fetch(base+path,{method,redirect:'manual',headers:{Origin:origin,'X-Requested-With':'cardshelf',...(cookie?{Cookie:cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json'}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
  const text=await r.text();let data;try{data=JSON.parse(text);}catch{data=text;}
  return {status:r.status,data,headers:r.headers,cookie:r.headers.get('set-cookie')?.split(';')[0]};
}
const oldPassword='Original synthetic password 123',newPassword='New synthetic password 456',suffix=randomUUID().replaceAll('-','');
let users=[];
async function account(kind){
  const id=randomUUID(),email=kind+'-'+suffix+'@example.test',token=randomToken();users.push(id);
  await sql`INSERT INTO app_users(id,name,email,password_hash,role) VALUES(${id},${kind},${email},${await hashPassword(oldPassword)},${kind==='admin'?'admin':'user'})`;
  await sql`INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(${digest(token)},${id},now()+interval '1 hour')`;
  if(kind==='free'){
    await sql`DELETE FROM account_access_grants WHERE user_id=${id}`;
    await sql`INSERT INTO free_accounts(user_id) VALUES(${id})`;
    await sql`UPDATE account_memberships SET plan_code='free' WHERE user_id=${id}`;
  }
  if(['collector','plus','complimentary'].includes(kind)){
    await sql`DELETE FROM account_access_grants WHERE user_id=${id}`;
    await sql`INSERT INTO account_tier_overrides(user_id,tier,reason) VALUES(${id},${kind},'Synthetic test assignment')`;
  }
  return {id,email,cookie:'cardshelf_session='+token};
}
function secret(url){return new URLSearchParams(new URL(url).hash.slice(1)).get('token');}
await test('password recovery and Free-only AdSense on an isolated installation',async t=>{
  let oldAdSettings=[];const messages=[];
  try {
    oldAdSettings=await sql`SELECT * FROM adsense_settings`;await sql`DELETE FROM adsense_settings`;
    const admin=await account('admin'),free=await account('free'),tester=await account('tester'),collector=await account('collector'),pro=await account('plus'),complimentary=await account('complimentary');
    const adminBody=(target,extra={})=>({user_id:target.id,delivery:'link',confirm_identity:true,reason:'Verified synthetic account holder',password:oldPassword,...extra});
    const link=async(target,extra={})=>{const r=await request('/api/admin/password-recovery/request',{method:'POST',cookie:admin.cookie,body:adminBody(target,extra)});assert.equal(r.status,200,JSON.stringify(r.data));return r.data;};
    const consume=(token,password=newPassword,extra={})=>request('/api/public/password-recovery/complete',{method:'POST',body:{token,password,confirm_password:password,...extra}});
    const deliver=()=>processRecoveryMail({sql,origin,send:async(address,message)=>{messages.push({address,...message});}});
    let firstLink;
    await t.test('recovery pages are unauthenticated, non-indexable and no-store, without Google code',async()=>{
      for(const path of ['/forgot-password','/reset-password']){
        const r=await request(path);assert.equal(r.status,200);assert.match(r.headers.get('x-robots-tag'),/noindex/);assert.match(r.headers.get('cache-control'),/no-store/);
        assert.equal(r.headers.get('referrer-policy'),'no-referrer');assert.ok(!r.data.includes('cardshelf-adsense-revision'));
      }
      const sitemap=await request('/sitemap.xml');assert.ok(!sitemap.data.includes('/forgot-password'));assert.ok(!sitemap.data.includes('/reset-password'));
    });
    await t.test('admin routes require session, role, current password and same-origin mutations',async()=>{
      assert.equal((await request('/api/admin/password-recovery')).status,401);
      assert.equal((await request('/api/admin/password-recovery',{cookie:free.cookie})).status,403);
      assert.equal((await request('/api/admin/password-recovery/request',{method:'POST',cookie:admin.cookie,body:adminBody(free,{password:'incorrect'})})).status,403);
      assert.equal((await request('/api/admin/password-recovery/request',{method:'POST',cookie:admin.cookie,headers:{Origin:'https://evil.test'},body:adminBody(free)})).status,403);
      assert.equal((await request('/api/admin/password-recovery/request',{method:'POST',cookie:admin.cookie,body:adminBody(free,{confirm_identity:false})})).status,400);
    });
    await t.test('assisted link stores only a hash and changes neither password nor existing sessions',async()=>{
      const before=(await sql`SELECT password_hash FROM app_users WHERE id=${free.id}`)[0].password_hash;
      firstLink=await link(free);const token=secret(firstLink.url);assert.match(token,/^[a-f0-9]{64}$/);assert.equal(new URL(firstLink.url).origin,origin);
      const [stored]=await sql`SELECT * FROM password_recovery_tokens WHERE token_hash=${digest(token)}`;assert.equal(stored.user_id,free.id);assert.equal(stored.password_fingerprint,digest(before));
      assert.ok(!JSON.stringify(stored).includes(token));assert.ok(!JSON.stringify(stored).includes(before));
      assert.equal((await sql`SELECT password_hash FROM app_users WHERE id=${free.id}`)[0].password_hash,before);
      assert.equal((await request('/api/session',{cookie:free.cookie})).data.user.id,free.id);
      const audits=await sql`SELECT detail FROM audit_log WHERE user_id=${admin.id} AND action='auth.recovery_requested'`;
      assert.ok(!JSON.stringify(audits).includes(token));assert.ok(!JSON.stringify(audits).includes(oldPassword));
      assert.match(firstLink.message,/Shown once/);assert.ok(Date.parse(firstLink.expires_at)>Date.now());
    });
    await t.test('GET/page previews never consume the bearer link',async()=>{
      const token=secret(firstLink.url);assert.equal((await request('/reset-password')).status,200);
      await request('/api/public/password-recovery/complete'); // Unsupported verb cannot redeem.
      assert.equal((await sql`SELECT token_hash FROM password_recovery_tokens WHERE token_hash=${digest(token)}`).length,1);
    });
    await t.test('known and unknown mailboxes return identical responses without touching accounts',async()=>{
      const [before]=await sql`SELECT password_hash FROM app_users WHERE id=${tester.id}`;
      const unknown='unknown-'+suffix+'@example.test';
      const responses=[];
      for(const email of [tester.email,unknown])responses.push(await request('/api/public/password-recovery/request',{method:'POST',body:{email}}));
      for(const r of responses){assert.equal(r.status,200);assert.deepEqual(r.data,{message:RECOVERY_MESSAGE});assert.match(r.headers.get('cache-control'),/no-store/);}
      assert.equal((await sql`SELECT password_hash FROM app_users WHERE id=${tester.id}`)[0].password_hash,before.password_hash);
      assert.equal((await sql`SELECT * FROM password_recovery_tokens WHERE user_id=${tester.id}`).length,0);
      assert.equal((await sql`SELECT * FROM password_recovery_mail WHERE email IN ${sql([tester.email,unknown])}`).length,2);
      assert.equal(await deliver(),true);assert.equal(await deliver(),true);assert.equal(messages.length,1);assert.equal(messages[0].address,tester.email);
      const sentToken=secret(messages[0].text.match(/https?:\/\/\S+\/reset-password#token=[a-f0-9]{64}/)[0]);
      assert.equal((await sql`SELECT * FROM password_recovery_tokens WHERE token_hash=${digest(sentToken)}`).length,1);
      assert.equal((await sql`SELECT status FROM password_recovery_mail WHERE email=${unknown}`)[0].status,'ignored');
    });
    await t.test('redemption invalidates every session, sibling link and pending request, without changing Free membership',async()=>{
      const more=await link(free),secondToken=randomToken();
      await sql`INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(${digest(secondToken)},${free.id},now()+interval '1 hour')`;
      await request('/api/public/password-recovery/request',{method:'POST',body:{email:free.email}});
      const before=await sql`SELECT * FROM account_memberships WHERE user_id=${free.id}`;
      const r=await consume(secret(firstLink.url));assert.equal(r.status,200,JSON.stringify(r.data));assert.match(r.headers.get('set-cookie'),/Max-Age=0/i);
      assert.equal((await sql`SELECT * FROM sessions WHERE user_id=${free.id}`).length,0);
      assert.equal((await sql`SELECT * FROM password_recovery_tokens WHERE user_id=${free.id}`).length,0);
      assert.equal((await sql`SELECT * FROM password_recovery_mail WHERE email=${free.email} AND kind='reset'`).length,0);
      assert.deepEqual(await sql`SELECT * FROM account_memberships WHERE user_id=${free.id}`,before);
      assert.equal((await sql`SELECT * FROM account_access_grants WHERE user_id=${free.id}`).length,0);
      assert.equal((await consume(secret(more.url))).status,400);assert.equal((await consume(secret(firstLink.url))).status,400);
      assert.equal((await request('/api/session',{cookie:free.cookie})).data.user,null);
      const record=(await sql`SELECT password_hash FROM app_users WHERE id=${free.id}`)[0];assert.equal(await verifyPassword(newPassword,record.password_hash),true);assert.equal(await verifyPassword(oldPassword,record.password_hash),false);
      const login=await request('/api/login',{method:'POST',body:{email:free.email,password:newPassword}});assert.equal(login.status,200);free.cookie=login.cookie;
      await deliver();const notification=messages.find(m=>m.address===free.email);assert.match(notification.subject,/was changed/);assert.ok(!notification.text.includes(newPassword));
    });
    await t.test('expired, malformed, mismatched and identity-injecting requests cannot change a password',async()=>{
      const issued=await link(tester),token=secret(issued.url),[before]=await sql`SELECT password_hash FROM app_users WHERE id=${tester.id}`;
      await sql`UPDATE password_recovery_tokens SET expires_at=now()-interval '1 second' WHERE token_hash=${digest(token)}`;
      assert.equal((await consume(token)).status,400);assert.equal((await consume('invalid')).status,400);
      assert.equal((await consume(token,newPassword,{user_id:free.id})).status,400);
      assert.equal((await consume(token,newPassword,{confirm_password:'different'})).status,400);
      assert.equal((await sql`SELECT password_hash FROM app_users WHERE id=${tester.id}`)[0].password_hash,before.password_hash);
    });
    await t.test('simultaneous use of a valid link succeeds once, not two competing password changes',async()=>{
      const issued=await link(tester),token=secret(issued.url);
      const results=await Promise.all([consume(token,newPassword),consume(token,'Another synthetic password 789')]);
      assert.deepEqual(results.map(r=>r.status).sort(),[200,400]);
      assert.equal((await sql`SELECT * FROM password_recovery_tokens WHERE user_id=${tester.id}`).length,0);
      assert.equal((await sql`SELECT * FROM account_access_grants WHERE user_id=${tester.id}`)[0].kind,'beta_tester');
      await deliver();
    });
    await t.test('normal authenticated password changes revoke previously issued recovery links',async()=>{
      const issued=await link(pro),token=secret(issued.url);
      const r=await request('/api/password',{method:'POST',cookie:pro.cookie,body:{current_password:oldPassword,password:newPassword}});
      assert.equal(r.status,200,JSON.stringify(r.data));pro.cookie=r.cookie;
      assert.equal((await consume(token)).status,400);assert.equal((await sql`SELECT * FROM password_recovery_tokens WHERE user_id=${pro.id}`).length,0);
    });
    await t.test('failed SMTP delivery never stores the outgoing token or provider error and retries are bounded',async()=>{
      await request('/api/public/password-recovery/request',{method:'POST',body:{email:collector.email}});
      const before=(await sql`SELECT password_hash FROM app_users WHERE id=${collector.id}`)[0].password_hash;
      for(let n=1;n<=3;n++){
        const ran=await processRecoveryMail({sql,origin,send:async()=>{throw Error('SMTP password=do-not-store token=do-not-store');}});assert.equal(ran,true);
        const [job]=await sql`SELECT * FROM password_recovery_mail WHERE email=${collector.email} AND kind='reset'`;assert.equal(job.attempts,n);assert.equal(job.last_error,'SMTP_DELIVERY_FAILED');assert.ok(!JSON.stringify(job).includes('do-not-store'));
        assert.equal((await sql`SELECT * FROM password_recovery_tokens WHERE user_id=${collector.id}`).length,0);
        if(n<3)await sql`UPDATE password_recovery_mail SET available_at=now() WHERE id=${job.id}`;else assert.equal(job.status,'failed');
      }
      assert.equal((await sql`SELECT password_hash FROM app_users WHERE id=${collector.id}`)[0].password_hash,before);
    });
    await t.test('administrative search exposes only account identifiers, not hashes, sessions or tokens',async()=>{
      const r=await request('/api/admin/password-recovery?q='+suffix,{cookie:admin.cookie});assert.equal(r.status,200);assert.equal(r.data.users.length,users.length);assert.equal(r.data.mail.configured,false);
      for(const u of r.data.users)assert.deepEqual(Object.keys(u).sort(),['email','id','name','role']);
      assert.equal((await request('/api/admin/password-recovery/request',{method:'POST',cookie:admin.cookie,body:adminBody(free,{delivery:'email'})})).status,503);
    });
    let settings;
    const pub='ca-pub-1234567890123456',slot='1234567890';
    const adBody=(extra={})=>({enabled:false,verification_enabled:false,publisher_id:pub,slot_id:slot,revision:settings?.revision??0,password:oldPassword,reason:'Synthetic AdSense test',confirm_approval:true,confirm_consent:true,confirm_auto_ads_off:true,...extra});
    async function save(extra){const r=await request('/api/admin/adsense/settings',{method:'POST',cookie:admin.cookie,body:adBody(extra)});assert.equal(r.status,200,JSON.stringify(r.data));settings=r.data;return r;}
    const ad=(cookie,path='/explore')=>request('/api/ads/adsense?path='+encodeURIComponent(path),{cookie});
    await t.test('AdSense starts disabled and an authenticated Free account receives no publisher loader details',async()=>{
      assert.equal((await request('/api/admin/adsense')).status,401);assert.equal((await request('/api/admin/adsense',{cookie:free.cookie})).status,403);
      settings=(await request('/api/admin/adsense',{cookie:admin.cookie})).data;assert.equal(settings.enabled,false);assert.equal(settings.verification_enabled,false);
      assert.deepEqual((await ad(free.cookie)).data,{eligible:false});assert.equal((await request('/ads.txt')).data,'');
    });
    await t.test('AdSense cannot bypass administrator reauthentication, origin checks or explicit acknowledgements',async()=>{
      assert.equal((await request('/api/admin/adsense/settings',{method:'POST',cookie:admin.cookie,body:adBody({password:'incorrect'})})).status,403);
      assert.equal((await request('/api/admin/adsense/settings',{method:'POST',cookie:admin.cookie,headers:{Origin:'https://evil.test'},body:adBody()})).status,403);
      for(const field of ['confirm_approval','confirm_consent','confirm_auto_ads_off']){
        assert.equal((await request('/api/admin/adsense/settings',{method:'POST',cookie:admin.cookie,body:adBody({enabled:true,[field]:false})})).status,400);
      }
      assert.deepEqual((await request('/api/admin/adsense',{cookie:admin.cookie})).data,settings);
    });
    await t.test('site verification publishes only an inert public identifier and this hostname seller entry',async()=>{
      await save({verification_enabled:true});
      const r=await request('/');assert.match(r.data,new RegExp('<meta name="google-adsense-account" content="'+pub+'">'));
      assert.ok(!r.data.includes('cardshelf-adsense-revision'));assert.ok(!/<script[^>]+src=["']https:\/\/pagead2\./i.test(r.data));
      assert.equal((await request('/ads.txt')).data,'google.com, pub-1234567890123456, DIRECT, f08c47fec0942fa0\n');
      assert.deepEqual((await ad(free.cookie)).data,{eligible:false});
    });
    await t.test('an enabled manual unit is returned only for the effective Free tier on allowed catalogue pages',async()=>{
      const protectedSettings=await sql`SELECT * FROM stripe_billing_controls`,sponsorSettings=await sql`SELECT * FROM free_platform_settings`;
      await save({enabled:true,verification_enabled:true});
      const r=await ad(free.cookie);assert.equal(r.status,200);assert.deepEqual(r.data,{eligible:true,publisher_id:pub,slot_id:slot,revision:settings.revision});assert.match(r.headers.get('cache-control'),/no-store/);
      for(const cookie of [undefined,admin.cookie,collector.cookie,pro.cookie,complimentary.cookie])assert.deepEqual((await ad(cookie)).data,{eligible:false});
      // Tester sessions were revoked by recovery: a new tester session is still ad-free.
      const tk=randomToken();await sql`INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(${digest(tk)},${tester.id},now()+interval '1 hour')`;
      assert.deepEqual((await ad('cardshelf_session='+tk)).data,{eligible:false});
      for(const path of ['/app','/cards','/binders/abc','/account','/login','/reset-password','/membership','/admin/passwords','/marketplace/inbox'])assert.deepEqual((await ad(free.cookie,path)).data,{eligible:false});
      assert.deepEqual(await sql`SELECT * FROM stripe_billing_controls`,protectedSettings);assert.deepEqual(await sql`SELECT * FROM free_platform_settings`,sponsorSettings);
    });
    await t.test('only an eligible catalogue document has a per-request CSP nonce; private pages retain their policy',async()=>{
      const a=await request('/explore',{cookie:free.cookie}),b=await request('/explore',{cookie:free.cookie});
      for(const r of [a,b]){
        assert.equal(r.status,200);assert.match(r.headers.get('cache-control'),/private.*no-store/);assert.match(r.headers.get('vary'),/Cookie/i);
        const nonce=r.headers.get('content-security-policy').match(/'nonce-([a-f0-9]{32})'/)?.[1];assert.ok(nonce);assert.ok(r.data.includes('cardshelf-adsense-revision'));assert.ok(r.headers.get('content-security-policy').includes("'nonce-"+nonce+"'"));
        assert.match(r.headers.get('content-security-policy'),/strict-dynamic/);
        for(const tag of r.data.match(/<script\b[^>]*>/gi)||[])assert.ok(tag.includes('nonce="'+nonce+'"'),tag);
        assert.ok(!r.data.includes(free.email));
      }
      assert.notEqual(a.headers.get('content-security-policy'),b.headers.get('content-security-policy'));
      for(const cookie of [undefined,admin.cookie,collector.cookie,pro.cookie]){const r=await request('/explore',{cookie});assert.ok(!r.data.includes('cardshelf-adsense-revision'));assert.ok(!(r.headers.get('content-security-policy')||'').includes('strict-dynamic'));}
      for(const path of ['/account','/reset-password','/membership','/admin/passwords']){const r=await request(path,{cookie:free.cookie});assert.ok(!r.data.includes('cardshelf-adsense-revision'));assert.ok(!(r.headers.get('content-security-policy')||'').includes('strict-dynamic'));}
    });
    await t.test('paid or Complimentary overrides immediately stop future Free ad eligibility responses',async()=>{
      await sql`INSERT INTO account_tier_overrides(user_id,tier,reason) VALUES(${free.id},'plus','Synthetic upgrade')`;
      assert.deepEqual((await ad(free.cookie)).data,{eligible:false});
      await sql`UPDATE account_tier_overrides SET tier='complimentary' WHERE user_id=${free.id}`;assert.deepEqual((await ad(free.cookie)).data,{eligible:false});
      await sql`DELETE FROM account_tier_overrides WHERE user_id=${free.id}`;assert.equal((await ad(free.cookie)).data.eligible,true);
    });
    await t.test('AdSense revisions prevent stale overwrite and pausing leaves verification and all accounts intact',async()=>{
      assert.equal((await request('/api/admin/adsense/settings',{method:'POST',cookie:admin.cookie,body:adBody({revision:0})})).status,409);
      const responses=await Promise.all([request('/api/admin/adsense/settings',{method:'POST',cookie:admin.cookie,body:adBody({verification_enabled:true})}),request('/api/admin/adsense/settings',{method:'POST',cookie:admin.cookie,body:adBody({verification_enabled:true})})]);
      assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);settings=responses.find(r=>r.status===200).data;
      assert.deepEqual((await ad(free.cookie)).data,{eligible:false});assert.ok((await request('/ads.txt')).data.startsWith('google.com'));
      assert.equal((await request('/api/session',{cookie:free.cookie})).data.user.id,free.id);
      assert.equal((await sql`SELECT id FROM stripe_subscriptions WHERE user_id IN ${sql(users)}`).length,0);
    });
  } finally {
    await sql`DELETE FROM adsense_settings`;if(oldAdSettings.length)await sql`INSERT INTO adsense_settings ${sql(oldAdSettings)}`;
    await sql`DELETE FROM password_recovery_mail WHERE email LIKE ${'%'+suffix+'@example.test'}`;
    if(users.length)await sql`DELETE FROM app_users WHERE id IN ${sql(users)}`;
    await closeDatabase();await sql.end();
  }
});
