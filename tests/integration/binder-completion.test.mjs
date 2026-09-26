import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { hashPassword, randomToken, digest } from '../../lib/security.mjs';
const base=process.env.TEST_BASE_URL,database=process.env.DATABASE_URL;
if(process.env.ALLOW_TEST_DATABASE!=='yes'||!base||!new URL(database||'http://invalid').pathname.endsWith('_test'))throw new Error('Use a disposable _test database only.');
const sql=postgres(database,{max:4}),origin=process.env.APP_ORIGIN||base;
await test('binder completion uses exact targets and atomic private wishlist updates',async t=>{
  const suffix=randomUUID(),users=Array.from({length:5},()=>randomUUID()),tokens=users.map(()=>randomToken());
  const [owner,seller,collector,plus,free]=users,sets=[],cards=[],printings=[],binders=[],listings=[];
  const controls=await sql`SELECT * FROM stripe_billing_controls`;
  let normal,holo,reverse,japanese,unplanned,collection,tracking,design;
  async function request(path,{method='GET',body,user=0,headers={}}={}){
    const response=await fetch(base+path,{method,redirect:'manual',headers:{Origin:origin,'X-Requested-With':'cardshelf',
      ...(user===null?{}:{Cookie:'cardshelf_session='+tokens[user]}),...(body===undefined?{}:{'Content-Type':'application/json'}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
    assert.match(response.headers.get('content-type')||'',/application\/json/,path);
    return {status:response.status,data:await response.json(),headers:response.headers};
  }
  const path=id=>'/api/binders/'+id+'/completion';
  async function preview(id=collection,user=0){const r=await request(path(id),{user});assert.equal(r.status,200,JSON.stringify(r.data));return r.data;}
  const payload=(view,ids,extra={})=>({preview_token:view.preview_token,printing_ids:ids,...extra});
  const save=(id,body,user=0)=>request(path(id)+'/wishlist',{method:'POST',body,user});
  const entries=()=>sql`SELECT printing_id,condition,quantity,wishlist,notes,revision FROM collection_entries WHERE user_id=${owner} ORDER BY printing_id,condition`;
  async function makeBinder(type,user=owner,generation=null){
    const [b]=await sql`INSERT INTO binders(user_id,title,columns,rows,page_count,binder_type,generation,share_token)
      VALUES(${user},'Completion fixture',2,2,2,${type},${sql.json(generation)},${randomToken()}) RETURNING *`;binders.push(b.id);return b.id;
  }
  async function sale(printing,extra={}){
    const o={seller,hidden:false,status:'active',price:1000,...extra};
    const [row]=await sql`INSERT INTO marketplace_listings(seller_id,request_id,input_hash,printing_id,seller_alias,condition,price_minor,delivery,postage_minor,region,description,hidden,status)
      VALUES(${o.seller},${randomUUID()},'fixture',${printing},'Public fixture seller','LP',${o.price},'both',200,'Perth','Synthetic completion listing',${o.hidden},${o.status}) RETURNING id`;
    listings.push(row.id);return row.id;
  }
  try{
    const hash=await hashPassword('Completion fixture password 123');
    for(const [i,id] of users.entries()){
      await sql`INSERT INTO app_users(id,email,name,password_hash) VALUES(${id},${suffix+'-'+i+'@example.test'},'Private fixture name',${hash})`;
      await sql`INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(${digest(tokens[i])},${id},now()+interval '1 hour')`;
    }
    for(const language of ['en','ja']){
      const setId=language+':completion-'+suffix,cardId=setId+'-1';sets.push(setId);cards.push(cardId);
      await sql`INSERT INTO card_sets(id,provider_id,language,name) VALUES(${setId},${'completion-'+suffix},${language},'Completion fixture set')`;
      await sql`INSERT INTO cards(id,provider_id,set_id,language,local_id,name) VALUES(${cardId},${'completion-'+suffix+'-1'},${setId},${language},'1','Fixture Pikachu')`;
      for(const key of language==='en'?['normal','holo','reverse','unplanned']:['holo']){
        const [p]=await sql`INSERT INTO printings(card_id,key,label,source) VALUES(${cardId},${key},${key},'tcgdex') RETURNING id`;printings.push(p.id);
        if(language==='ja')japanese=p.id;else if(key==='normal')normal=p.id;else if(key==='holo')holo=p.id;else if(key==='reverse')reverse=p.id;else unplanned=p.id;
      }
    }
    collection=await makeBinder('collection');tracking=await makeBinder('tracking');design=await makeBinder('tracking',owner,{options:{selection:'designs'}});
    await sql`INSERT INTO binder_slots(binder_id,position,printing_id,is_collected) VALUES
      (${collection},0,${normal},false),(${collection},1,${holo},false),(${collection},2,${reverse},false),(${collection},4,${normal},false),
      (${tracking},0,${normal},false),(${tracking},1,${holo},true),(${tracking},2,${reverse},false),(${design},0,${holo},false)`;
    await sql`INSERT INTO collection_entries(user_id,printing_id,condition,quantity,wishlist,notes) VALUES
      (${owner},${normal},'NM',3,false,'Private owned notes'),(${owner},${holo},'UNKNOWN',0,false,'Private wanted notes'),(${owner},${reverse},'LP',0,true,'Keep this wish')`;
    const active=[];for(let i=0;i<7;i++)active.push(await sale(holo,{price:1000+i*100}));
    for(const status of ['reserved','sold','withdrawn'])await sale(holo,{status});
    await sale(holo,{hidden:true});await sale(holo,{seller:owner,price:1});await sale(japanese);await sale(reverse);await sale(normal);
    await t.test('authenticated owner-only endpoints enforce origin, body limits and no-store',async()=>{
      for(const user of [null,1])assert.equal((await request(path(collection),{user})).status,user===null?401:404);
      const view=await preview(),body=payload(view,[holo]);
      assert.match((await request(path(collection))).headers.get('cache-control'),/no-store/);
      assert.equal((await save(collection,body,1)).status,404);
      assert.equal((await request(path(collection)+'/wishlist',{method:'POST',body,user:null})).status,401);
      assert.equal((await request(path(collection)+'/wishlist',{method:'POST',body,headers:{Origin:'https://evil.test'}})).status,403);
      assert.equal((await request(path(collection)+'/wishlist',{method:'POST',body,headers:{'Content-Type':'text/plain'}})).status,415);
      assert.equal((await save(collection,{...body,padding:'x'.repeat(50000)})).status,413);
      assert.equal((await request(path(collection)+'/matches?printing_id='+holo,{user:1})).status,404);
    });
    await t.test('Collection and Tracking modes retain their different completion semantics',async()=>{
      const view=await preview();assert.deepEqual(view.progress,{total:4,completed:2,missing:2,missing_printings:2,percent:50});
      assert.deepEqual(view.items.map(i=>i.printing_id),[holo,reverse]);assert.equal(view.items[1].wishlist,true);
      const tracker=await preview(tracking);assert.deepEqual(tracker.items.map(i=>i.printing_id),[normal,reverse]);assert.equal(tracker.items[0].owned_quantity,3);assert.equal(tracker.progress.completed,1);
      assert.ok(!JSON.stringify(view).includes('Private wanted notes'));assert.ok(!JSON.stringify(view).includes('Private owned notes'));
    });
    await t.test('matching is exact, active, visible, not your own and paginated without private seller data',async()=>{
      const view=await preview();assert.equal(view.items[0].match_count,7);assert.equal(view.items[1].match_count,1);
      const r=await request(path(collection)+'/matches?printing_id='+holo);assert.equal(r.status,200);assert.equal(r.data.total,7);assert.equal(r.data.items.length,6);
      assert.deepEqual(r.data.items.map(i=>i.id),active.slice(0,6));assert.equal(r.data.items[0].condition,'LP');assert.equal(r.data.items[0].delivery,'both');assert.equal(r.data.items[0].postage_minor,200);
      assert.deepEqual(Object.keys(r.data.items[0]).sort(),['id','seller_alias','condition','price_minor','postage_minor','delivery','region','currency'].sort());
      const second=await request(path(collection)+'/matches?printing_id='+holo+'&page=2');assert.equal(second.data.items.length,1);assert.equal(second.data.items[0].id,active[6]);
      for(const p of [normal,japanese,unplanned])assert.equal((await request(path(collection)+'/matches?printing_id='+p)).status,409);
      await sql`UPDATE marketplace_listings SET status='sold' WHERE id=${active[0]}`;
      assert.equal((await preview()).items[0].match_count,6);await sql`UPDATE marketplace_listings SET status='active' WHERE id=${active[0]}`;
    });
    await t.test('stale ownership and binder revisions reject the entire bulk selection',async()=>{
      const view=await preview(),before=await entries();
      await sql`UPDATE collection_entries SET quantity=1,revision=revision+1 WHERE user_id=${owner} AND printing_id=${holo}`;
      assert.equal((await save(collection,payload(view,[holo,reverse]))).status,409);
      assert.equal((await entries()).find(e=>e.printing_id===holo).wishlist,false);
      assert.equal((await request(path(collection)+'/matches?printing_id='+holo)).status,409);
      await sql`UPDATE collection_entries SET quantity=0,revision=revision+1 WHERE user_id=${owner} AND printing_id=${holo}`;
      const next=await preview();await sql`UPDATE binders SET revision=revision+1 WHERE id=${collection}`;
      assert.equal((await save(collection,payload(next,[holo,reverse]))).status,409);
      assert.equal((await entries()).find(e=>e.printing_id===reverse).revision,before.find(e=>e.printing_id===reverse).revision);
    });
    await t.test('bulk add preserves quantities, notes, existing condition wishes, layouts and sharing',async()=>{
      const before=await entries(),layout=await sql`SELECT * FROM binders WHERE id=${collection}`,slots=await sql`SELECT * FROM binder_slots WHERE binder_id=${collection} ORDER BY position`;
      const view=await preview(),body=payload(view,[holo,reverse]),r=await save(collection,body);assert.equal(r.status,200,JSON.stringify(r.data));assert.deepEqual(r.data,{added:1,already_wishlisted:1});
      const after=await entries();assert.equal(after.length,before.length);
      for(const old of before){const next=after.find(e=>e.printing_id===old.printing_id&&e.condition===old.condition);assert.equal(next.quantity,old.quantity);assert.equal(next.notes,old.notes);}
      assert.equal(after.find(e=>e.printing_id===holo).wishlist,true);assert.equal(after.find(e=>e.printing_id===reverse).condition,'LP');
      assert.deepEqual(await sql`SELECT * FROM binders WHERE id=${collection}`,layout);assert.deepEqual(await sql`SELECT * FROM binder_slots WHERE binder_id=${collection} ORDER BY position`,slots);
      assert.equal((await save(collection,body)).status,409,'uncertain old requests require a fresh snapshot');
      const latest=await preview();assert.deepEqual((await save(collection,payload(latest,[holo,reverse]))).data,{added:0,already_wishlisted:2});assert.deepEqual(await entries(),after);
      const shared=await request('/api/shared/'+layout[0].share_token,{user:null});assert.equal(shared.status,200);assert.ok(!JSON.stringify(shared.data).includes('wishlist'));assert.ok(!JSON.stringify(shared.data).includes('preview_token'));
    });
    await t.test('an invalid target or injected ownership fields cannot partially update another printing',async()=>{
      const view=await preview(),before=await entries();
      assert.equal((await save(collection,payload(view,[holo,unplanned]))).status,409);
      for(const extra of [{user_id:seller},{quantity:10},{notes:'overwrite'}])assert.equal((await save(collection,payload(view,[holo],extra))).status,400);
      assert.deepEqual(await entries(),before);
    });
    await t.test('design checklist needs printing consent and bulk wishes never mark its pockets',async()=>{
      const view=await preview(design);assert.equal(view.binder.design_checklist,true);
      assert.equal((await save(design,payload(view,[holo]))).status,400);
      assert.equal((await save(design,payload(view,[holo],{confirm_displayed_printings:true}))).status,200);
      assert.equal((await sql`SELECT is_collected FROM binder_slots WHERE binder_id=${design}`)[0].is_collected,false);
    });
    await t.test('concurrent selections serialize; the stale selection cannot overwrite the newer wishlist',async()=>{
      await sql`UPDATE collection_entries SET wishlist=false,revision=revision+1 WHERE user_id=${owner} AND printing_id IN (${holo},${reverse})`;
      const view=await preview(),responses=await Promise.all([save(collection,payload(view,[holo])),save(collection,payload(view,[reverse]))]);
      assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);assert.equal((await entries()).filter(e=>e.wishlist).length,1);
      const fresh=await preview(),pending=fresh.items.filter(i=>!i.wishlist).map(i=>i.printing_id);assert.equal((await save(collection,payload(fresh,pending))).status,200);
    });
    await t.test('existing Collector, Pro, Free and tester permissions remain enforced on the new routes',async()=>{
      await sql`DELETE FROM account_access_grants WHERE user_id IN (${collector},${plus},${free})`;
      await sql`INSERT INTO account_tier_overrides(user_id,tier,reason) VALUES(${collector},'collector','Completion fixture'),(${plus},'plus','Completion fixture')`;
      await sql`INSERT INTO free_accounts(user_id) VALUES(${free})`;await sql`UPDATE account_memberships SET plan_code='free' WHERE user_id=${free}`;
      await sql`DELETE FROM stripe_billing_controls`;await sql`INSERT INTO stripe_billing_controls(environment,subscriptions_enabled,enforcement_enabled) VALUES('production',false,true)`;
      for(const [index,user] of [[2,collector],[3,plus],[4,free]]){
        const b=await makeBinder('tracking',user);await sql`INSERT INTO binder_slots(binder_id,position,printing_id) VALUES(${b},0,${holo})`;
        const view=await preview(b,index);assert.equal(view.permissions.can_add_wishlist,index===3);assert.equal(view.permissions.can_browse_marketplace,index!==4);
        assert.equal((await save(b,payload(view,[holo]),index)).status,index===3?200:403);
        assert.equal((await request(path(b)+'/matches?printing_id='+holo,{user:index})).status,index===4?403:200);
      }
      assert.equal((await preview()).permissions.can_add_wishlist,true,'protected testers keep access');
    });
  }finally{
    await sql`DELETE FROM stripe_billing_controls`;if(controls.length)await sql`INSERT INTO stripe_billing_controls ${sql(controls)}`;
    await sql`DELETE FROM audit_log WHERE user_id IN ${sql(users)}`;await sql`DELETE FROM app_users WHERE id IN ${sql(users)}`;
    if(printings.length)await sql`DELETE FROM printings WHERE id IN ${sql(printings)}`;
    if(cards.length)await sql`DELETE FROM cards WHERE id IN ${sql(cards)}`;
    if(sets.length)await sql`DELETE FROM card_sets WHERE id IN ${sql(sets)}`;
    await sql`DELETE FROM auth_attempts WHERE bucket IN ${sql(users.flatMap(id=>[digest('binder-completion-read:'+id),digest('binder-completion-write:'+id)]))}`;
    await sql.end();
  }
});
