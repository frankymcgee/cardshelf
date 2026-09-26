// Disposable database and real HTTP routes; no retailer requests or purchases.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { hashPassword, randomToken, digest } from '../../lib/security.mjs';
const base=process.env.TEST_BASE_URL;
if(process.env.ALLOW_TEST_DATABASE!=='yes'||!base||!new URL(process.env.DATABASE_URL||'http://invalid').pathname.endsWith('_test'))throw new Error('Use a disposable _test database only.');
const sql=postgres(process.env.DATABASE_URL,{max:4}),ids=[],password=' Affiliate fixture password 123 ';
const path='/api/admin/affiliate-shops',publicPath='/api/public/affiliate-shops';
async function request(url,cookie,body,origin=process.env.APP_ORIGIN||base){
  const r=await fetch(base+url,{method:body===undefined?'GET':'POST',redirect:'manual',headers:{...(cookie?{Cookie:cookie}:{}),Origin:origin,'X-Requested-With':'cardshelf','Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  return {status:r.status,headers:r.headers,data:await r.json()};
}
const shop=overrides=>({id:randomUUID(),name:'Fixture shop',description:'English cards and sealed packs',url:'https://shop.example.com/packs?affiliate=fixture%2Bcode',search_url:'https://shop.example.com/search?q={query}&affiliate=fixture%2Bcode',referral_code:'FIXTURE-CODE',enabled:true,placements:['marketplace','cards','catalogue'],games:[],expires_on:'',...overrides});

await test('affiliate settings remain administrator-controlled and publish only active shops',async t=>{
  let original;
  try{
    [original]=await sql`SELECT * FROM affiliate_shop_settings WHERE singleton`;
    assert.ok(original,'Migration creates the singleton');
    await sql`UPDATE affiliate_shop_settings SET enabled=false,shops='[]'::jsonb WHERE singleton`;
    const accounts=[];const hash=await hashPassword(password);
    for(const role of ['admin','user']){
      const id=randomUUID(),token=randomToken();ids.push(id);
      await sql`INSERT INTO app_users(id,name,email,password_hash,role) VALUES(${id},'Affiliate fixture',${id+'@example.test'},${hash},${role})`;
      await sql`INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(${digest(token)},${id},now()+interval '1 hour')`;
      accounts.push({id,cookie:'cardshelf_session='+token});
    }
    const [admin,user]=accounts;
    let revision=(await request(path,admin.cookie)).data.revision;
    const payload=()=>({enabled:true,shops:[shop(),shop({enabled:false,name:'PRIVATE-DRAFT'}),shop({expires_on:'2000-01-01',name:'Expired shop'})],revision,password});
    await t.test('paused defaults reveal no shops and settings require an administrator',async()=>{
      assert.deepEqual((await request(publicPath)).data,{shops:[]});
      for(const account of [null,user])for(const body of [undefined,payload()]){
        const r=await request(path,account?.cookie,body);assert.equal(r.status,account?403:401);assert.match(r.headers.get('cache-control'),/no-store/);assert.doesNotMatch(JSON.stringify(r.data),/Fixture shop/);
      }
    });
    await t.test('password, CSRF and URL validation reject writes without changing settings',async()=>{
      for(const [body,origin,status] of [[{...payload(),password:'incorrect'},undefined,403],[payload(),'https://evil.example.com',403],[{...payload(),shops:[shop({url:'javascript:alert(1)'})]},undefined,400]]){
        assert.equal((await request(path,admin.cookie,body,origin)).status,status);
        const r=await request(path,admin.cookie);assert.equal(r.data.revision,revision);assert.equal(r.data.enabled,false);assert.deepEqual(r.data.shops,[]);
      }
    });
    await t.test('saving preserves exact tracking URLs and exposes only current public links',async()=>{
      const body=payload(),r=await request(path,admin.cookie,body);assert.equal(r.status,200,JSON.stringify(r.data));
      assert.equal(r.data.revision,revision+1);assert.equal(r.data.shops.length,3);assert.equal(r.data.shops[0].url,body.shops[0].url);revision=r.data.revision;
      for(const cookie of [undefined,user.cookie,admin.cookie]){
        const pub=await request(publicPath+'?preview=true',cookie);assert.equal(pub.status,200);assert.equal(pub.data.shops.length,1);assert.equal(pub.data.shops[0].referral_code,'FIXTURE-CODE');
        assert.doesNotMatch(JSON.stringify(pub.data),/PRIVATE-DRAFT|Expired shop|password|revision|updated_by/);
      }
      const audit=await sql`SELECT detail FROM audit_log WHERE user_id=${admin.id} AND action='affiliate.settings_saved'`;
      assert.equal(audit.length,1);assert.doesNotMatch(JSON.stringify(audit),/example\.com|password|FIXTURE-CODE/);
    });
    await t.test('stale edits cannot overwrite saved links and global pause takes effect for all visitors',async()=>{
      const conflict=await request(path,admin.cookie,{...payload(),revision:revision-1,shops:[]});assert.equal(conflict.status,409);
      assert.equal((await request(publicPath)).data.shops.length,1);
      const current=(await request(path,admin.cookie)).data;
      const paused=await request(path,admin.cookie,{enabled:false,shops:current.shops,revision,password});assert.equal(paused.status,200);revision=paused.data.revision;
      assert.deepEqual((await request(publicPath)).data,{shops:[]});
      assert.equal((await request(path,admin.cookie)).data.shops.length,3);
    });
    await t.test('losing the administrator role blocks the next write',async()=>{
      await sql`UPDATE app_users SET role='user' WHERE id=${admin.id}`;
      assert.equal((await request(path,admin.cookie,payload())).status,403);
    });
  }finally{
    if(original)await sql`UPDATE affiliate_shop_settings SET enabled=${original.enabled},shops=${sql.json(original.shops)},revision=${original.revision},updated_by=${original.updated_by},updated_at=${original.updated_at} WHERE singleton`;
    if(ids.length){await sql`DELETE FROM audit_log WHERE user_id IN ${sql(ids)}`;await sql`DELETE FROM app_users WHERE id IN ${sql(ids)}`;await sql`DELETE FROM auth_attempts WHERE bucket IN ${sql(ids.map(id=>digest('affiliate-shops-admin:'+id)))}`;}
    await sql.end();
  }
});
