// Synthetic private records only. No provider calls or notification delivery.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db,closeDatabase } from '../../lib/db.mjs';
import { randomToken,digest } from '../../lib/security.mjs';
import { storePricing } from '../../lib/prices.mjs';
import { reconcileProviderPrintings } from '../../lib/printing-availability.mjs';
import { evaluateWishlistAlert } from '../../lib/wishlist-alerts.mjs';
const base=process.env.TEST_BASE_URL;
if(process.env.ALLOW_TEST_DATABASE!=='yes'||!base||!new URL(process.env.DATABASE_URL||'http://invalid').pathname.endsWith('_test'))throw Error('Use only a disposable _test database.');
const sql=db(),owner=randomUUID(),other=randomUUID(),tokens=[randomToken(),randomToken()],provider='rollout-'+randomUUID().replaceAll('-','');
const set='en:'+provider,card=set+'-001',day=new Date().toISOString().slice(0,10),savedRates=await sql`SELECT * FROM price_fx_rates`;
async function request(path,{method='GET',body,user=0}={}) {
  const response=await fetch(base+'/api/'+path,{method,headers:{Origin:process.env.APP_ORIGIN||base,'X-Requested-With':'cardshelf',...(user===null?{}:{Cookie:'cardshelf_session='+tokens[user]}),...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});
  return {status:response.status,data:await response.json()};
}
async function ok(path,options){const r=await request(path,options);assert.equal(r.status,200,JSON.stringify(r.data));return r.data;}
await test('collector rollout preserves inventory, layout, private costs and wishlist matching',async t=>{
  let p,h,r,binder,share,lot,alert;
  try {
    for(const [i,id] of [owner,other].entries()) {
      await sql`INSERT INTO app_users(id,email,name,password_hash,role) VALUES(${id},${id+'@example.test'},'Rollout fixture','synthetic unused hash',${i?'user':'admin'})`;
      await sql`INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(${digest(tokens[i])},${id},now()+interval '1 hour')`;
    }
    await sql`INSERT INTO card_sets(id,provider_id,language,name) VALUES(${set},${provider},'en','Rollout fixture')`;
    await sql`INSERT INTO cards(id,provider_id,set_id,language,local_id,name) VALUES(${card},${provider+'-001'},${set},'en','001','Rollout card')`;
    await sql.begin(tx=>reconcileProviderPrintings(tx,card,{normal:true,holo:true,reverse:true}));
    const printings=await sql`SELECT * FROM printings WHERE card_id=${card}`;
    p=printings.find(p=>p.key==='normal');h=printings.find(p=>p.key==='holo');r=printings.find(p=>p.key==='reverse');
    await sql`INSERT INTO collection_entries(user_id,printing_id,condition,quantity,wishlist) VALUES(${owner},${p.id},'NM',3,true),(${owner},${h.id},'LP',1,false)`;
    await sql`INSERT INTO price_fx_rates(currency,aud_rate,rate_date) VALUES('USD',1.5,${day}) ON CONFLICT(currency) DO UPDATE SET aud_rate=1.5,rate_date=excluded.rate_date`;
    await storePricing(card,{tcgplayer:{unit:'USD',updated:new Date().toISOString(),normal:{marketPrice:10}}});
    await t.test('blank inside cover is a preference, and compaction preserves repeated printings and quantities',async()=>{
      binder=await ok('binders',{method:'POST',body:{title:'Right-hand start',columns:3,rows:3,page_count:3,start_on_right:true,compact_on_remove:true}});
      assert.equal(binder.start_on_right,true);
      for(const [position,printing] of [[0,p.id],[4,h.id],[9,p.id],[20,r.id]])await sql`INSERT INTO binder_slots(binder_id,position,printing_id) VALUES(${binder.id},${position},${printing})`;
      await ok('binders/'+binder.id+'/slots',{method:'POST',body:{action:'clear',target:4,revision:binder.revision}});
      const fresh=await ok('binders/'+binder.id);assert.deepEqual(fresh.slots.map(s=>s.position),[0,1,2]);assert.deepEqual(fresh.slots.map(s=>s.printing_id),[p.id,p.id,r.id]);
      assert.equal((await sql`SELECT quantity FROM collection_entries WHERE user_id=${owner} AND printing_id=${p.id}`)[0].quantity,3);
      const shared=await ok('binders/'+binder.id+'/share',{method:'POST',body:{enabled:true,revision:fresh.revision}});
      share=(await ok('binders/'+binder.id)).share_token;
      const publicBinder=await ok('shared/'+share,{user:null});assert.equal(publicBinder.start_on_right,true);assert.equal('owned' in publicBinder.slots[0],false);
      assert.equal((await request('binders',{method:'POST',body:{title:'Invalid tracker',columns:3,rows:3,page_count:1,binder_type:'tracking',compact_on_remove:true}})).status,400);
      assert.equal(shared!==undefined,true);
    });
    await t.test('stale removals cannot compact twice',async()=>{
      const b=await ok('binders/'+binder.id),body={action:'clear',target:1,revision:b.revision};
      const results=await Promise.all([request('binders/'+binder.id+'/slots',{method:'POST',body}),request('binders/'+binder.id+'/slots',{method:'POST',body})]);
      assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
      assert.deepEqual((await ok('binders/'+binder.id)).slots.map(s=>s.printing_id),[p.id,r.id]);
    });
    await t.test('provider corrections retire stale flags, preserve records and retain admin overrides across imports',async()=>{
      await sql.begin(tx=>reconcileProviderPrintings(tx,card,{normal:true,holo:false,reverse:true}));
      await sql.begin(tx=>reconcileProviderPrintings(tx,card,null));
      assert.equal((await sql`SELECT id FROM printings WHERE card_id=${card} AND key='unspecified'`).length,0,'Missing flags must not invent another printing.');
      assert.equal((await sql`SELECT catalogue_available FROM printings WHERE id=${h.id}`)[0].catalogue_available,false);
      assert.equal((await sql`SELECT quantity FROM collection_entries WHERE user_id=${owner} AND printing_id=${h.id}`)[0].quantity,1);
      const corrected=await ok('cards/'+card+'/printings/'+h.id,{method:'PATCH',body:{available:false,revision:1}});
      await sql.begin(tx=>reconcileProviderPrintings(tx,card,{normal:true,holo:true,reverse:true}));
      assert.equal((await sql`SELECT catalogue_available FROM printings WHERE id=${h.id}`)[0].catalogue_available,false);
      const catalogue=await ok('catalogue?q=Rollout');assert.deepEqual(catalogue.items[0].visual_printings.map(p=>p.key).sort(),['normal','reverse']);
      assert.equal((await request('cards/'+card+'/printings/'+h.id,{method:'PATCH',body:{available:null,revision:1}})).status,409);
      assert.equal((await request('cards/'+card+'/printings/'+h.id,{method:'PATCH',user:1,body:{available:true,revision:corrected.availability_revision}})).status,403);
      assert.equal((await request('binders/'+binder.id+'/slots',{method:'POST',body:{action:'place',target:4,printing_id:h.id,revision:(await ok('binders/'+binder.id)).revision}})).status,400);
    });
    await t.test('purchase retries are atomic, unknown costs stay unknown and unrealised gains use only costed copies',async()=>{
      const body={request_id:randomUUID(),printing_id:p.id,condition:'NM',quantity:2,acquired_on:day,goods_minor:1001,postage_minor:0,currency:'AUD',entry_revision:1};
      const responses=await Promise.all([ok('portfolio/costs',{method:'POST',body}),ok('portfolio/costs',{method:'POST',body})]);
      assert.equal(responses[0].lot.id,responses[1].lot.id);lot=responses[0].lot;
      const summary=await ok('portfolio/costs');assert.equal(summary.tracked_quantity,2);assert.equal(summary.unknown_cost_quantity,2);assert.equal(summary.cost_aud_minor,1001);assert.equal(summary.market_aud_minor,3000);assert.equal(summary.unrealized_aud_minor,1999);
      assert.equal((await request('portfolio/costs',{method:'POST',body:{...body,goods_minor:2000}})).status,409);
      const edit=await request('collection',{method:'PUT',body:{printing_id:p.id,condition:'NM',quantity:1,wishlist:true,notes:'',revision:1}});assert.equal(edit.status,409,JSON.stringify(edit.data));
      assert.equal((await sql`SELECT quantity FROM collection_entries WHERE user_id=${owner} AND printing_id=${p.id}`)[0].quantity,3);
    });
    await t.test('a sale removes copies once, deducts fees and reconciles cost cents',async()=>{
      const body={request_id:randomUUID(),action:'sale',revision:lot.revision,entry_revision:1,quantity:1,sold_on:day,gross_minor:1200,fees_minor:100,postage_minor:200,currency:'AUD'};
      const result=await ok('portfolio/costs/'+lot.id,{method:'POST',body});assert.equal(Number(result.sale.net_aud_minor),900);assert.equal(Number(result.sale.cost_aud_minor),501);lot=result.lot;
      await ok('portfolio/costs/'+lot.id,{method:'POST',body});
      const summary=await ok('portfolio/costs');assert.equal(summary.realized_aud_minor,399);assert.equal(summary.cost_aud_minor,500);assert.equal(summary.sold_quantity,1);
      const ledger=await ok('portfolio/costs?printing_id='+p.id);assert.equal(ledger.entries[0].quantity,2);assert.equal(ledger.sales.length,1);
      assert.equal((await request('portfolio/costs/'+lot.id,{method:'POST',user:1,body:{request_id:randomUUID(),action:'release',revision:lot.revision}})).status,404);
    });
    await t.test('releasing costs preserves inventory and realised history; adding a purchase adds copies exactly once',async()=>{
      await ok('portfolio/costs/'+lot.id,{method:'POST',body:{request_id:randomUUID(),action:'release',revision:lot.revision}});
      let ledger=await ok('portfolio/costs?printing_id='+p.id);assert.equal(ledger.entries[0].quantity,2);assert.equal(ledger.lots[0].remaining_quantity,0);
      const body={request_id:randomUUID(),printing_id:p.id,condition:'NM',quantity:1,acquired_on:day,goods_minor:0,currency:'AUD',entry_revision:ledger.entries[0].revision,add_to_collection:true};
      const first=await ok('portfolio/costs',{method:'POST',body});await ok('portfolio/costs',{method:'POST',body});ledger=await ok('portfolio/costs?printing_id='+p.id);assert.equal(ledger.entries[0].quantity,3);assert.equal(ledger.lots.length,2);assert.equal(Number(first.lot.cost_aud_minor),0);
      assert.equal((await ok('portfolio/costs')).realized_aud_minor,399);
      const publicBinder=await ok('shared/'+share,{user:null});assert.equal(JSON.stringify(publicBinder).includes('cost_aud_minor'),false);
      assert.equal((await request('portfolio/costs',{user:null})).status,401);assert.deepEqual((await ok('portfolio/costs?printing_id='+p.id,{user:1})).lots,[]);
    });
    await t.test('alerts match exact printing, include postage and filter condition, ownership and visibility',async()=>{
      alert=await ok('wishlist-alerts',{method:'POST',body:{printing_id:p.id,revision:0,target_aud_minor:2000,watch_market:true,watch_listings:true,conditions:['NM'],enabled:true}});
      for(const data of [{seller:other,condition:'NM',price:1000,postage:200,hidden:false,printing:p.id},{seller:owner,condition:'NM',price:1000,postage:0,hidden:false,printing:p.id},{seller:other,condition:'LP',price:1000,postage:0,hidden:false,printing:p.id},{seller:other,condition:'NM',price:1900,postage:200,hidden:false,printing:p.id},{seller:other,condition:'NM',price:1000,postage:0,hidden:true,printing:p.id},{seller:other,condition:'NM',price:1000,postage:0,hidden:false,printing:r.id}])
        await sql`INSERT INTO marketplace_listings(seller_id,request_id,input_hash,printing_id,seller_alias,condition,price_minor,delivery,postage_minor,region,description,hidden) VALUES(${data.seller},${randomUUID()},'fixture',${data.printing},'Fixture seller',${data.condition},${data.price},'postage',${data.postage},'WA','Synthetic listing for tests only.',${data.hidden})`;
      await evaluateWishlistAlert(alert.id);
      const inbox=await ok('wishlist-alerts');assert.equal(inbox.events.length,2);assert.equal(inbox.unread,2);assert.deepEqual(inbox.events.map(e=>e.amount_aud_minor).sort(),[1200,1500]);
      const event=inbox.events[0];assert.equal((await request('wishlist-alerts/'+event.id+'/seen',{method:'POST',body:{},user:1})).status,404);await ok('wishlist-alerts/'+event.id+'/seen',{method:'POST',body:{}});assert.equal((await ok('wishlist-alerts')).unread,1);
    });
    await t.test('repeated checks and missing quotes do not duplicate or re-arm market alerts',async()=>{
      const tick=async()=>{await sql`UPDATE wishlist_alerts SET checked_at=NULL WHERE id=${alert.id}`;await evaluateWishlistAlert(alert.id);};
      await tick();assert.equal((await ok('wishlist-alerts')).events.length,2);
      await sql`UPDATE card_price_cache SET last_error='fixture failure' WHERE card_id=${card}`;await tick();
      await storePricing(card,{tcgplayer:{unit:'USD',updated:new Date().toISOString(),normal:{marketPrice:10}}});await tick();assert.equal((await ok('wishlist-alerts')).events.length,2);
      await storePricing(card,{tcgplayer:{unit:'USD',updated:new Date().toISOString(),normal:{marketPrice:20}}});await tick();
      await storePricing(card,{tcgplayer:{unit:'USD',updated:new Date().toISOString(),normal:{marketPrice:10}}});await tick();assert.equal((await ok('wishlist-alerts')).events.length,3);
    });
    await t.test('removing a wish pauses checks without deleting the saved rule or exposing its inbox',async()=>{
      await sql`UPDATE collection_entries SET wishlist=false WHERE user_id=${owner} AND printing_id=${p.id}`;
      await sql`UPDATE wishlist_alerts SET checked_at=NULL,market_matched=false WHERE id=${alert.id}`;await evaluateWishlistAlert(alert.id);
      assert.equal((await ok('wishlist-alerts')).events.length,3);assert.equal((await ok('wishlist-alerts')).rules[0].wishlisted,false);assert.deepEqual((await ok('wishlist-alerts',{user:1})).events,[]);
      assert.equal((await request('wishlist-alerts',{method:'POST',body:{printing_id:p.id,revision:alert.revision,target_aud_minor:1900,watch_market:true,watch_listings:false,conditions:['NM'],enabled:true}})).status,409);
    });
    await t.test('lost access pauses scheduled checks and rejects new financial writes',async()=>{
      await sql`UPDATE collection_entries SET wishlist=true WHERE user_id=${owner} AND printing_id=${p.id}`;
      await sql`UPDATE app_users SET role='user' WHERE id=${owner}`;
      await sql`DELETE FROM account_access_grants WHERE user_id=${owner}`;
      await sql`INSERT INTO free_accounts(user_id) VALUES(${owner})`;
      await sql`UPDATE wishlist_alerts SET checked_at=NULL,market_matched=false WHERE id=${alert.id}`;
      await evaluateWishlistAlert(alert.id);
      assert.equal((await sql`SELECT count(*)::integer AS n FROM wishlist_alert_events WHERE user_id=${owner}`)[0].n,3);
      assert.equal((await request('portfolio/costs',{method:'POST',body:{request_id:randomUUID(),printing_id:p.id,condition:'NM',quantity:1,acquired_on:day,goods_minor:100,currency:'AUD',entry_revision:3}})).status,403);
      await sql`DELETE FROM free_accounts WHERE user_id=${owner}`;
      await sql`UPDATE app_users SET role='admin' WHERE id=${owner}`;
    });
  } finally {
    await sql`DELETE FROM app_users WHERE id IN ${sql([owner,other])}`;
    await sql`DELETE FROM printings WHERE card_id=${card}`;
    await sql`DELETE FROM cards WHERE id=${card}`;
    await sql`DELETE FROM card_sets WHERE id=${set}`;
    await sql`DELETE FROM price_fx_rates`;for(const row of savedRates)await sql`INSERT INTO price_fx_rates ${sql(row)}`;
    await closeDatabase();
  }
});
