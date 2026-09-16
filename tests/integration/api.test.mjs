// Run ONLY against an empty disposable database whose name ends with _test.
// Requires migrations and the production application process to be running.
import test from 'node:test';
import assert from 'node:assert/strict';
import postgres from 'postgres';
const url=process.env.TEST_BASE_URL;
if(process.env.ALLOW_TEST_DATABASE!=='yes' || !url || !new URL(process.env.DATABASE_URL||'http://invalid').pathname.endsWith('_test'))
  throw new Error('Integration tests require ALLOW_TEST_DATABASE=yes, TEST_BASE_URL, and DATABASE_URL ending in _test.');
const origin=process.env.APP_ORIGIN||url;
const sql=postgres(process.env.DATABASE_URL,{max:2});
async function request(path,{cookie,method='GET',body,headers={}}={}) {
  const response=await fetch(url+'/api/'+path,{method,redirect:'manual',headers:{Origin:origin,'X-Requested-With':'cardshelf',
    ...(body!==undefined?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{}),...headers},body:body!==undefined?JSON.stringify(body):undefined});
  const text=await response.text();let data;try{data=JSON.parse(text);}catch{data=text;}
  return {status:response.status,data,cookie:response.headers.get('set-cookie')?.split(';')[0],headers:response.headers};
}
let adminCookie,userCookie,adminId,userId,p1,p2,binderId,shareToken;
const credentials={email:'admin@example.test',name:'Test administrator',password:'Admin test password 123'};
const collector={email:'collector@example.test',name:'Test collector',password:'Collector test password 123'};
await test('isolated end-to-end API and database checks',async t=> {
  try {
    const [{n}]=await sql`SELECT count(*)::integer AS n FROM app_users`;
    assert.equal(n,0,'Refusing to modify a non-empty test installation.');
    await t.test('health and first-use status',async()=>{
      assert.equal((await request('health')).status,200);
      assert.equal((await request('session')).data.setup_required,true);
    });
    await t.test('setup rejects a wrong bootstrap token',async()=>{
      assert.equal((await request('setup',{method:'POST',body:{...credentials,token:'not-the-token'}})).status,403);
    });
    await t.test('administrator setup is protected and closes after first use',async()=>{
      const response=await request('setup',{method:'POST',body:{...credentials,token:process.env.BOOTSTRAP_TOKEN}});
      assert.equal(response.status,200);adminCookie=response.cookie;adminId=response.data.user.id;
      assert.ok(adminCookie);assert.match(response.headers.get('set-cookie'),/HttpOnly/i);
      assert.equal((await request('setup',{method:'POST',body:{...credentials,token:process.env.BOOTSTRAP_TOKEN}})).status,409);
    });
    await t.test('cross-site mutations fail',async()=>{
      const response=await request('binders',{method:'POST',cookie:adminCookie,body:{},headers:{Origin:'https://evil.test'}});
      assert.equal(response.status,403);
    });
    await t.test('collector accounts cannot select their own administrator role',async()=>{
      const created=await request('admin/users',{method:'POST',cookie:adminCookie,body:{...collector,role:'admin'}});
      assert.equal(created.status,200);assert.equal(created.data.role,'user');userId=created.data.id;
      const login=await request('login',{method:'POST',body:collector});assert.equal(login.status,200);userCookie=login.cookie;
      assert.equal((await request('admin/status',{cookie:userCookie})).status,403);
    });
    // Synthetic fixtures, not real Pokémon catalogue claims or artwork.
    await sql`INSERT INTO card_sets(id,provider_id,language,name,card_count) VALUES('en:demo','demo','en','Synthetic Test Set',2)`;
    for(const number of [1,2]) await sql`INSERT INTO cards(id,provider_id,set_id,language,local_id,name)
      VALUES(${'en:demo-'+number},${'demo-'+number},'en:demo','en',${String(number)},${'Test Card '+number})`;
    [p1,p2]=await sql`INSERT INTO printings(card_id,key,label,source) VALUES
      ('en:demo-1','normal','Normal','tcgdex'),('en:demo-2','normal','Normal','tcgdex') RETURNING *`;
    if(p1.card_id!=='en:demo-1') [p1,p2]=[p2,p1];
    await t.test('ownership is private and keyed by the authenticated user',async()=>{
      const saved=await request('collection',{method:'PUT',cookie:adminCookie,body:{printing_id:p1.id,condition:'NM',quantity:2,wishlist:true,notes:'Private note',revision:0}});
      assert.equal(saved.status,200);assert.equal(saved.data.quantity,2);
      const privateView=await request('cards/en%3Ademo-1',{cookie:userCookie});assert.equal(privateView.data.entries.length,0);
      const forged=await request('collection',{method:'PUT',cookie:userCookie,body:{user_id:adminId,printing_id:p1.id,condition:'NM',quantity:1,wishlist:false,notes:'Mine',revision:0}});
      assert.equal(forged.status,200);assert.equal(forged.data.user_id,userId);
      assert.equal((await request('dashboard',{cookie:adminCookie})).data.counts.copies,2);
    });
    await t.test('stale and concurrent ownership edits cannot overwrite silently',async()=>{
      const body={printing_id:p1.id,condition:'NM',quantity:3,wishlist:false,notes:'Updated',revision:1};
      const responses=await Promise.all([request('collection',{method:'PUT',cookie:adminCookie,body}),request('collection',{method:'PUT',cookie:adminCookie,body:{...body,quantity:4}})]);
      assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
    });
    await t.test('creating a binder does not add physical copies',async()=>{
      const before=(await request('dashboard',{cookie:adminCookie})).data.counts.copies;
      const response=await request('binders',{method:'POST',cookie:adminCookie,body:{title:'Test Binder',description:'Shared description',columns:3,rows:3,page_count:2,color:'#5546d8'}});
      assert.equal(response.status,200);binderId=response.data.id;
      assert.equal((await request('dashboard',{cookie:adminCookie})).data.counts.copies,before);
      assert.equal((await request('binders/'+binderId,{cookie:userCookie})).status,404);
    });
    await t.test('slot writes validate revision and bounds',async()=>{
      assert.equal((await request('binders/'+binderId+'/slots',{method:'POST',cookie:adminCookie,body:{action:'place',target:0,printing_id:p1.id,revision:1}})).status,200);
      assert.equal((await request('binders/'+binderId+'/slots',{method:'POST',cookie:adminCookie,body:{action:'place',target:1,printing_id:p2.id,revision:1}})).status,409);
      assert.equal((await request('binders/'+binderId+'/slots',{method:'POST',cookie:adminCookie,body:{action:'place',target:99,printing_id:p2.id,revision:2}})).status,400);
    });
    await t.test('occupied slots swap without discarding either card',async()=>{
      assert.equal((await request('binders/'+binderId+'/slots',{method:'POST',cookie:adminCookie,body:{action:'place',target:1,printing_id:p2.id,revision:2}})).status,200);
      assert.equal((await request('binders/'+binderId+'/slots',{method:'POST',cookie:adminCookie,body:{action:'swap',source:0,target:1,revision:3}})).status,200);
      const binder=(await request('binders/'+binderId,{cookie:adminCookie})).data;
      assert.equal(binder.slots[0].printing_id,p2.id);assert.equal(binder.slots[1].printing_id,p1.id);
    });
    await t.test('public shares disclose layout only and can be revoked',async()=>{
      const share=await request('binders/'+binderId+'/share',{method:'POST',cookie:adminCookie,body:{enabled:true,revision:4}});
      assert.equal(share.status,200);shareToken=share.data.share_token;
      const response=await request('shared/'+shareToken);assert.equal(response.status,200);
      assert.equal('user_id' in response.data,false);assert.equal('share_token' in response.data,false);
      for(const slot of response.data.slots) for(const key of ['quantity','notes','user_id','owned','condition']) assert.equal(key in slot,false);
      assert.equal((await request('binders/'+binderId+'/share',{method:'POST',cookie:adminCookie,body:{enabled:false,revision:5}})).status,200);
      assert.equal((await request('shared/'+shareToken)).status,404);
    });
    await t.test('preview has no side effects and safe merge is replay-safe',async()=>{
      const exported=await request('collection/export?format=json',{cookie:adminCookie});assert.equal(exported.status,200);
      const payload={format:'json',text:JSON.stringify(exported.data),mode:'max',apply:false};
      const preview=await request('collection/import',{method:'POST',cookie:adminCookie,body:payload});assert.equal(preview.status,200);assert.equal(preview.data.changed,0);
      const applied=await request('collection/import',{method:'POST',cookie:adminCookie,body:{...payload,apply:true}});assert.equal(applied.status,200);assert.equal(applied.data.changed,0);
    });
    await t.test('non-admin collectors cannot modify the shared catalogue',async()=>{
      assert.equal((await request('cards/en%3Ademo-1/printings',{method:'POST',cookie:userCookie,body:{label:'Manual test'}})).status,403);
    });
    await t.test('binder deletion requires the exact title and preserves collection',async()=>{
      const before=(await request('dashboard',{cookie:adminCookie})).data.counts.copies;
      assert.equal((await request('binders/'+binderId,{method:'DELETE',cookie:adminCookie,body:{confirm_title:'wrong',revision:6}})).status,400);
      assert.equal((await request('binders/'+binderId,{method:'DELETE',cookie:adminCookie,body:{confirm_title:'Test Binder',revision:6}})).status,200);
      assert.equal((await request('dashboard',{cookie:adminCookie})).data.counts.copies,before);
    });
    await t.test('password changes revoke other sessions',async()=>{
      const extra=await request('login',{method:'POST',body:credentials});assert.equal(extra.status,200);
      const changed=await request('password',{method:'POST',cookie:adminCookie,body:{current_password:credentials.password,password:'Replacement password 123'}});
      assert.equal(changed.status,200);adminCookie=changed.cookie;
      assert.equal((await request('session',{cookie:extra.cookie})).data.user,null);
      assert.equal((await request('login',{method:'POST',body:credentials})).status,401);
      assert.equal((await request('session',{cookie:adminCookie})).data.user.id,adminId);
    });
    await t.test('logout invalidates the server-side session',async()=>{
      assert.equal((await request('logout',{method:'POST',cookie:adminCookie,body:{}})).status,200);
      assert.equal((await request('session',{cookie:adminCookie})).data.user,null);
    });
  } finally {await sql.end();}
});
