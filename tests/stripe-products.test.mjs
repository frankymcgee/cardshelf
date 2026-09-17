import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { productImage, productPresentation, productGroups, offerTaxLabel } from '../shared/stripe-products.mjs';
import { productPlan, productOffer, selectProductPrices, readStripePages, automaticTaxBehavior, syncDue, PRODUCT_INTERVAL_MS } from '../lib/stripe-product-logic.mjs';
import { verifyStripeOffer } from '../lib/stripe-offer-verification.mjs';
import { stripeRequest } from '../lib/stripe-client.mjs';
import { productFixture } from './helpers/stripe-product-fixture.mjs';
const offer = f => productOffer(f.product, f.month, 'sandbox', 'collector', f.settings);
test('Stripe product presentation includes every requested customer-facing field only', () => {
  const f = productFixture(); f.product.metadata.secret = 'private';
  const d = productPresentation(f.product);
  assert.deepEqual(Object.keys(d), ['id','name','description','unit_label','images','marketing_features']);
  for (const k of ['name','description','unit_label','images','marketing_features']) assert.deepEqual(d[k], f.product[k]);
  assert.ok(!JSON.stringify(d).includes('private'));
});
test('clearing optional Stripe fields removes them rather than retaining stale copy', () => {
  assert.deepEqual(productPresentation({ name: 'Collector' }), { id:'',name:'Collector',description:'',unit_label:'',images:[],marketing_features:[] });
});
test('presentation payloads are bounded', () => {
  const d = productPresentation({ name:'x'.repeat(300),description:'d'.repeat(5000),unit_label:'z'.repeat(100),marketing_features:Array(100).fill({name:'f'.repeat(300)}),images:Array(20).fill('https://files.stripe.com/ok') });
  assert.equal(d.name.length,250);assert.equal(d.description.length,2000);assert.equal(d.unit_label.length,80);assert.equal(d.marketing_features.length,15);assert.equal(d.images.length,8);
});
for (const url of ['http://files.stripe.com/x','https://files.stripe.com.evil.test/x','https://user:pass@files.stripe.com/x','https://files.stripe.com:8443/x','javascript:alert(1)','data:image/svg+xml,x','https://127.0.0.1/x','https://evil.test/x','//files.stripe.com/x']) {
  test('unsafe or unapproved product image is not rendered: '+url,()=>assert.equal(productImage(url),''));
}
for (const url of ['https://files.stripe.com/links/a','https://stripe-camo.global.ssl.fastly.net/a']) test('Stripe image host is accepted: '+url,()=>assert.equal(productImage(url),url));
for (const [name,expected] of [['Collector','collector'],[' Collector Plus ','plus'],['collector plus','plus'],['Gold',null],['constructor',null],['__proto__',null]]) test('product mapping: '+name,()=>assert.equal(productPlan({name}),expected));
test('custom names use explicit Stripe metadata and linked renames keep their mapping',()=>{
  assert.equal(productPlan({name:'Gold',metadata:{cardshelf_plan:'plus'}}),'plus');
  assert.equal(productPlan({name:'My renamed product'},'collector'),'collector');
});
for (const tier of ['admin','complimentary','testing','PLUS']) test('metadata cannot create a privileged or unknown plan '+tier,()=>assert.throws(()=>productPlan({metadata:{cardshelf_plan:tier}})));
test('marketing features and authentication metadata do not grant capabilities',()=>assert.equal(productPlan({name:'Collector',metadata:{role:'admin'},marketing_features:[{name:'Administrator access'}]}),'collector'));
test('a previously linked product cannot silently move between tiers',()=>assert.throws(()=>productPlan({metadata:{cardshelf_plan:'plus'}},'collector')));
test('Stripe-side ignore explicitly excludes a product',()=>assert.equal(productPlan({metadata:{cardshelf_plan:'ignore'}},'collector'),null));
test('screenshot-style product selects AUD 20 monthly and AUD 225 yearly, not the archived price',()=>{
  const f=productFixture(),r=selectProductPrices(f.product,[f.archived,f.year,f.month],'sandbox');
  assert.deepEqual(r.map(p=>[p.id,p.unit_amount]),[['price_month',2000],['price_year',22500]]);
});
test('default monthly price does not displace the separate annual price',()=>{
  const f=productFixture(),r=selectProductPrices(f.product,[{...f.month,id:'price_other'},f.year,f.month],'sandbox');assert.deepEqual(r.map(p=>p.id),['price_month','price_year']);
});
test('ambiguous same-cadence prices fail instead of guessing newest or cheapest',()=>{
  const f=productFixture();f.product.default_price=null;assert.throws(()=>selectProductPrices(f.product,[f.month,{...f.month,id:'price_second'}],'sandbox'));
});
test('Stripe metadata can choose the displayed monthly price explicitly',()=>{
  const f=productFixture();f.product.metadata.cardshelf_monthly_price='price_other';assert.equal(selectProductPrices(f.product,[f.month,{...f.month,id:'price_other'}],'sandbox')[0].id,'price_other');
});
for (const value of ['price_missing','price_archived','../wrong']) test('unavailable selected price fails: '+value,()=>{
  const f=productFixture();f.product.metadata.cardshelf_monthly_price=value;assert.throws(()=>selectProductPrices(f.product,[f.month,f.archived],'sandbox'));
});
for (const changes of [{currency:'usd'},{livemode:true},{unit_amount:0},{type:'one_time'},{billing_scheme:'tiered'},{transform_quantity:{divide_by:10}}]) test('unsupported recurring price excluded: '+JSON.stringify(changes),()=>{
  const f=productFixture();assert.deepEqual(selectProductPrices(f.product,[{...f.month,...changes}],'sandbox'),[]);
});
test('automatic tax copies explicit behavior and has a dynamic checkout tax label',()=>{
  const f=productFixture(),o=offer(f);assert.equal(o.tax_mode,'automatic');assert.equal(o.tax_behavior,'inclusive');assert.equal(o.total_minor,2000);assert.match(offerTaxLabel(o),/applicable tax/);
  f.month.tax_behavior='exclusive';assert.match(offerTaxLabel(offer(f)),/^Plus/);
});
test('AUD follows the Stripe currency-inferred inclusive default',()=>{
  assert.equal(automaticTaxBehavior({tax_behavior:'unspecified'},{defaults:{tax_behavior:'inferred_by_currency'}}),'inclusive');
});
for (const edit of [f=>f.settings=null,f=>f.settings.status='pending',f=>f.settings.livemode=true,f=>{f.product.tax_code=null;f.settings.defaults.tax_code=null},f=>{f.month.tax_behavior='unspecified';f.settings.defaults.tax_behavior=null}]) test('incomplete automatic-tax setup fails without a zero-tax fallback',()=>{const f=productFixture();edit(f);assert.throws(()=>offer(f));});
test('fixed inclusive tax uses the explicitly selected Stripe tax rate',()=>{
  const f=productFixture();f.product.metadata={cardshelf_tax_mode:'fixed',cardshelf_tax_rate:f.tax.id};
  const o=productOffer(f.product,f.month,'sandbox','collector',null,f.tax);assert.equal(o.total_minor,2000);assert.equal(o.tax_minor,182);assert.equal(o.tax_rate_id,'txr_products');
});
test('fixed exclusive tax is added in exact cents',()=>{
  const f=productFixture();f.month.tax_behavior='exclusive';f.tax.inclusive=false;f.product.metadata={cardshelf_tax_mode:'fixed',cardshelf_tax_rate:f.tax.id};
  assert.equal(productOffer(f.product,f.month,'sandbox','collector',null,f.tax).total_minor,2200);
});
test('fixed rate and price tax behavior must agree',()=>{
  const f=productFixture();f.tax.inclusive=false;f.product.metadata={cardshelf_tax_mode:'fixed',cardshelf_tax_rate:f.tax.id};assert.throws(()=>productOffer(f.product,f.month,'sandbox','collector',null,f.tax));
});
test('none is an explicit no-tax policy, never inferred from missing API permission',()=>{
  const f=productFixture();f.product.metadata.cardshelf_tax_mode='none';const o=offer(f);assert.equal(o.tax_minor,0);assert.equal(o.tax_mode,'none');assert.match(offerTaxLabel(o),/No tax collected/);
});
for (const changes of [{active:false},{livemode:true},{id:'prod_../bad'}]) test('inactive or malformed product cannot publish: '+JSON.stringify(changes),()=>{const f=productFixture();Object.assign(f.product,changes);assert.throws(()=>offer(f));});
test('a price from another product cannot be reused',()=>{const f=productFixture();f.month.product='prod_other';assert.throws(()=>offer(f));});
test('identical sync values have an identical hash and marketing edits change the new-offer revision identity',()=>{
  const f=productFixture(),first=offer(f);assert.equal(first.sync_hash,offer(f).sync_hash);f.product.description='An updated description';assert.notEqual(first.sync_hash,offer(f).sync_hash);assert.equal(first.product_snapshot.description,'Track every card in your collection.');
});
test('monthly and annual offers group under one displayed product',()=>{
  const f=productFixture(),r=productGroups([offer(f),productOffer(f.product,f.year,'sandbox','collector',f.settings)]);assert.equal(r.length,1);assert.equal(r[0].offers.length,2);assert.equal(r[0].product.unit_label,'collector');
});
test('pagination reads every page using a safe cursor',async()=>{
  const paths=[];const rows=await readStripePages({},'/v1/products?limit=100','prod',async(_cfg,path)=>{paths.push(path);return paths.length===1?{data:[{id:'prod_a'}],has_more:true}:{data:[{id:'prod_b'}],has_more:false}});
  assert.equal(rows.length,2);assert.match(paths[1],/starting_after=prod_a$/);
});
for (const page of [{data:[],has_more:true},{data:[{id:'prod_a'}]},null,{data:'bad',has_more:false}]) test('malformed pagination cannot masquerade as a complete catalogue',async()=>assert.rejects(()=>readStripePages({},'/v1/products?limit=100','prod',async()=>page)));
test('duplicate pages and page caps fail atomically',async()=>{
  await assert.rejects(()=>readStripePages({},'/v1/products?limit=100','prod',async()=>({data:[{id:'prod_a'}],has_more:true})));
  let i=0;await assert.rejects(()=>readStripePages({},'/v1/products?limit=100','prod',async()=>({data:[{id:'prod_'+(++i)}],has_more:true}),2));assert.equal(i,2);
});
test('daily scheduling is opted in and based on a full 24-hour interval',()=>{
  assert.equal(PRODUCT_INTERVAL_MS,86400000);assert.equal(syncDue(null),false);assert.equal(syncDue({managed:true,daily:false}),false);
  const now=Date.now();assert.equal(syncDue({managed:true,daily:true,next_sync_at:new Date(now+1).toISOString()},now),false);assert.equal(syncDue({managed:true,daily:true,next_sync_at:new Date(now).toISOString()},now),true);
});
test('checkout verification detects archived products and changed marketing terms using only GET',async()=>{
  const f=productFixture(),o=offer(f),cfg={environment:'sandbox'};const api=async(_cfg,path)=>{
    if(path==='/v1/prices/price_month')return f.month;if(path==='/v1/products/prod_collector')return f.product;if(path==='/v1/tax/settings')return f.settings;throw new Error(path);
  };
  assert.equal((await verifyStripeOffer(cfg,o,api)).price_id,o.price_id);f.product.description='Changed';await assert.rejects(()=>verifyStripeOffer(cfg,o,api));f.product.active=false;await assert.rejects(()=>verifyStripeOffer(cfg,o,api));
});
test('product/tax API paths parse correctly and cannot be used for provider writes',async()=>{
  for(const path of ['/v1/products','/v1/products/prod_a','/v1/tax/settings'])await assert.rejects(()=>stripeRequest({secret:'fixture'},path,{},'POST'));
  const previous=globalThis.fetch,seen=[];globalThis.fetch=async(url,options)=>{seen.push({url,method:options.method});return new Response('{"ok":true}',{status:200})};
  try{for(const path of ['/v1/products?limit=100','/v1/tax/settings'])assert.equal((await stripeRequest({secret:'fixture'},path)).ok,true);assert.ok(seen.every(x=>x.method==='GET'&&x.url.startsWith('https://api.stripe.com/')))}finally{globalThis.fetch=previous}
});
test('migration never rewrites accounts, grants or existing subscription snapshots',async()=>{
  const sql=await readFile(new URL('../migrations/011_stripe_product_sync.sql',import.meta.url),'utf8');
  assert.doesNotMatch(sql,/(?:UPDATE|DELETE FROM|DROP TABLE|TRUNCATE)\s+(?:app_users|account_access_grants|stripe_subscriptions|account_tier_overrides)/i);
  assert.match(sql,/managed boolean NOT NULL DEFAULT false/);assert.match(sql,/NOT mirror_plans OR environment = 'production'/);
});
test('Stripe product UI renders text rather than trusting remote HTML',async()=>{
  for(const path of ['app/pages/pricing.vue','app/components/StripeMembership.vue','app/components/StripeProductSync.vue'])assert.doesNotMatch(await readFile(new URL('../'+path,import.meta.url),'utf8'),/v-html|innerHTML/);
});

test('null legacy presentation values remain safe and do not invent marketing features',()=>{
  assert.deepEqual(productPresentation(null),productPresentation({}));
  assert.deepEqual(productGroups([{plan_code:'collector',product_snapshot:null}])[0].product.marketing_features,[]);
});
test('new checkout validates synced offers before saving a new intent, without releasing uncertain retries',async()=>{
  const source=await readFile(new URL('../lib/stripe-subscriptions.mjs',import.meta.url),'utf8');
  assert.ok(source.indexOf('await verifyStripeOffer(cfg,offer,api)')<source.indexOf('INSERT INTO stripe_subscriptions'));
  assert.doesNotMatch(source,/current=false,last_error='The offer changed/);
  assert.match(source,/Date\.now\(\)-Date\.parse\(row\.created_at\)<23\*3600000/);
});
