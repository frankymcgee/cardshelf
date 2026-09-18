// Disposable PostgreSQL/production-server tests. No provider credentials or outbound payment calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { hashPassword,randomToken,digest } from '../../lib/security.mjs';
const base=process.env.TEST_BASE_URL, databaseUrl=process.env.DATABASE_URL;
if(process.env.ALLOW_TEST_DATABASE!=='yes'||!base||!new URL(databaseUrl||'http://invalid').pathname.endsWith('_test'))throw Error('Use only the disposable _test database.');
const sql=postgres(databaseUrl,{max:4}),origin=process.env.APP_ORIGIN||base;
await test('collection-backed tracking, conversion and safe quick ownership',async t=>{
  const owner=randomUUID(),other=randomUUID(),member=randomUUID(),tokens=[randomToken(),randomToken(),randomToken()];
  const group='ci-sync-'+randomUUID().replaceAll('-',''),setId='en:'+group,cardIds=[];
  const savedControls=await sql`SELECT * FROM stripe_billing_controls`;
  let a,b,design,p,q,r,plain;
  async function request(path,{method='GET',body,user=0,headers={}}={}){
    const response=await fetch(base+path,{method,redirect:'manual',headers:{Origin:origin,'X-Requested-With':'cardshelf',...(user===null?{}:{Cookie:'cardshelf_session='+tokens[user]}),...(body===undefined?{}:{'Content-Type':'application/json'}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
    assert.match(response.headers.get('content-type')||'',/application\/json/,'API must not render website HTML');
    return {status:response.status,data:await response.json()};
  }
  async function get(id,user=0){const x=await request('/api/binders/'+id,{user});assert.equal(x.status,200,JSON.stringify(x.data));return x.data;}
  const endpoint=id=>'/api/binders/'+id+'/collection-sync';
  async function preview(id){const x=await request(endpoint(id));assert.equal(x.status,200,JSON.stringify(x.data));return x.data;}
  const convertBody=(v,extra={})=>({request_id:randomUUID(),revision:v.revision,preview_token:v.preview_token,import_marks:true,confirm:true,confirm_displayed_printings:true,...extra});
  function markBody(binder,position,collected=true){const s=binder.slots.find(s=>s.position===position);return {request_id:randomUUID(),revision:binder.revision,position,printing_id:s.printing_id,collected,ownership_version:s.ownership_version};}
  async function mark(id,body,extra={}){return request('/api/binders/'+id+'/ownership',{method:'POST',body,...extra});}
  async function total(printingId){return Number((await sql`SELECT coalesce(sum(quantity),0)::integer AS n FROM collection_entries WHERE user_id=${owner} AND printing_id=${printingId}`)[0].n);}
  try{
    const hash=await hashPassword('Collection sync test password 123');
    for(const [i,id] of [owner,other,member].entries()){
      await sql`INSERT INTO app_users(id,email,name,password_hash) VALUES(${id},${group+i+'@example.test'},'Collection sync fixture',${hash})`;
      await sql`INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(${digest(tokens[i])},${id},now()+interval '1 hour')`;
    }
    await sql`INSERT INTO card_sets(id,provider_id,language,name) VALUES(${setId},${group},'en','Synthetic sync set')`;
    const printings=[];
    for(let i=0;i<3;i++){
      const id=setId+'-'+i;cardIds.push(id);
      await sql`INSERT INTO cards(id,provider_id,set_id,language,local_id,name) VALUES(${id},${group+'-'+i},${setId},'en',${String(i)},${'Synthetic sync card '+i})`;
      const [printing]=await sql`INSERT INTO printings(card_id,key,label,source) VALUES(${id},'holo','Holo','tcgdex') RETURNING id`;printings.push(printing.id);
    }
    [p,q,r]=printings;
    async function makeBinder(type,title,generation=null,userId=owner){const [binder]=await sql`INSERT INTO binders(user_id,title,columns,rows,page_count,binder_type,generation)
      VALUES(${userId},${title},2,2,1,${type},${sql.json(generation)}) RETURNING id`;return binder.id;}
    a=await makeBinder('tracking','Convert fixture');b=await makeBinder('collection','Other collection');design=await makeBinder('tracking','Any printing fixture',{options:{selection:'designs'}});plain=await makeBinder('tracking','Untouched tracker');
    await sql`INSERT INTO binder_slots(binder_id,position,printing_id,is_collected) VALUES
      (${a},0,${p},true),(${a},1,${p},true),(${a},2,${q},true),(${a},3,${r},false),
      (${b},0,${p},false),(${b},1,${q},false),(${b},2,${r},false),
      (${design},0,${r},true),(${plain},0,${r},false)`;
    await sql`INSERT INTO collection_entries(user_id,printing_id,condition,quantity,wishlist,notes) VALUES
      (${owner},${q},'NM',3,true,'Detailed notes retained'),(${owner},${r},'UNKNOWN',0,true,'Wishlist retained')`;
    const oldShare=randomToken();await sql`UPDATE binders SET share_token=${oldShare} WHERE id=${a}`;

    await t.test('routes require login, JSON mutations and correct binder ownership',async()=>{
      assert.equal((await request(endpoint(a),{user:null})).status,401);
      assert.equal((await request(endpoint(a),{user:1})).status,404);
      assert.equal((await request(endpoint(a),{method:'POST',body:{},headers:{Origin:'https://evil.test'}})).status,403);
      assert.equal((await mark(a,{}, {user:null})).status,401);
      assert.equal((await request(endpoint(a),{method:'POST',body:{},headers:{'Content-Type':'text/plain'}})).status,415);
      assert.equal((await request(endpoint(a),{method:'POST',body:{x:'a'.repeat(5000)}})).status,413);
    });
    await t.test('conversion preview is read-only and deduplicates repeated printing marks',async()=>{
      const v=await preview(a);assert.equal(v.would_add,1);assert.equal(v.already_owned,1);assert.equal(v.marked.length,2);assert.equal(v.sharing_will_be_revoked,true);
      assert.equal(await total(p),0);assert.equal((await get(a)).binder_type,'tracking');
    });
    await t.test('stale inventory invalidates a conversion preview without partial writes',async()=>{
      const v=await preview(a);
      await sql`UPDATE collection_entries SET notes='Detailed notes retained',revision=revision+1 WHERE user_id=${owner} AND printing_id=${q}`;
      assert.equal((await request(endpoint(a),{method:'POST',body:convertBody(v)})).status,409);
      assert.equal(await total(p),0);assert.equal((await get(a)).binder_type,'tracking');
    });
    await t.test('conversion is atomic, in place, replay-safe and preserves existing inventory',async()=>{
      const v=await preview(a),body=convertBody(v),result=await request(endpoint(a),{method:'POST',body});assert.equal(result.status,200,JSON.stringify(result.data));
      assert.equal(result.data.added,1);assert.equal(result.data.already_owned,1);assert.equal(result.data.sharing_revoked,true);
      const binder=await get(a);assert.equal(binder.id,a);assert.equal(binder.title,'Convert fixture');assert.equal(binder.binder_type,'collection');assert.equal(binder.quick_tracking,true);assert.equal(binder.slots.length,4);assert.equal(binder.share_token,null);
      assert.deepEqual(binder.slots.slice(0,2).map(s=>s.owned_quantity),[1,1]);assert.equal(await total(p),1);assert.equal(await total(q),3);assert.equal(await total(r),0);
      const [entry]=await sql`SELECT * FROM collection_entries WHERE user_id=${owner} AND printing_id=${q}`;assert.equal(entry.condition,'NM');assert.equal(entry.notes,'Detailed notes retained');assert.equal(entry.wishlist,true);
      const replay=await request(endpoint(a),{method:'POST',body});assert.equal(replay.status,200);assert.equal(replay.data.replayed,true);assert.equal(await total(p),1);
      assert.equal((await request('/api/shared/'+oldShare)).status,404);
    });
    await t.test('shared collection binders never expose the private quick-ownership state',async()=>{
      const binder=await get(a),s=await request('/api/binders/'+a+'/share',{method:'POST',body:{revision:binder.revision,enabled:true}});assert.equal(s.status,200);
      const view=await request('/api/shared/'+s.data.share_token,{user:null});assert.equal(view.status,200,JSON.stringify(view.data));
      for(const slot of view.data.slots)for(const field of ['owned','owned_quantity','is_collected','ownership_version','can_quick_remove'])assert.equal(Object.hasOwn(slot,field),false,field);
    });
    await t.test('design checklists require exact-printing consent or convert without importing claims',async()=>{
      const v=await preview(design);assert.equal(v.design_checklist,true);
      assert.equal((await request(endpoint(design),{method:'POST',body:convertBody(v,{confirm_displayed_printings:false})})).status,400);
      assert.equal(await total(r),0);
      assert.equal((await request(endpoint(design),{method:'POST',body:convertBody(v,{import_marks:false,confirm_displayed_printings:false})})).status,200);
      assert.equal((await get(design)).slots[0].owned,false);assert.equal(await total(r),0);
    });
    await t.test('quick mark adds exactly one Unknown copy and updates all collection-backed views',async()=>{
      const body=markBody(await get(a),3),result=await mark(a,body);assert.equal(result.status,200,JSON.stringify(result.data));assert.equal(result.data.owned_quantity,1);
      assert.equal((await mark(a,body)).data.replayed,true);assert.equal(await total(r),1);
      assert.equal((await get(b)).slots.find(s=>s.printing_id===r).owned,true);assert.equal((await get(design)).slots[0].owned,true);
      const [entry]=await sql`SELECT * FROM collection_entries WHERE user_id=${owner} AND printing_id=${r}`;assert.equal(entry.condition,'UNKNOWN');assert.equal(entry.wishlist,true);assert.equal(entry.notes,'Wishlist retained');
      const noExtra=await mark(b,markBody(await get(b),2));assert.equal(noExtra.status,200);assert.equal(noExtra.data.changed,false);assert.equal(await total(r),1);
    });
    await t.test('safe quick removal preserves notes/wishlist and an old add retry never restores the copy',async()=>{
      const before=await get(a),remove=markBody(before,3,false);assert.equal((await mark(a,remove)).status,200);assert.equal(await total(r),0);
      const add=markBody(await get(a),3,true);assert.equal((await mark(a,add)).status,200);
      assert.equal((await mark(a,markBody(await get(a),3,false))).status,200);
      const replay=await mark(a,add);assert.equal(replay.status,200);assert.equal(replay.data.is_collected,false);assert.equal(await total(r),0);
      const [entry]=await sql`SELECT * FROM collection_entries WHERE user_id=${owner} AND printing_id=${r}`;assert.equal(entry.notes,'Wishlist retained');assert.equal(entry.wishlist,true);
    });
    await t.test('concurrent marks in different binders cannot inflate ownership',async()=>{
      const left=markBody(await get(a),3),right=markBody(await get(b),2);
      const results=await Promise.all([mark(a,left),mark(b,right)]);assert.deepEqual(results.map(x=>x.status).sort(),[200,409]);assert.equal(await total(r),1);
      const loser=results[0].status===409?a:b,position=loser===a?3:2;assert.equal((await mark(loser,markBody(await get(loser),position))).status,200);assert.equal(await total(r),1);
    });
    await t.test('stale versions, different payload replays and other-owner writes are rejected',async()=>{
      const before=await get(a),body=markBody(before,0,true);const result=await mark(a,body);assert.equal(result.status,200);
      assert.equal((await mark(a,{...body,collected:false})).status,409);
      assert.equal((await mark(a,{...body,request_id:randomUUID(),ownership_version:'0'.repeat(64)})).status,409);
      assert.equal((await mark(a,{...body,request_id:randomUUID()},{user:1})).status,404);
      assert.equal((await mark(a,{...body,user_id:other})).status,400);
    });
    await t.test('detailed or multiple copies cannot be removed by the quick button',async()=>{
      assert.equal((await mark(a,markBody(await get(a),2,false))).status,409);assert.equal(await total(q),3);
      const before=await get(a);await sql`UPDATE collection_entries SET notes='Edited in detail',revision=revision+1 WHERE user_id=${owner} AND printing_id=${p}`;
      assert.equal((await mark(a,markBody(before,0,false))).status,409);
      const fresh=await get(a);assert.equal(fresh.slots[0].can_quick_remove,false);assert.equal((await mark(a,markBody(fresh,0,false))).status,409);assert.equal(await total(p),1);
    });
    await t.test('basic Collector cannot enable sync or mutate quick ownership under enforcement; testers keep access',async()=>{
      await sql`DELETE FROM account_access_grants WHERE user_id=${member}`;
      await sql`INSERT INTO account_tier_overrides(user_id,tier,reason) VALUES(${member},'collector','Synthetic tier restriction')`;
      const own=await makeBinder('tracking','Restricted tracker',null,member);
      await sql`INSERT INTO binder_slots(binder_id,position,printing_id) VALUES(${own},0,${p})`;
      await sql`INSERT INTO stripe_billing_controls(id,environment,subscriptions_enabled,enforcement_enabled) VALUES(1,'production',false,true)
        ON CONFLICT(id) DO UPDATE SET environment='production',subscriptions_enabled=false,enforcement_enabled=true`;
      assert.equal((await request(endpoint(own),{user:2})).status,403);
      const foreign=await mark(a,markBody(await get(a),0),{user:2});assert.equal(foreign.status,403);
      assert.equal((await preview(plain)).binder_id,plain);
      await sql`UPDATE account_tier_overrides SET tier='complimentary' WHERE user_id=${member}`;
      assert.equal((await request(endpoint(own),{user:2})).status,200);
      await sql`DELETE FROM stripe_billing_controls`;for(const row of savedControls)await sql`INSERT INTO stripe_billing_controls ${sql(row)}`;
    });
    await t.test('independent tracking remains independent, and deleting a collection binder preserves cards',async()=>{
      const tracker=await get(plain);const body={request_id:randomUUID(),revision:tracker.revision,position:0,printing_id:r,collected:true};
      const prior=await total(r);assert.equal((await request('/api/binders/'+plain+'/tracking',{method:'POST',body})).status,200);assert.equal(await total(r),prior);
      const binder=await get(a);assert.equal((await request('/api/binders/'+a,{method:'DELETE',body:{revision:binder.revision,confirm_title:binder.title}})).status,200);assert.equal(await total(p),1);assert.equal(await total(q),3);
    });
  }finally{
    try{
      await sql`DELETE FROM stripe_billing_controls`;for(const row of savedControls)await sql`INSERT INTO stripe_billing_controls ${sql(row)}`;
      await sql`DELETE FROM app_users WHERE id IN (${owner},${other},${member})`;
      if(cardIds.length){await sql`DELETE FROM printings WHERE card_id IN ${sql(cardIds)}`;await sql`DELETE FROM cards WHERE id IN ${sql(cardIds)}`;}
      await sql`DELETE FROM card_sets WHERE id=${setId}`;
    }finally{await sql.end();}
  }
});
