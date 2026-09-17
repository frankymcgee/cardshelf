// Real PostgreSQL and application routes; provider data is injected. Never use a real key.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import '../helpers/block-payment-network.mjs';
import { db, closeDatabase } from '../../lib/db.mjs';
import { hashPassword, randomToken, digest } from '../../lib/security.mjs';
import { saveStripeConnection } from '../../lib/stripe-connection.mjs';
import { saveStripeProductSettings, syncStripeProducts, stripeProductStatus } from '../../lib/stripe-product-sync.mjs';
import { startStripeCheckout } from '../../lib/stripe-subscriptions.mjs';
import { publicSubscriptionOffers } from '../../lib/public-subscriptions.mjs';
import { saveDraftPlan } from '../../lib/platform.mjs';
import { productFixture } from '../helpers/stripe-product-fixture.mjs';
const url=process.env.TEST_BASE_URL;
if(process.env.ALLOW_TEST_DATABASE!=='yes'||!url||!new URL(process.env.DATABASE_URL||'http://invalid').pathname.endsWith('_test'))throw new Error('Use a disposable _test database only.');
const sql=db(),originalEnv={...process.env},origin=process.env.APP_ORIGIN||url;
const admin=randomUUID(),member=randomUUID(),password='Product integration password 123',token=randomToken(),memberToken=randomToken();
let f=productFixture('production'), fail=false, products=[],prices=[],calls=[],snapshotId=null;
const subscribers=[];
const beforePlans=await sql`SELECT * FROM membership_plans WHERE code IN ('collector','plus')`;
async function provider(cfg,path,_body=null,method='GET') {
  calls.push({path,method});assert.equal(method,'GET','Product sync must not create a payment or modify Stripe.');
  if(fail)throw new Error('Simulated network outage');
  if(path==='/v1/account')return {id:'acct_product_test',charges_enabled:true,business_profile:{name:'Product fixture'}};
  if(path==='/v1/balance')return {livemode:cfg.environment==='production'};
  if(path==='/v1/billing_portal/configurations/bpc_fixture')return f.portal;
  if(path.startsWith('/v1/products?'))return {data:products,has_more:false};
  if(path==='/v1/products/prod_collector')return structuredClone(f.product);
  if(path==='/v1/prices/price_month')return structuredClone(f.month);
  if(path==='/v1/prices/price_year')return structuredClone(f.year);
  if(path.startsWith('/v1/prices?'))return {data:prices,has_more:false};
  if(path==='/v1/tax/settings')return f.settings;
  if(path==='/v1/tax_rates/txr_products')return f.tax;
  throw new Error('Unexpected mocked request '+path);
}
async function request(path,user='admin',method='GET',body) {
  const r=await fetch(url+path,{method,headers:{Origin:origin,'X-Requested-With':'cardshelf',...(user===null?{}:{Cookie:'cardshelf_session='+(user==='admin'?token:memberToken)}),...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});
  const text=await r.text();let data;try{data=JSON.parse(text)}catch{data=text}return {status:r.status,data,headers:r.headers};
}
await test('Stripe-managed catalogue transactions, permissions and preserved membership state',async t=>{
 try {
  const hash=await hashPassword(password);
  for(const [id,role,session]of [[admin,'admin',token],[member,'user',memberToken]]){
   await sql`INSERT INTO app_users(id,email,name,password_hash,role) VALUES(${id},${'products-'+id+'@example.test'},'Product test account',${hash},${role})`;
   await sql`INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(${digest(session)},${id},now()+interval '1 hour')`;
  }
  process.env.CARDSHELF_INTEGRATION_KEY='ac'.repeat(32);process.env.STRIPE_ENVIRONMENT='production';process.env.STRIPE_BILLING_ENABLED='true';process.env.MEMBERSHIP_ENFORCEMENT_ENABLED='false';process.env.APP_ORIGIN='https://cardshelf.example.test';
  await saveStripeConnection(admin,'production',{revision:0,password,secret_key:'sk_live_'+'F'.repeat(32),webhook_secret:'whsec_'+'F'.repeat(32),portal_id:'bpc_fixture',accepting_new:true,confirm:true},provider);
  await t.test('new product endpoints return authenticated JSON and reject ordinary collectors',async()=>{
   for(const suffix of ['', '/settings','/sync']){const r=await request('/api/admin/integrations/stripe/products'+suffix+'?environment=production',null,suffix?'POST':'GET',suffix?{}:undefined);assert.equal(r.status,401);assert.match(r.headers.get('content-type'),/json/);}
   assert.equal((await request('/api/admin/integrations/stripe/products?environment=production','member')).status,403);
   assert.equal((await request('/api/admin/integrations/stripe/products?environment=production')).status,200);
   for(const route of ['/api/admin/integrations/stripe/status','/api/admin/integrations/stripe/controls','/api/billing/stripe/account'])assert.equal((await request(route,null)).status,401);
  });
  await t.test('sync starts disabled and requires an explicit password-confirmed opt-in',async()=>{
   assert.equal((await stripeProductStatus(admin,'production')).settings.managed,false);
   await assert.rejects(()=>syncStripeProducts(admin,'production',provider),e=>e.status===409);
   const input={revision:0,password,managed:true,daily:true,mirror_plans:true,confirm:true};
   await assert.rejects(()=>saveStripeProductSettings(member,'production',input),e=>e.status===403);
   await assert.rejects(()=>saveStripeProductSettings(admin,'production',{...input,password:'bad'}),e=>e.status===403);
   await assert.rejects(()=>saveStripeProductSettings(admin,'production',{...input,role:'admin'}),e=>e.status===400);
   await saveStripeProductSettings(admin,'production',input);
  });
  products=[f.product];prices=[f.month,f.year];
  await t.test('first sync groups monthly/yearly prices and mirrors only presentation data',async()=>{
   const result=await syncStripeProducts(admin,'production',provider);assert.equal(result.products,1);assert.equal(result.published_offers,2);assert.equal(result.payments_created,false);
   const rows=await sql`SELECT * FROM stripe_offers WHERE environment='production' AND sync_managed ORDER BY cadence`;
   assert.deepEqual(rows.map(o=>o.amount_minor).sort((a,b)=>a-b),[2000,22500]);assert.ok(rows.every(o=>o.published&&o.tax_mode==='automatic'));
   const [plan]=await sql`SELECT * FROM membership_plans WHERE code='collector'`;assert.equal(plan.stripe_managed,true);assert.equal(plan.name,'Collector');assert.equal(plan.monthly_price_minor,2000);assert.equal(plan.annual_price_minor,22500);assert.equal(plan.stripe_product.unit_label,'collector');
   assert.deepEqual(plan.stripe_product.marketing_features,f.product.marketing_features);
   const data=await publicSubscriptionOffers();assert.equal(data.offers.length,2);assert.equal(data.offers[0].product_snapshot.description,f.product.description);
   assert.ok(!JSON.stringify(data).includes('sk_live_'));assert.ok(!JSON.stringify(data).includes('metadata'));
  });
  await t.test('a repeat sync is idempotent and the next daily job is not due',async()=>{
   const before=await sql`SELECT id,revision FROM stripe_offers ORDER BY id`;
   const result=await syncStripeProducts(admin,'production',provider);assert.equal(result.updated_offers,0);
   assert.deepEqual(await sql`SELECT id,revision FROM stripe_offers ORDER BY id`,before);
   const count=calls.length;assert.equal((await syncStripeProducts(null,'production',provider,true)).skipped,true);assert.equal(calls.length,count);
  });
  await t.test('overlapping manual and daily jobs share a database lock, never two publications',async()=>{
   let enter,release;const entered=new Promise(resolve=>{enter=resolve}),wait=new Promise(resolve=>{release=resolve});let waiting=false;
   const slow=async(...args)=>{if(!waiting){waiting=true;enter();await wait}return provider(...args)};
   const running=syncStripeProducts(admin,'production',slow);
   try{await entered;const result=await syncStripeProducts(null,'production',provider,true);assert.equal(result.busy,true)}finally{release();await running}
   assert.equal((await sql`SELECT count(*)::integer AS n FROM stripe_offers WHERE published AND environment='production'`)[0].n,2);
  });
  await t.test('synced automatic-tax checkout retains consent and uncertain-request protection',async()=>{
   const id=randomUUID();subscribers.push(id);
   await sql`INSERT INTO app_users(id,email,name,password_hash) VALUES(${id},${'product-checkout-'+id+'@example.test'},'New subscriber fixture',${hash})`;
   await sql`DELETE FROM account_access_grants WHERE user_id=${id}`;
   const [offer]=await sql`SELECT * FROM stripe_offers WHERE price_id='price_month' AND environment='production'`;
   const body={offer_id:offer.id,revision:offer.revision,terms_hash:offer.terms_hash,request_id:randomUUID(),consent:true};
   let writes=0,checkout=null;
   const payment=async(cfg,path,data=null,method='GET')=>{
    if(method==='GET')return provider(cfg,path,data,method);
    writes++;
    if(path==='/v1/customers')return {id:'cus_product_uncertain',livemode:true};
    if(path==='/v1/checkout/sessions'){checkout=structuredClone(data);throw new Error('Unknown provider response after request was sent')}
    throw new Error('Unexpected payment request '+path);
   };
   const beforeDescription=f.product.description;f.product.description='Changed before new consent';
   await assert.rejects(()=>startStripeCheckout(id,body,payment),e=>e.status===409);
   assert.equal(writes,0);assert.equal((await sql`SELECT count(*)::integer AS n FROM stripe_subscriptions WHERE user_id=${id}`)[0].n,0);
   f.product.description=beforeDescription;
   const pending=await startStripeCheckout(id,body,payment);assert.equal(pending.pending,true);assert.equal(writes,2);
   assert.deepEqual(checkout.automatic_tax,{enabled:true});assert.equal(checkout.billing_address_collection,'required');assert.equal(checkout.customer_update.address,'auto');assert.equal(checkout.line_items[0].price,'price_month');assert.equal(checkout.line_items[0].tax_rates,undefined);
   f.product.description='Changed after uncertain checkout';
   const retry=await startStripeCheckout(id,body,payment);assert.equal(retry.id,pending.id);assert.equal(retry.pending,true);assert.equal(writes,2);
   assert.equal((await sql`SELECT current FROM stripe_subscriptions WHERE id=${pending.id}`)[0].current,true);
   await assert.rejects(()=>startStripeCheckout(id,{...body,request_id:randomUUID()},payment),e=>e.status===409);
   f.product.description=beforeDescription;
  });
  await t.test('existing subscription snapshots are immutable when marketing content changes',async()=>{
   const [o]=await sql`SELECT * FROM stripe_offers WHERE price_id='price_month' AND environment='production'`;
   snapshotId=randomUUID();await sql`INSERT INTO stripe_subscriptions(id,user_id,environment,request_id,offer_id,offer_snapshot,checkout_expires_at,current,status) VALUES(${snapshotId},${member},'production',${randomUUID()},${o.id},${sql.json(o)},now()+interval '1 hour',false,'expired')`;
   f.product.description='New description from Stripe';f.product.unit_label='member';f.product.marketing_features=[];
   await syncStripeProducts(admin,'production',provider);
   const [s]=await sql`SELECT offer_snapshot FROM stripe_subscriptions WHERE id=${snapshotId}`;assert.equal(s.offer_snapshot.product_snapshot.description,'Track every card in your collection.');
   const [latest]=await sql`SELECT product_snapshot,revision FROM stripe_offers WHERE id=${o.id}`;assert.equal(latest.product_snapshot.unit_label,'member');assert.deepEqual(latest.product_snapshot.marketing_features,[]);assert.ok(latest.revision>o.revision);
   assert.equal((await sql`SELECT kind FROM account_access_grants WHERE user_id=${member}`)[0].kind,'beta_tester');
  });
  await t.test('read-only mirrored plans cannot be overwritten through the legacy draft endpoint',async()=>{
   const [p]=await sql`SELECT * FROM membership_plans WHERE code='collector'`;
   await assert.rejects(()=>saveDraftPlan(admin,'collector',{revision:p.revision,name:'Wrong',description:'Wrong',monthly_price_minor:1,annual_price_minor:2}),e=>e.status===409);
  });
  await t.test('a network failure retains the complete previous catalogue and records retry health',async()=>{
   const before=await sql`SELECT id,revision,published FROM stripe_offers ORDER BY id`;fail=true;
   await assert.rejects(()=>syncStripeProducts(admin,'production',provider));fail=false;
   assert.deepEqual(await sql`SELECT id,revision,published FROM stripe_offers ORDER BY id`,before);
   const status=await stripeProductStatus(admin,'production');assert.ok(status.settings.last_error);assert.ok(status.settings.last_success_at);
  });
  await t.test('wrong-mode prices cannot look like an empty active catalogue',async()=>{
   const before=await sql`SELECT id,revision,published FROM stripe_offers ORDER BY id`;f.month.livemode=false;
   await assert.rejects(()=>syncStripeProducts(admin,'production',provider),e=>e.status===409);f.month.livemode=true;
   assert.deepEqual(await sql`SELECT id,revision,published FROM stripe_offers ORDER BY id`,before);
  });
  await t.test('an ambiguous catalogue cannot partially unpublish or reprice existing offers',async()=>{
   prices.push({...f.year,id:'price_duplicate_year'});const before=await sql`SELECT id,revision,published FROM stripe_offers ORDER BY id`;
   await assert.rejects(()=>syncStripeProducts(admin,'production',provider),e=>e.status===409);prices.pop();
   assert.deepEqual(await sql`SELECT id,revision,published FROM stripe_offers ORDER BY id`,before);
  });
  await t.test('archiving a price removes new purchases without deleting its historical record',async()=>{
   prices=[f.year];await syncStripeProducts(admin,'production',provider);
   const [old]=await sql`SELECT published FROM stripe_offers WHERE price_id='price_month'`;assert.equal(old.published,false);
   assert.equal((await sql`SELECT id FROM stripe_subscriptions WHERE id=${snapshotId}`).length,1);
  });
  await t.test('renaming a linked product preserves its tier; metadata cannot promote it to administrator',async()=>{
   f.product.name='Collect your way';await syncStripeProducts(admin,'production',provider);
   assert.equal((await sql`SELECT plan_code FROM stripe_products WHERE product_id='prod_collector'`)[0].plan_code,'collector');
   f.product.metadata.cardshelf_plan='admin';await assert.rejects(()=>syncStripeProducts(admin,'production',provider),e=>e.status===409);delete f.product.metadata.cardshelf_plan;
  });
  await t.test('a complete empty catalogue retires new offers but never deletes account data',async()=>{
   products=[];prices=[];await syncStripeProducts(admin,'production',provider);
   assert.equal((await sql`SELECT count(*)::integer AS n FROM stripe_offers WHERE published`)[0].n,0);
   assert.equal((await sql`SELECT count(*)::integer AS n FROM stripe_products WHERE active`)[0].n,0);
   assert.equal((await sql`SELECT kind FROM account_access_grants WHERE user_id=${member}`)[0].kind,'beta_tester');
  });
  await t.test('test-mode product sync never overwrites live platform plans',async()=>{
   f=productFixture('sandbox');products=[{...f.product,name:'Test Collector',metadata:{cardshelf_plan:'collector',cardshelf_tax_mode:'none'}}];prices=[f.month];
   await saveStripeConnection(admin,'sandbox',{revision:0,password,secret_key:'sk_test_'+'F'.repeat(32),webhook_secret:'whsec_'+'T'.repeat(32),portal_id:'bpc_fixture',accepting_new:false,confirm:true},provider);
   await assert.rejects(()=>saveStripeProductSettings(admin,'sandbox',{revision:0,password,managed:true,daily:false,mirror_plans:true,confirm:true}),e=>e.status===400);
   const before=await sql`SELECT * FROM membership_plans ORDER BY code`;
   await saveStripeProductSettings(admin,'sandbox',{revision:0,password,managed:true,daily:false,mirror_plans:false,confirm:true});
   await syncStripeProducts(admin,'sandbox',provider);assert.deepEqual(await sql`SELECT * FROM membership_plans ORDER BY code`,before);
   assert.equal((await publicSubscriptionOffers()).offers.length,0);assert.ok(calls.every(c=>c.method==='GET'));
  });
 }finally{
  if(snapshotId)await sql`DELETE FROM stripe_subscriptions WHERE id=${snapshotId}`;
  for(const id of subscribers){await sql`DELETE FROM stripe_subscriptions WHERE user_id=${id}`;await sql`DELETE FROM stripe_customers WHERE user_id=${id}`;await sql`DELETE FROM app_users WHERE id=${id}`;}
  await sql`DELETE FROM stripe_products WHERE environment IN ('production','sandbox')`;
  await sql`DELETE FROM stripe_product_sync WHERE environment IN ('production','sandbox')`;
  await sql`DELETE FROM stripe_offers WHERE price_id IN ('price_month','price_year')`;
  await sql`DELETE FROM stripe_connections WHERE account_id='acct_product_test'`;
  for(const p of beforePlans)await sql`UPDATE membership_plans SET name=${p.name},description=${p.description},monthly_price_minor=${p.monthly_price_minor},annual_price_minor=${p.annual_price_minor},revision=${p.revision},updated_at=${p.updated_at},stripe_managed=${p.stripe_managed},stripe_product=${sql.json(p.stripe_product)},stripe_synced_at=${p.stripe_synced_at} WHERE code=${p.code}`;
  await sql`DELETE FROM app_users WHERE id IN (${admin},${member})`;
  for(const key of Object.keys(process.env))if(!(key in originalEnv))delete process.env[key];Object.assign(process.env,originalEnv);await closeDatabase();
 }
});
