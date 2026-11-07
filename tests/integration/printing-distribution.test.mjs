import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db, closeDatabase } from '../../lib/db.mjs';
import { randomToken, digest } from '../../lib/security.mjs';
import { reconcileProviderPrintings } from '../../lib/printing-availability.mjs';
const base=process.env.TEST_BASE_URL;
if(process.env.ALLOW_TEST_DATABASE!=='yes'||!base||!new URL(process.env.DATABASE_URL||'http://invalid').pathname.endsWith('_test'))throw Error('Use a disposable _test database.');
const sql=db(),users=[randomUUID(),randomUUID()],tokens=users.map(()=>randomToken());
const suffix='distribution-'+randomUUID().replaceAll('-',''),set='en:'+suffix,card=set+'-001',second=card+'b';
const path=p=>'cards/'+encodeURIComponent(card)+'/printings/'+p+'/distribution';
async function request(path,{method='GET',body,user=0,origin=process.env.APP_ORIGIN||base}={}) {
  const r=await fetch(base+'/api/'+path,{method,headers:{Origin:origin,'X-Requested-With':'cardshelf',
    ...(user===null?{}:{Cookie:'cardshelf_session='+tokens[user]}),...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});
  return {status:r.status,data:await r.json()};
}
async function ok(path,options){const r=await request(path,options);assert.equal(r.status,200,JSON.stringify(r.data));return r.data;}
await test('all-set distribution corrections and scopes preserve cards, inventory and existing binders',async t=>{
  let printings,binder,normal;
  try {
    for(const [i,id] of users.entries()){
      await sql`INSERT INTO app_users(id,email,name,password_hash,role) VALUES(${id},${id+'@example.test'},'Distribution fixture','synthetic unused hash',${i?'user':'admin'})`;
      await sql`INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(${digest(tokens[i])},${id},now()+interval '1 hour')`;
    }
    await sql`INSERT INTO card_sets(id,provider_id,language,name,card_count) VALUES(${set},${suffix},'en','Other set fixture',2)`;
    for(const [i,id] of [card,second].entries()){
      await sql`INSERT INTO cards(id,provider_id,set_id,language,local_id,name,raw_data) VALUES(${id},${suffix+'-'+i},${set},'en',${String(i)},'Other set card',${sql.json({variants_detailed:[{type:'normal',stamp:['staff'],thirdParty:{tcgplayer:12345}}]})})`;
      await sql.begin(tx=>reconcileProviderPrintings(tx,id,{normal:true,holo:true,reverse:true}));
    }
    printings=await sql`SELECT * FROM printings WHERE card_id=${card} ORDER BY key`;normal=printings.find(p=>p.key==='normal');
    binder=await ok('binders',{method:'POST',body:{title:'Existing all-variants binder',columns:3,rows:3,page_count:1,binder_type:'tracking'}});
    await sql`INSERT INTO binder_slots ${sql(printings.map((p,position)=>({binder_id:binder.id,printing_id:p.id,position,is_collected:p.key!=='normal'})),'binder_id','printing_id','position','is_collected')}`;
    await sql`INSERT INTO collection_entries(user_id,printing_id,condition,quantity,wishlist) VALUES(${users[0]},${normal.id},'NM',2,true)`;
    const change={distribution:'product_exclusive',note:'Other set deck exclusive',evidence_url:'https://www.tcgplayer.com/product/12345',revision:1};
    await t.test('administrator-only review covers arbitrary sets and does not classify three variants or stamps automatically',async()=>{
      const review=await ok('catalogue/distribution-review?set='+set);assert.equal(review.total,2);
      assert.ok(review.items.every(c=>c.printings.every(p=>p.distribution==='unknown')));
      const signal=review.items.find(c=>c.id===card).printings.find(p=>p.key==='normal').distribution_signals[0];
      assert.deepEqual(signal.stamps,['staff']);assert.equal(signal.tcgplayer,12345);
      for(const user of [1,null])assert.equal((await request('catalogue/distribution-review',{user})).status,user===null?401:403);
    });
    await t.test('corrections enforce authentication, origin, exact printing, evidence and optimistic concurrency',async()=>{
      for(const user of [1,null])assert.equal((await request(path(normal.id),{method:'PATCH',body:change,user})).status,user===null?401:403);
      assert.equal((await request(path(normal.id),{method:'PATCH',body:change,origin:'https://evil.test'})).status,403);
      assert.equal((await request(path(normal.id),{method:'PATCH',body:{...change,evidence_url:'javascript:alert(1)'}})).status,400);
      const wrong=await sql`SELECT id FROM printings WHERE card_id=${second} LIMIT 1`;
      assert.equal((await request(path(wrong[0].id),{method:'PATCH',body:change})).status,404);
      const results=await Promise.all([request(path(normal.id),{method:'PATCH',body:change}),request(path(normal.id),{method:'PATCH',body:change})]);
      assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
      assert.equal((await sql`SELECT count(*)::integer AS n FROM audit_log WHERE user_id=${users[0]} AND action='catalogue.printing_distribution'`)[0].n,1);
    });
    await t.test('re-import keeps overrides and existing all-scope binders retain all pockets',async()=>{
      await sql.begin(tx=>reconcileProviderPrintings(tx,card,{normal:true,holo:true,reverse:true}));
      const fresh=await ok('cards/'+card);assert.equal(fresh.printings.find(p=>p.id===normal.id).distribution,'product_exclusive');
      assert.equal(fresh.printings.find(p=>p.id===normal.id).catalogue_available,true);
      assert.equal(fresh.entries[0].quantity,2);
      const b=await ok('binders/'+binder.id);assert.equal(b.printing_scope,'all');assert.equal(b.slots.length,3);assert.equal(b.progress.total,3);
    });
    await t.test('generation applies the chosen scope before design selection for any set and detects stale previews',async()=>{
      const input={title:'Scoped generation',set_ids:[set],columns:3,rows:3,selection:'printings',binder_type:'tracking'};
      const regular=await ok('binders/generate/preview',{method:'POST',body:input});assert.equal(regular.slot_count,5);assert.equal(regular.excluded_extras,1);assert.equal(regular.unconfirmed_slots,5);
      const all=await ok('binders/generate/preview',{method:'POST',body:{...input,printing_scope:'all'}});assert.equal(all.slot_count,6);
      await ok(path(normal.id),{method:'PATCH',body:{...change,distribution:'regular',revision:2}});
      assert.equal((await request('binders/generate',{method:'POST',body:{...input,preview_token:regular.token,request_id:randomUUID()}})).status,409);
      await ok(path(normal.id),{method:'PATCH',body:{...change,revision:3}});
      const current=await ok('binders/generate/preview',{method:'POST',body:input});
      const requestId=randomUUID(),body={...input,preview_token:current.token,request_id:requestId};
      const created=await ok('binders/generate',{method:'POST',body});assert.equal(created.binders.length,1);
      const generated=await ok('binders/'+created.binders[0].id);assert.equal(generated.printing_scope,'regular');assert.equal(generated.slots.length,5);
      assert.equal((await ok('binders/generate',{method:'POST',body})).replayed,true);
      await ok('binders/'+generated.id,{method:'DELETE',body:{revision:generated.revision,confirm_title:generated.title}});
    });
    await t.test('scope changes update private/shared progress, missing targets and wishlist eligibility without removing extras',async()=>{
      const before=await ok('binders/'+binder.id+'/completion');assert.equal(before.progress.total,3);assert.equal(before.items.length,1);
      const b=await ok('binders/'+binder.id);
      await ok('binders/'+binder.id,{method:'PATCH',body:{...b,printing_scope:'regular'}});
      const fresh=await ok('binders/'+binder.id);assert.equal(fresh.slots.length,3);assert.equal(fresh.progress.percent,100);
      const state=await ok('binders/'+binder.id+'/completion');assert.equal(state.progress.total,2);assert.equal(state.items.length,0);assert.equal(state.extras[0].printing_id,normal.id);
      assert.equal((await request('binders/'+binder.id+'/completion/wishlist',{method:'POST',body:{preview_token:before.preview_token,printing_ids:[normal.id]}})).status,409);
      const listed=(await ok('binders')).find(b=>b.id===binder.id);assert.equal(listed.filled,3);assert.equal(listed.completion_total,2);assert.equal(listed.collected,2);
      const shared=await ok('binders/'+binder.id+'/share',{method:'POST',body:{enabled:true,revision:fresh.revision}});
      const publicBinder=await ok('shared/'+shared.share_token,{user:null});assert.equal(publicBinder.progress.percent,100);assert.equal(publicBinder.printing_scope,'regular');
      assert.ok(publicBinder.slots.every(s=>!('owned' in s)&&!('owned_quantity' in s)&&!('quantity' in s)));
      const mark=await ok('binders/'+binder.id+'/tracking',{method:'POST',body:{request_id:randomUUID(),revision:shared.revision,position:0,printing_id:printings[0].id,collected:false}});
      assert.equal(mark.progress.total,2);assert.equal(mark.progress.collected,1);
    });
    await t.test('reset uses sourced data, unknown is kept, and two-printing cards also appear in all-unknown review',async()=>{
      const p=(await ok('cards/'+card)).printings.find(p=>p.id===normal.id);
      await ok(path(normal.id),{method:'PATCH',body:{distribution:null,revision:p.distribution_revision}});
      assert.equal((await ok('cards/'+card)).printings.find(p=>p.id===normal.id).distribution,'unknown');
      await sql`UPDATE printings SET provider_active=false WHERE card_id=${second} AND key='reverse'`;
      assert.equal((await ok('catalogue/distribution-review?set='+set)).total,1);
      assert.equal((await ok('catalogue/distribution-review?mode=unknown&set='+set)).total,2);
      assert.equal((await sql`SELECT quantity FROM collection_entries WHERE user_id=${users[0]} AND printing_id=${normal.id}`)[0].quantity,2);
    });
    await t.test('curated rules are keyed by language, game, exact card and finish and apply on later imports',async()=>{
      const rules=await sql`SELECT * FROM printing_distribution_rules WHERE game='pokemon' AND language='en' AND provider_card_id='me05-028'`;
      assert.equal(rules.find(r=>r.printing_key==='normal').distribution,'product_exclusive');assert.equal(rules.length,3);
      await sql`INSERT INTO printing_distribution_rules(game,language,provider_card_id,printing_key,distribution,note,evidence_url)
        VALUES('pokemon','en',${suffix+'-1'},'normal','promo','Another set product','https://example.test/product')`;
      await sql.begin(tx=>reconcileProviderPrintings(tx,second,{normal:true,holo:true,reverse:true}));
      const rows=await sql`SELECT * FROM printings WHERE card_id=${second}`;assert.equal(rows.find(p=>p.key==='normal').distribution,'promo');assert.equal(rows.find(p=>p.key==='holo').distribution,'unknown');
    });
  } finally {
    await sql`DELETE FROM app_users WHERE id IN ${sql(users)}`;
    await sql`DELETE FROM printings WHERE card_id IN ${sql([card,second])}`;
    await sql`DELETE FROM cards WHERE id IN ${sql([card,second])}`;
    await sql`DELETE FROM card_sets WHERE id=${set}`;
    await sql`DELETE FROM printing_distribution_rules WHERE provider_card_id=${suffix+'-1'}`;
    await closeDatabase();
  }
});
