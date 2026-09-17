// Mocked provider responses + real PostgreSQL/application APIs. Never contact financial providers.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHmac} from 'node:crypto';
import '../helpers/block-payment-network.mjs';
import {stripeFixture} from '../helpers/stripe-fixtures.mjs';
import {db,closeDatabase} from '../../lib/db.mjs';
import {hashPassword,randomToken,digest} from '../../lib/security.mjs';
import {stripePolicy,stripeSignature} from '../../lib/stripe-logic.mjs';
import {saveStripeConnection,stripeStatus,saveStripeOffer,publishStripeOffer} from '../../lib/stripe-connection.mjs';
import {startStripeCheckout,syncStripeSubscription,stripePortal,cancelStripeSubscription} from '../../lib/stripe-subscriptions.mjs';
import {receiveStripeWebhook} from '../../lib/stripe-webhooks.mjs';
import {membershipState} from '../../lib/membership.mjs';
import {approveReferralPartner,referralConsent,claimReferral,approveCommission,recordReferralPayout,referralAccount} from '../../lib/subscription-referrals.mjs';
const url=process.env.TEST_BASE_URL;
if(process.env.ALLOW_TEST_DATABASE!=='yes'||!url||!new URL(process.env.DATABASE_URL||'http://invalid').pathname.endsWith('_test'))throw new Error('Only a disposable _test database may run these tests.');
const sql=db(),origin=process.env.APP_ORIGIN||url,admin=randomUUID(),member=randomUUID(),partner=randomUUID(),tester=randomUUID();
const tokens=[randomToken(),randomToken(),randomToken(),randomToken()],ids=[admin,member,partner,tester],password='Stripe contract tests password 123';
const squareOfferId=randomUUID();
const originalEnv={...process.env},key='sk_live_'+'T'.repeat(32),webhook='whsec_'+'W'.repeat(32);let rowId,offer,body;
let f=stripeFixture('production'),sessionsCreated=0;const calls=[];
async function api(cfg,path,data=null,method='GET',idempotency=null){
 calls.push({path,method,idempotency});
 if(path==='/v1/account')return {id:'acct_fixture',charges_enabled:true,business_profile:{name:'Fixture business'}};
 if(path==='/v1/balance')return {livemode:cfg.environment==='production'};
 if(path==='/v1/billing_portal/configurations/bpc_fixture')return structuredClone(f.portal);
 if(path==='/v1/prices/price_fixture')return structuredClone(f.price);
 if(path==='/v1/customers'&&method==='POST')return {id:'cus_fixture',livemode:true};
 if(path==='/v1/checkout/sessions'&&method==='POST'){sessionsCreated++;f.session.client_reference_id=data.client_reference_id;f.session.metadata=data.metadata;f.sub.metadata=data.subscription_data.metadata;return {...structuredClone(f.session),status:'open',subscription:null};}
 if(path==='/v1/checkout/sessions/cs_fixture')return structuredClone(f.session);
 if(path==='/v1/subscriptions/sub_fixture'){
   if(method==='POST')f.sub.cancel_at_period_end=true;
   return structuredClone(f.sub);
 }
 if(path.startsWith('/v1/invoices?'))return {data:[{id:f.invoice.id}],has_more:false};
 if(path==='/v1/invoices/in_fixture?expand%5B%5D=payments')return structuredClone(f.invoice);
 if(path==='/v1/invoices/in_fixture'){const invoice=structuredClone(f.invoice);delete invoice.payments;return invoice;}
 if(path==='/v1/payment_intents/pi_fixture')return structuredClone(f.intent);
 if(path==='/v1/charges/ch_fixture')return structuredClone(f.charge);
 if(path.startsWith('/v1/refunds?charge='))return structuredClone(f.refunds);
 if(path==='/v1/billing_portal/sessions')return {url:'https://billing.stripe.com/p/session/fixture'};
 throw new Error('Unexpected Stripe contract request: '+method+' '+path);
}
async function request(path,{user=0,method='GET',body,headers={}}={}){
 const r=await fetch(url+path,{method,headers:{Origin:origin,'X-Requested-With':'cardshelf',...(user===null?{}:{Cookie:'cardshelf_session='+tokens[user]}),...(body===undefined?{}:{'Content-Type':'application/json'}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
 const text=await r.text();let data;try{data=JSON.parse(text)}catch{data=text}return {status:r.status,data,headers:r.headers};
}
await test('Stripe gateway, historical billing safeguards and referral contracts',async t=>{
 try{
  const hash=await hashPassword(password);
  for(const [i,id]of ids.entries()){await sql`INSERT INTO app_users(id,email,name,password_hash,role) VALUES(${id},${'stripe-'+id+'@example.test'},${'Stripe fixture '+i},${hash},${i===0?'admin':'user'})`;await sql`INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(${digest(tokens[i])},${id},now()+interval '1 hour')`;}
  await sql`DELETE FROM account_access_grants WHERE user_id=${member}`;
  process.env.CARDSHELF_INTEGRATION_KEY='57'.repeat(32);process.env.STRIPE_ENVIRONMENT='production';process.env.STRIPE_BILLING_ENABLED='true';process.env.APP_ORIGIN='https://cardshelf.example.test';
  await t.test('Stripe APIs are protected JSON, not public website fallbacks',async()=>{
   for(const path of ['/api/admin/integrations/stripe/status','/api/billing/stripe/account']){const r=await request(path,{user:null});assert.equal(r.status,401);assert.match(r.headers.get('content-type'),/json/);}
   assert.equal((await request('/api/admin/integrations/stripe/status',{user:1})).status,403);
   assert.equal((await request('/api/billing/stripe/checkout',{user:1,method:'POST',body:{},headers:{Origin:'https://other.example'}})).status,403);
   assert.equal((await request('/api/billing/stripe/webhook/production',{user:null,method:'POST',body:{}})).status,503);
  });
  await t.test('administrator setup requires password, correct mode and a safe portal',async()=>{
   const input={revision:0,password:'wrong',secret_key:key,webhook_secret:webhook,portal_id:'bpc_fixture',accepting_new:true,confirm:true};
   await assert.rejects(()=>saveStripeConnection(admin,'production',input,api),e=>e.status===403);
   await assert.rejects(()=>saveStripeConnection(member,'production',{...input,password},api),e=>e.status===403);
   await saveStripeConnection(admin,'production',{...input,password},api);
   const status=await stripeStatus(admin,'production');assert.equal(status.configured,true);assert.equal(status.account_id,'acct_fixture');assert.equal(JSON.stringify(status).includes(key),false);assert.equal(JSON.stringify(status).includes(webhook),false);
   const [r]=await sql`SELECT api_secret FROM stripe_connections WHERE environment='production'`;assert.notEqual(r.api_secret,key);
  });
  await t.test('stale credentials and reconnecting another merchant cannot overwrite billing identity',async()=>{
   const body={revision:0,password,secret_key:key,webhook_secret:webhook,portal_id:'bpc_fixture',accepting_new:true,confirm:true};await assert.rejects(()=>saveStripeConnection(admin,'production',body,api),e=>e.status===409);
   const wrong=async(...args)=>args[1]==='/v1/account'?{id:'acct_other',charges_enabled:true}:api(...args);await assert.rejects(()=>saveStripeConnection(admin,'production',{...body,revision:1},wrong),e=>e.status===409);
   assert.equal((await sql`SELECT account_id FROM stripe_connections WHERE environment='production'`)[0].account_id,'acct_fixture');
  });
  await t.test('only reviewed recurring Stripe offers can be published',async()=>{
   const input={price_id:'price_fixture',plan_code:'plus',tax_rate_id:'',terms:'Monthly fixture subscription. Cancel before renewal in Membership. Contact the operator for support and refund requests.'};
   const r=await saveStripeOffer(admin,'production',input,api);await publishStripeOffer(admin,'production',r.id,{revision:1,published:true,confirm_terms_reviewed:true},api);
   [offer]=await sql`SELECT * FROM stripe_offers WHERE id=${r.id}`;body={offer_id:offer.id,revision:offer.revision,terms_hash:offer.terms_hash,request_id:randomUUID(),consent:true};
  });
  await t.test('protected tester access cannot be converted to a Stripe charge',async()=>{
   const before=sessionsCreated;await assert.rejects(()=>startStripeCheckout(tester,body,api),e=>e.status===409);assert.equal(sessionsCreated,before);
   const access=await membershipState(tester,sql,{environment:'production',enforce:true,enabled:false,configured:false,timezone:'Australia/Perth'});assert.equal(access.access.allowed,true);assert.equal(access.access.payment_required,false);
  });
  await t.test('approved opted-in referrals are claimed before any production request',async()=>{
   const p=await approveReferralPartner(admin,partner,{revision:0,status:'approved',reward_type:'percentage',reward_value:2000,max_payments:6,hold_days:0,terms:'Fixture reward, paid manually after verification. No reward for card sales.'});
   await referralConsent(partner,{revision:p.revision,consent:true});await claimReferral(member,{code:p.code,consent:true});
  });
  await t.test('an existing Square request blocks Stripe checkout before any provider call',async()=>{
   await sql`INSERT INTO subscription_offers(id,environment,plan_code,cadence,variation_id,amount_minor,tax_bps,terms,terms_hash,published) VALUES(${squareOfferId},'production','plus','MONTHLY',${'fixture-'+squareOfferId},1000,0,'Cross-provider duplicate protection fixture terms only.','fixture-hash',true)`;
   const id=randomUUID();await sql`INSERT INTO square_subscriptions(id,user_id,environment,offer_id,request_id,offer_snapshot,start_date) VALUES(${id},${member},'production',${squareOfferId},${randomUUID()},'{}'::jsonb,'2026-01-01')`;
   const before=calls.length;await assert.rejects(()=>startStripeCheckout(member,body,api),e=>e.status===409&&/historical billing/.test(e.message));assert.equal(calls.length,before);
   await sql`DELETE FROM square_subscriptions WHERE id=${id}`;
  });
  await t.test('checkout retries return the original session, never a second subscription',async()=>{
   const first=await startStripeCheckout(member,body,api);rowId=first.id;assert.match(first.url,/^https:\/\/checkout.stripe.com\//);
   const again=await startStripeCheckout(member,body,api);assert.equal(again.id,rowId);assert.equal(sessionsCreated,1);
   await assert.rejects(()=>startStripeCheckout(member,{...body,request_id:randomUUID()},api),e=>e.status===409);
   await assert.rejects(()=>startStripeCheckout(member,{...body,terms_hash:'changed'},api),e=>e.status===409);
  });
  await t.test('the retired subscription endpoint cannot start another provider subscription',async()=>{
    const r=await request('/api/billing/subscribe',{user:1,method:'POST',body:{}});
    assert.equal(r.status,410);assert.match(r.headers.get('content-type'),/json/);
  });
  await t.test('completed checkout and an unpaid invoice do not grant paid access or commission',async()=>{
   f.invoice.status='open';f.invoice.amount_paid=0;f.invoice.amount_remaining=1000;f.invoice.payments.data[0].status='open';await syncStripeSubscription(rowId,null,api);
   assert.equal((await sql`SELECT paid_through FROM stripe_subscriptions WHERE id=${rowId}`)[0].paid_through,null);
   assert.equal((await sql`SELECT count(*)::integer AS n FROM referral_commissions WHERE provider='stripe'`)[0].n,0);
  });
  await t.test('invoice retrieval explicitly requests expandable payment records',async()=>{
   assert.ok(calls.some(c=>c.path==='/v1/invoices/in_fixture?expand%5B%5D=payments'));
  });
  await t.test('paid Stripe invoice grants the real period and one provider-labelled reward',async()=>{
   f.invoice.status='paid';f.invoice.amount_paid=1000;f.invoice.amount_remaining=0;f.invoice.payments.data[0].status='paid';await syncStripeSubscription(rowId,null,api);await syncStripeSubscription(rowId,null,api);
   const [s]=await sql`SELECT paid_through FROM stripe_subscriptions WHERE id=${rowId}`;assert.equal(new Date(s.paid_through).getTime(),f.line.period.end*1000);
   const state=await membershipState(member,sql,{environment:'sandbox',enforce:true,enabled:false,configured:false,timezone:'Australia/Perth'});assert.equal(state.access.tier,'plus');assert.equal(state.access.reason,'stripe_subscription');
   const c=await sql`SELECT * FROM referral_commissions WHERE provider='stripe'`;assert.equal(c.length,1);assert.equal(c[0].earned_minor,200);
  });
  await t.test('shared referral ledger records an external payment, not a provider transfer',async()=>{
   let [c]=await sql`SELECT * FROM referral_commissions WHERE provider='stripe'`;c=await approveCommission(admin,c.id,{revision:c.revision,approved:true});
   const input={revision:c.revision,request_id:randomUUID(),amount_minor:200,external_reference:'EXTERNAL-TEST-PAYOUT',confirm_paid:true};
   const r=await recordReferralPayout(admin,c.id,input);assert.equal(r.transfer_initiated,false);assert.equal((await recordReferralPayout(admin,c.id,input)).replayed,true);
   assert.equal(calls.some(c=>/transfers|payouts/.test(c.path)),false);
  });
  await t.test('refunds adjust earnings without rewriting recorded external payouts',async()=>{
   f.charge.amount_refunded=500;f.refunds={data:[{charge:'ch_fixture',currency:'aud',status:'succeeded',amount:500}],has_more:false};await syncStripeSubscription(rowId,null,api);
   const [c]=await sql`SELECT * FROM referral_commissions WHERE provider='stripe'`;assert.equal(c.earned_minor,100);assert.equal(c.paid_minor,200);assert.equal(c.approved,false);
   const r=await referralAccount(partner);assert.equal(r.earnings[0].paid_minor,200);assert.equal(JSON.stringify(r).includes('stripe-'+member+'@'),false);
  });
  await t.test('webhooks reject wrong signatures and modes; duplicate events are stored once',async()=>{
   const event={id:'evt_stripefixture',object:'event',type:'invoice.paid',livemode:true,data:{object:{id:'in_fixture'}}},raw=Buffer.from(JSON.stringify(event)),timestamp=Math.floor(Date.now()/1000);
   const signature='t='+timestamp+',v1='+createHmac('sha256',webhook).update(timestamp+'.').update(raw).digest('hex');assert.equal(stripeSignature(raw,signature,webhook),true);
   await receiveStripeWebhook('production',raw,signature);await receiveStripeWebhook('production',raw,signature);
   assert.equal((await sql`SELECT count(*)::integer AS n FROM stripe_webhook_events WHERE event_id='evt_stripefixture'`)[0].n,1);
   await assert.rejects(()=>receiveStripeWebhook('production',raw,signature+'x'),e=>e.status===400);
   const wrong=Buffer.from(JSON.stringify({...event,livemode:false})),wrongSig='t='+timestamp+',v1='+createHmac('sha256',webhook).update(timestamp+'.').update(wrong).digest('hex');await assert.rejects(()=>receiveStripeWebhook('production',wrong,wrongSig),e=>e.status===400);
  });
  await t.test('portal uses the authenticated customer and cancellation preserves paid periods',async()=>{
   assert.match((await stripePortal(member,api)).url,/^https:\/\/billing.stripe.com\//);await assert.rejects(()=>stripePortal(tester,api),e=>e.status===404);
   const result=await cancelStripeSubscription(member,rowId,{confirm:true},false,api);assert.ok(result.paid_through);assert.equal(f.sub.cancel_at_period_end,true);
   await cancelStripeSubscription(member,rowId,{confirm:true},false,api);assert.equal(calls.filter(c=>c.path==='/v1/subscriptions/sub_fixture'&&c.method==='POST').length,1);
  });
  await t.test('a full refund removes only paid Stripe entitlement, not tester access',async()=>{
   f.charge.amount_refunded=1000;f.refunds.data[0].amount=1000;await syncStripeSubscription(rowId,null,api);
   const cfg={environment:'production',enforce:true,enabled:false,configured:false,timezone:'Australia/Perth'};
   assert.equal((await membershipState(member,sql,cfg)).access.allowed,false);assert.equal((await membershipState(tester,sql,cfg)).access.allowed,true);
  });
  await t.test('Square sandbox payments cannot grant an enforced live tier alongside Stripe',async()=>{
   const offerId=randomUUID(),subId=randomUUID();
   try {
    await sql`INSERT INTO subscription_offers(id,environment,plan_code,cadence,variation_id,amount_minor,terms,terms_hash)
      VALUES(${offerId},'sandbox','plus','MONTHLY',${'sandbox-'+offerId},1000,'Sandbox payment must never unlock live paid access.','sandbox-only')`;
    await sql`INSERT INTO square_subscriptions(id,user_id,environment,offer_id,request_id,offer_snapshot,start_date,paid_through)
      VALUES(${subId},${member},'sandbox',${offerId},${randomUUID()},${sql.json({plan_code:'plus'})},'2026-01-01','2099-01-01')`;
    const cfg={environment:'sandbox',enforce:true,enabled:false,configured:false,timezone:'Australia/Perth'};
    assert.equal((await membershipState(member,sql,cfg)).access.allowed,false);
    assert.equal((await membershipState(tester,sql,cfg)).access.allowed,true);
   } finally {
    await sql`DELETE FROM square_subscriptions WHERE id=${subId}`;
    await sql`DELETE FROM subscription_offers WHERE id=${offerId}`;
   }
  });
 }finally{
  await sql`DELETE FROM referral_payout_records WHERE commission_id IN (SELECT c.id FROM referral_commissions c JOIN referral_attributions a ON a.id=c.attribution_id WHERE a.referred_user_id=${member})`;
  await sql`DELETE FROM referral_commissions WHERE attribution_id IN (SELECT id FROM referral_attributions WHERE referred_user_id=${member})`;
  await sql`DELETE FROM referral_attributions WHERE referred_user_id=${member}`;await sql`DELETE FROM referral_partners WHERE user_id=${partner}`;
  await sql`DELETE FROM stripe_invoices WHERE subscription_id IN (SELECT id FROM stripe_subscriptions WHERE user_id=${member})`;await sql`DELETE FROM stripe_subscriptions WHERE user_id=${member}`;
  await sql`DELETE FROM stripe_customers WHERE user_id=${member}`;await sql`DELETE FROM stripe_webhook_events WHERE event_id='evt_stripefixture'`;
  await sql`DELETE FROM stripe_offers WHERE price_id='price_fixture'`;await sql`DELETE FROM stripe_connections WHERE account_id='acct_fixture'`;
  await sql`DELETE FROM square_subscriptions WHERE offer_id=${squareOfferId}`;await sql`DELETE FROM subscription_offers WHERE id=${squareOfferId}`;
  await sql`DELETE FROM app_users WHERE id IN ${sql(ids)}`;
  for(const key of Object.keys(process.env))if(!(key in originalEnv))delete process.env[key];Object.assign(process.env,originalEnv);await closeDatabase();
 }
});
