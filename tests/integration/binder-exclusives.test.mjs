import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {db,closeDatabase} from '../../lib/db.mjs';
import {randomToken,digest} from '../../lib/security.mjs';
const base=process.env.TEST_BASE_URL;
if(process.env.ALLOW_TEST_DATABASE!=='yes'||!base||!new URL(process.env.DATABASE_URL||'http://invalid').pathname.endsWith('_test'))throw Error('Disposable _test database required.');
const sql=db(),users=[randomUUID(),randomUUID()],tokens=users.map(()=>randomToken()),suffix='bulk-'+randomUUID().replaceAll('-','');
const set='en:'+suffix,otherSet=set+'b',cards=[],printings=[],binders=[];
async function request(path,{method='GET',body,user=0,origin=process.env.APP_ORIGIN||base}={}){
  const r=await fetch(base+'/api/'+path,{method,headers:{Origin:origin,'X-Requested-With':'cardshelf',...(user===null?{}:{Cookie:'cardshelf_session='+tokens[user]}),...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});
  return {status:r.status,data:await r.json()};
}
async function ok(path,options){const r=await request(path,options);assert.equal(r.status,200,JSON.stringify(r.data));return r.data;}
const endpoint=b=>'binders/'+b+'/exclusives';
const options={action:'add',set_ids:[set]};
const entries=()=>sql`SELECT * FROM collection_entries WHERE user_id=${users[0]} ORDER BY printing_id,condition`;
await test('bulk product-exclusive pockets stay ordered, atomic and separate from inventory',async t=>{
  let binder,normal1,normal2,normal10,holo1,holo2,holo10,firstRequest;
  try{
    for(const [i,id] of users.entries()){
      await sql`INSERT INTO app_users(id,email,name,password_hash,role) VALUES(${id},${id+'@example.test'},'Bulk fixture','synthetic unused hash',${i?'user':'admin'})`;
      await sql`INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(${digest(tokens[i])},${id},now()+interval '1 hour')`;
    }
    for(const id of [set,otherSet])await sql`INSERT INTO card_sets(id,provider_id,language,name) VALUES(${id},${id.slice(3)},'en','Bulk fixture set')`;
    for(const n of [1,2,10]){
      const card=set+'-'+n;cards.push(card);
      await sql`INSERT INTO cards(id,provider_id,set_id,language,local_id,name) VALUES(${card},${suffix+'-'+n},${set},'en',${String(n)},${'Card '+n})`;
      for(const key of ['normal','holo']){
        const [p]=await sql`INSERT INTO printings(card_id,key,label,source,distribution_base) VALUES(${card},${key},${key},'tcgdex',${key==='normal'?'product_exclusive':'regular'}) RETURNING id`;printings.push(p.id);
        if(key==='normal'){if(n===1)normal1=p.id;if(n===2)normal2=p.id;if(n===10)normal10=p.id;}
        else{if(n===1)holo1=p.id;if(n===2)holo2=p.id;if(n===10)holo10=p.id;}
      }
    }
    const [b]=await sql`INSERT INTO binders(user_id,title,columns,rows,page_count,binder_type,start_on_right) VALUES(${users[0]},'Bulk binder',2,2,3,'tracking',true) RETURNING *`;binder=b.id;binders.push(binder);
    for(const [position,printing_id,collected] of [[0,holo1,true],[3,normal1,false],[4,holo2,false],[7,holo10,true],[9,holo2,true]])await sql`INSERT INTO binder_slots(binder_id,position,printing_id,is_collected) VALUES(${binder},${position},${printing_id},${collected})`;
    await sql`INSERT INTO collection_entries(user_id,printing_id,condition,quantity,wishlist,notes) VALUES(${users[0]},${normal1},'NM',3,true,'Private inventory note')`;
    const inventory=await entries();
    await t.test('preview/apply enforce authentication, ownership, origins and strict inputs',async()=>{
      for(const user of [null,1])assert.equal((await request(endpoint(binder)+'/preview',{method:'POST',body:options,user})).status,user===null?401:404);
      assert.equal((await request(endpoint(binder)+'/preview',{method:'POST',body:options,origin:'https://evil.test'})).status,403);
      assert.equal((await request(endpoint(binder)+'/preview',{method:'POST',body:{...options,quantity:0}})).status,400);
      assert.equal((await request(endpoint(binder)+'/preview',{method:'POST',body:{...options,padding:'x'.repeat(5000)}})).status,413);
    });
    await t.test('preview shows missing extras and moves without changing pockets or ownership',async()=>{
      const p=await ok(endpoint(binder)+'/preview',{method:'POST',body:options});assert.equal(p.added,2);assert.equal(p.slot_count,7);assert.equal(p.page_count,3);
      assert.deepEqual(p.sample.map(s=>s.local_id),['1','1','2','2','2','10','10']);
      assert.equal((await ok('binders/'+binder)).slots.length,5);assert.deepEqual(await entries(),inventory);
    });
    await t.test('apply preserves duplicate pockets and individual tracking marks and closes every gap',async()=>{
      const p=await ok(endpoint(binder)+'/preview',{method:'POST',body:options}),body={...options,revision:p.revision,preview_token:p.preview_token,request_id:randomUUID()};
      firstRequest=body;const r=await ok(endpoint(binder),{method:'POST',body});assert.equal(r.added,2);
      const fresh=await ok('binders/'+binder);assert.deepEqual(fresh.slots.map(s=>s.position),[0,1,2,3,4,5,6]);
      assert.deepEqual(fresh.slots.map(s=>s.printing_id),[normal1,holo1,normal2,holo2,holo2,normal10,holo10]);
      assert.deepEqual(fresh.slots.map(s=>s.is_collected),[false,true,false,false,true,false,true]);
      assert.equal(fresh.start_on_right,true);assert.equal(fresh.page_count,3);assert.equal((await ok(endpoint(binder),{method:'POST',body})).replayed,true);
      assert.deepEqual(await entries(),inventory);
      assert.equal((await request(endpoint(binder),{method:'POST',body:{...body,action:'remove'}})).status,409);
    });
    await t.test('catalogue changes and simultaneous operations cannot apply stale previews',async()=>{
      const opts={...options,action:'remove'},p=await ok(endpoint(binder)+'/preview',{method:'POST',body:opts});
      await sql`UPDATE printings SET distribution_override='unknown',distribution_revision=distribution_revision+1 WHERE id=${normal2}`;
      assert.equal((await request(endpoint(binder),{method:'POST',body:{...opts,revision:p.revision,preview_token:p.preview_token,request_id:randomUUID()}})).status,409);
      await sql`UPDATE printings SET distribution_override=NULL,distribution_revision=distribution_revision+1 WHERE id=${normal2}`;
      const current=await ok(endpoint(binder)+'/preview',{method:'POST',body:opts}),body={...opts,revision:current.revision,preview_token:current.preview_token};
      const results=await Promise.all([request(endpoint(binder),{method:'POST',body:{...body,request_id:randomUUID()}}),request(endpoint(binder),{method:'POST',body:{...body,request_id:randomUUID()}})]);
      assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
      const fresh=await ok('binders/'+binder);assert.deepEqual(fresh.slots.map(s=>s.printing_id),[holo1,holo2,holo2,holo10]);assert.deepEqual(fresh.slots.map(s=>s.position),[0,1,2,3]);
      assert.equal((await ok(endpoint(binder),{method:'POST',body:firstRequest})).replayed,true);
      assert.deepEqual((await ok('binders/'+binder)).slots.map(s=>s.printing_id),fresh.slots.map(s=>s.printing_id));
      assert.deepEqual(await entries(),inventory);
    });
    await t.test('collection binders grow pages and skip archived, unknown and promo choices',async()=>{
      const b=await ok('binders',{method:'POST',body:{title:'Small collection',columns:2,rows:2,page_count:1}});binders.push(b.id);
      for(const [position,id] of [holo1,holo2,holo10].entries())await sql`INSERT INTO binder_slots(binder_id,position,printing_id) VALUES(${b.id},${position},${id})`;
      await sql`UPDATE printings SET provider_active=false WHERE id=${normal10}`;
      await sql`UPDATE printings SET distribution_override='promo' WHERE id=${normal2}`;
      const p=await ok(endpoint(b.id)+'/preview',{method:'POST',body:options});assert.equal(p.added,1);assert.equal(p.page_count,1);
      await sql`UPDATE printings SET provider_active=true WHERE id=${normal10}`;
      await sql`UPDATE printings SET distribution_override=NULL WHERE id=${normal2}`;
      const growth=await ok(endpoint(b.id)+'/preview',{method:'POST',body:options});assert.equal(growth.page_count,2);
      await ok(endpoint(b.id),{method:'POST',body:{...options,revision:growth.revision,preview_token:growth.preview_token,request_id:randomUUID()}});
      const fresh=await ok('binders/'+b.id);assert.equal(fresh.page_count,2);assert.equal(fresh.slots.length,6);assert.deepEqual(await entries(),inventory);
    });
    await t.test('design checklist marks are never silently reinterpreted as exact finishes',async()=>{
      const [b]=await sql`INSERT INTO binders(user_id,title,columns,rows,page_count,binder_type,generation) VALUES(${users[0]},'Design checklist',2,2,1,'tracking','{"options":{"selection":"designs"}}') RETURNING id`;binders.push(b.id);
      assert.equal((await request(endpoint(b.id)+'/preview',{method:'POST',body:options})).status,400);
      assert.equal((await ok('binders/'+b.id)).generation.options.selection,'designs');
    });
    await t.test('sets must belong to the binder game and empty binders remember a restorable set selection',async()=>{
      const b=await ok('binders',{method:'POST',body:{title:'Only extras',columns:2,rows:2,page_count:1}});binders.push(b.id);
      await sql`INSERT INTO binder_slots(binder_id,position,printing_id) VALUES(${b.id},2,${normal1})`;
      const opts={...options,action:'remove'},p=await ok(endpoint(b.id)+'/preview',{method:'POST',body:opts});
      await ok(endpoint(b.id),{method:'POST',body:{...opts,revision:p.revision,preview_token:p.preview_token,request_id:randomUUID()}});
      const empty=await ok('binders/'+b.id);assert.equal(empty.slots.length,0);assert.deepEqual(empty.exclusive_set_ids,[set]);
      assert.equal((await request(endpoint(b.id)+'/preview',{method:'POST',body:{...options,set_ids:['en:nonexistent']}})).status,400);
      const restore=await ok(endpoint(b.id)+'/preview',{method:'POST',body:options});assert.equal(restore.added,3);
    });
  }finally{
    await sql`DELETE FROM app_users WHERE id IN ${sql(users)}`;
    if(printings.length)await sql`DELETE FROM printings WHERE id IN ${sql(printings)}`;
    if(cards.length)await sql`DELETE FROM cards WHERE id IN ${sql(cards)}`;
    await sql`DELETE FROM card_sets WHERE id IN ${sql([set,otherSet])}`;
    await closeDatabase();
  }
});
