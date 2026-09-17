// Contract tests use injected Square responses. No sandbox or production financial API is called.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID,createHmac } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import '../helpers/block-square-network.mjs';
import { db,closeDatabase } from '../../lib/db.mjs';
import { hashPassword,randomToken,digest } from '../../lib/security.mjs';
import { membershipState,setTier,createSubscriptionAccount } from '../../lib/membership.mjs';
import { saveOffer,publishOffer,startSubscription,syncSubscription,cancelSubscription } from '../../lib/square-subscriptions.mjs';
import { approveReferralPartner,referralConsent,claimReferral,referralAccount,approveCommission,recordReferralPayout } from '../../lib/subscription-referrals.mjs';
import { receiveSquareWebhook } from '../../lib/square-webhooks.mjs';
import { invoicePeriodEnd } from '../../lib/subscription-logic.mjs';
const base=process.env.TEST_BASE_URL;
if(process.env.ALLOW_TEST_DATABASE!=='yes'||!base||!new URL(process.env.DATABASE_URL||'http://invalid').pathname.endsWith('_test'))throw new Error('Use only a disposable _test database.');
const sql=db(),ids=[randomUUID(),randomUUID(),randomUUID(),randomUUID()],[admin,partner,tester,buyer]=ids;
const tokens=ids.map(()=>randomToken()),password='Subscription fixture password only 123';
const envBefore={...process.env},events=[];let child,offerId;
const config={SQUARE_ENVIRONMENT:'production',SQUARE_BILLING_ENABLED:'true',MEMBERSHIP_ENFORCEMENT_ENABLED:'true',SQUARE_ACCESS_TOKEN:'fixture-not-a-real-token',SQUARE_MERCHANT_ID:'merchant-fixture',SQUARE_LOCATION_ID:'location-fixture',SQUARE_WEBHOOK_SIGNATURE_KEY:'fixture-signature-key',SQUARE_WEBHOOK_URL:'https://cards.example.test/api/billing/square/webhook',SQUARE_TIMEZONE:'Australia/Perth'};
const amount=n=>({amount:n,currency:'AUD'}),customerMap=new Map(),subscriptions=new Map(),invoices=new Map(),orders=new Map(),payments=new Map(),calls=[];
const variationId='VAR_'+randomUUID().replaceAll('-','');
const mock=async(path,body=null)=>{
  calls.push({path,body});const id=decodeURIComponent(path.split('/').at(-1));
  if(path==='/v2/catalog/object/'+variationId)return {object:{id:variationId,type:'SUBSCRIPTION_PLAN_VARIATION',present_at_all_locations:true,subscription_plan_variation_data:{phases:[{cadence:'MONTHLY',pricing:{type:'STATIC',price_money:amount(1000)}}]}}};
  if(path==='/v2/locations/location-fixture')return {location:{id:'location-fixture',merchant_id:'merchant-fixture',currency:'AUD',status:'ACTIVE',timezone:'Australia/Perth'}};
  if(path==='/v2/customers'){
    if(!customerMap.has(body.idempotency_key))customerMap.set(body.idempotency_key,{id:'CUSTOMER_'+body.reference_id,email_address:body.email_address});
    return {customer:structuredClone(customerMap.get(body.idempotency_key))};
  }
  if(path==='/v2/subscriptions'){
    const id='SUB_'+body.idempotency_key;
    if(!subscriptions.has(id)){
      const invoiceId='INVOICE_'+body.idempotency_key,orderId='ORDER_'+body.idempotency_key;
      subscriptions.set(id,{id,customer_id:body.customer_id,location_id:body.location_id,plan_variation_id:body.plan_variation_id,start_date:body.start_date,status:'ACTIVE',invoice_ids:[invoiceId]});
      invoices.set(invoiceId,{id:invoiceId,subscription_id:id,order_id:orderId,location_id:body.location_id,primary_recipient:{customer_id:body.customer_id},status:'UNPAID',payment_requests:[{request_type:'BALANCE',due_date:body.start_date}],public_url:'https://squareup.com/pay-invoice/'+invoiceId});
      orders.set(orderId,{id:orderId,location_id:body.location_id,total_money:amount(1100),total_tax_money:amount(100),tenders:[]});
    }
    return {subscription:structuredClone(subscriptions.get(id))};
  }
  if(path.endsWith('/cancel')){const s=subscriptions.get(decodeURIComponent(path.split('/').at(-2)));s.canceled_date=invoicePeriodEnd(s,invoices.get(s.invoice_ids[0]),'MONTHLY');return {subscription:structuredClone(s)}}
  if(path.startsWith('/v2/subscriptions/'))return {subscription:structuredClone(subscriptions.get(id))};
  if(path.startsWith('/v2/invoices/'))return {invoice:structuredClone(invoices.get(id))};
  if(path.startsWith('/v2/orders/'))return {order:structuredClone(orders.get(id))};
  if(path.startsWith('/v2/payments/'))return {payment:structuredClone(payments.get(id))};
  if(path.startsWith('/v2/refunds/'))return {refund:{id,payment_id:[...payments.keys()][0],status:'COMPLETED'}};
  throw new Error('Unexpected mocked Square endpoint: '+path);
};
async function request(path,{method='GET',body,user=2,headers={},origin=base,url=base}={}){
 const response=await fetch(url+path,{method,headers:{Origin:origin,'X-Requested-With':'cardshelf',...(user===null?{}:{Cookie:'cardshelf_session='+tokens[user]}),...(body===undefined?{}:{'Content-Type':'application/json'}),...headers},body:body===undefined?undefined:JSON.stringify(body),redirect:'manual'});
 const text=await response.text();let data;try{data=JSON.parse(text)}catch{data=text}return {status:response.status,data};
}
await test('Square subscriptions, complimentary tiers and referral ledger contracts',async t=>{
 try{
  const hash=await hashPassword(password);
  for(let i=0;i<3;i++)await sql`INSERT INTO app_users(id,email,name,password_hash,role) VALUES(${ids[i]},${'sub-'+ids[i]+'@example.test'},${'Fixture '+i},${hash},${i===0?'admin':'user'})`;
  await sql`INSERT INTO app_users(id,email,name,password_hash) VALUES(${buyer},${'sub-'+buyer+'@example.test'},'Subscription fixture buyer',${hash})`;
  // This fourth fixture represents a subscription-ready account, never an existing tester.
  await sql`DELETE FROM account_access_grants WHERE user_id=${buyer}`;
  for(let i=0;i<4;i++)await sql`INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(${digest(tokens[i])},${ids[i]},now()+interval '1 hour')`;
  await t.test('default upgrade exposes no offers or provider secrets and preserves tester access',async()=>{
    const r=await request('/api/billing/offers',{user:null});assert.equal(r.status,200);assert.equal(r.data.enabled,false);assert.deepEqual(r.data.offers,[]);
    const account=await request('/api/account/membership');assert.equal(account.data.grant.kind,'beta_tester');assert.equal(account.data.access.payment_required,false);assert.equal(account.data.access.features.length,11);
    assert.equal((await request('/api/admin/billing/overview')).status,403);assert.equal((await request('/api/billing/account',{user:null})).status,401);
    assert.equal((await request('/api/billing/subscribe',{method:'POST',body:{}})).status,409);
    assert.equal((await request('/api/admin/billing/tiers/'+tester,{method:'POST',body:{}})).status,403);
  });
  await t.test('administrators can assign a hidden complimentary tier without granting an admin role',async()=>{
    const r=await request('/api/admin/billing/tiers/'+buyer,{user:0,method:'POST',body:{tier:'complimentary',reason:'Manual full access for fixture',revision:0,expires_at:null,confirm_billing_unchanged:true}});
    assert.equal(r.status,200);assert.equal(r.data.access.reason,'complimentary');assert.equal((await sql`SELECT role FROM app_users WHERE id=${buyer}`)[0].role,'user');
    assert.equal((await request('/api/admin/billing/tiers/'+buyer,{user:0,method:'POST',body:{tier:'inherit',reason:'Stale revision',revision:0,confirm_billing_unchanged:true}})).status,409);
    await setTier(admin,buyer,{tier:'inherit',reason:'Return fixture to subscription eligibility',revision:1,confirm_billing_unchanged:true});
  });
  await t.test('new subscription-ready creation never removes access from an existing email',async()=>{
    await assert.rejects(createSubscriptionAccount(admin,{name:'Duplicate',email:'sub-'+tester+'@example.test',password,confirm_no_tester_grant:true}),e=>e.status===409);
    assert.equal((await sql`SELECT kind FROM account_access_grants WHERE user_id=${tester}`)[0].kind,'beta_tester');
    const newUser=await createSubscriptionAccount(admin,{name:'New subscriber',email:'new-'+randomUUID()+'@example.test',password,confirm_no_tester_grant:true});
    assert.equal((await sql`SELECT * FROM account_access_grants WHERE user_id=${newUser.id}`).length,0);await sql`DELETE FROM app_users WHERE id=${newUser.id}`;
  });
  Object.assign(process.env,config);
  const draft=await saveOffer(admin,{plan_code:'plus',cadence:'MONTHLY',variation_id:variationId,amount_minor:1000,tax_bps:1000,terms:'Recurring monthly test subscription. Cancel future renewals before the next cycle. Refunds require contacting the operator.'});offerId=draft.id;
  const published=await publishOffer(admin,draft.id,{revision:1,published:true,confirm_terms_reviewed:true},mock);
  const intent={offer_id:offerId,revision:published.revision,terms_hash:published.terms_hash,request_id:randomUUID(),consent:true};
  let subscriptionId,invoiceId,paymentId,commission,referrer;
  await t.test('existing testers cannot accidentally subscribe to a paid offer',async()=>{
    await assert.rejects(startSubscription(tester,intent,mock),e=>e.status===409);assert.equal(calls.filter(c=>c.path==='/v2/subscriptions').length,0);
    await setTier(admin,tester,{tier:'collector',reason:'Lower tier must preserve tester grant',revision:0,confirm_billing_unchanged:true});assert.equal((await membershipState(tester)).access.features.length,11);
  });
  await t.test('referrals require approval plus own opt-in; self-referrals fail',async()=>{
    referrer=await approveReferralPartner(admin,partner,{status:'approved',reward_type:'percentage',reward_value:2000,max_payments:2,hold_days:0,terms:'Twenty percent of eligible pretax subscription revenue for the first two billing cycles, adjusted for refunds.',revision:0});
    await assert.rejects(claimReferral(buyer,{code:referrer.code,consent:true}),e=>e.status===409);
    await referralConsent(partner,{revision:referrer.revision,consent:true});
    await assert.rejects(claimReferral(partner,{code:referrer.code,consent:true}),e=>e.status===400);
    await claimReferral(buyer,{code:referrer.code,consent:true});await claimReferral(buyer,{code:referrer.code,consent:true});
    assert.equal((await sql`SELECT * FROM referral_attributions WHERE referred_user_id=${buyer}`).length,1);
  });
  await t.test('Square invoice subscription requests are consented, account-bound and retry-safe',async()=>{
    await assert.rejects(startSubscription(buyer,{...intent,consent:false},mock),e=>e.status===400);
    const first=await startSubscription(buyer,intent,mock),again=await startSubscription(buyer,intent,mock);subscriptionId=first.id;
    assert.equal(again.id,first.id);assert.equal(again.replayed,true);assert.equal(calls.filter(c=>c.path==='/v2/subscriptions').length,1);
    const creation=calls.find(c=>c.path==='/v2/subscriptions').body;assert.ok(!Object.hasOwn(creation,'card_id'));assert.equal(creation.customer_id,'CUSTOMER_'+buyer);
    await assert.rejects(startSubscription(buyer,{...intent,request_id:randomUUID()},mock),e=>e.status===409);
    await assert.rejects(startSubscription(buyer,{...intent,terms_hash:'changed'},mock),e=>e.status===409);
  });
  await t.test('ACTIVE and sent invoices do not grant paid access or commission',async()=>{
    await syncSubscription(subscriptionId,buyer,mock);assert.equal((await membershipState(buyer)).access.allowed,false);
    assert.equal((await sql`SELECT * FROM referral_commissions WHERE attribution_id IN (SELECT id FROM referral_attributions WHERE referred_user_id=${buyer})`).length,0);
  });
  await t.test('verified paid invoices grant the correct period and only one commission',async()=>{
    const s=[...subscriptions.values()][0];invoiceId=s.invoice_ids[0];const inv=invoices.get(invoiceId),order=orders.get(inv.order_id);paymentId='PAY_'+randomUUID();
    inv.status='PAID';order.tenders=[{payment_id:paymentId}];payments.set(paymentId,{id:paymentId,order_id:order.id,location_id:order.location_id,status:'COMPLETED',source_type:'CARD',amount_money:amount(1100),refunded_money:amount(0)});
    await syncSubscription(subscriptionId,buyer,mock);await syncSubscription(subscriptionId,buyer,mock);
    const access=(await membershipState(buyer)).access;assert.equal(access.allowed,true);assert.equal(access.tier,'plus');assert.equal(access.features.length,11);
    [commission]=await sql`SELECT * FROM referral_commissions WHERE invoice_id=${invoiceId}`;assert.equal(commission.earned_minor,200);
    assert.equal((await sql`SELECT * FROM referral_commissions WHERE invoice_id=${invoiceId}`).length,1);
    const view=await referralAccount(partner);assert.equal(view.earnings.length,1);assert.ok(!JSON.stringify(view).includes('sub-'+buyer));assert.ok(!JSON.stringify(view).includes(invoiceId));
  });
  await t.test('referral terms revisions invalidate opt-in without rewriting existing attribution terms',async()=>{
    await approveReferralPartner(admin,partner,{status:'approved',reward_type:'fixed',reward_value:500,max_payments:1,hold_days:10,terms:'Updated fixed reward terms for new referrals only. Existing referred accounts keep their accepted terms.',revision:1});
    assert.equal((await referralAccount(partner)).active,false);const [a]=await sql`SELECT terms_snapshot FROM referral_attributions WHERE referred_user_id=${buyer}`;assert.equal(a.terms_snapshot.reward_value,2000);
  });
  await t.test('manual payout recording requires approval, exact amount and confirmation; retries do not double-count',async()=>{
    await assert.rejects(recordReferralPayout(admin,commission.id,{revision:1,request_id:randomUUID(),amount_minor:200,external_reference:'EXTERNAL TEST ONLY',confirm_paid:false}),e=>e.status===400);
    const approved=await approveCommission(admin,commission.id,{revision:commission.revision,approved:true});
    const request={revision:approved.revision,request_id:randomUUID(),amount_minor:200,external_reference:'EXTERNAL TEST ONLY',confirm_paid:true};
    const first=await recordReferralPayout(admin,commission.id,request),again=await recordReferralPayout(admin,commission.id,request);
    assert.equal(first.transfer_initiated,false);assert.equal(again.replayed,true);assert.equal((await sql`SELECT paid_minor FROM referral_commissions WHERE id=${commission.id}`)[0].paid_minor,200);
    assert.equal(calls.filter(c=>/payout|transfer/.test(c.path)).length,0);
  });
  await t.test('refund reconciliation preserves paid history and exposes a negative adjustment, never a second reward',async()=>{
    const p=payments.get(paymentId);p.refunded_money=amount(550);p.refund_ids=['REFUND_1'];invoices.get(invoiceId).status='PARTIALLY_REFUNDED';
    await syncSubscription(subscriptionId,buyer,mock);const [c]=await sql`SELECT * FROM referral_commissions WHERE id=${commission.id}`;
    assert.equal(c.earned_minor,100);assert.equal(c.paid_minor,200);assert.equal(c.approved,false);
    await assert.rejects(approveCommission(admin,c.id,{revision:c.revision,approved:true}),e=>e.status===409);
  });
  await t.test('signed duplicate notifications persist only once and forged/wrong-merchant events fail',async()=>{
    const event={merchant_id:'merchant-fixture',event_id:randomUUID(),type:'dispute.created',data:{id:'DISPUTE_1',object:{dispute:{id:'DISPUTE_1',disputed_payment:{payment_id:paymentId}}}}};events.push(event.event_id);
    const raw=Buffer.from(JSON.stringify(event)),signature=createHmac('sha256',config.SQUARE_WEBHOOK_SIGNATURE_KEY).update(config.SQUARE_WEBHOOK_URL).update(raw).digest('base64');
    await receiveSquareWebhook(raw,signature);await receiveSquareWebhook(raw,signature);assert.equal((await sql`SELECT * FROM square_webhook_events WHERE event_id=${event.event_id}`).length,1);
    await assert.rejects(receiveSquareWebhook(raw,'forged'),e=>e.status===403);
    const wrong=Buffer.from(JSON.stringify({...event,merchant_id:'wrong'}));const sig=createHmac('sha256',config.SQUARE_WEBHOOK_SIGNATURE_KEY).update(config.SQUARE_WEBHOOK_URL).update(wrong).digest('base64');await assert.rejects(receiveSquareWebhook(wrong,sig),e=>e.status===403);
    // A dispute received before processing is enough to hold its mapped invoice on reconciliation.
    await syncSubscription(subscriptionId,buyer,mock);const [c]=await sql`SELECT * FROM referral_commissions WHERE id=${commission.id}`;assert.equal(c.blocked,true);assert.equal(c.earned_minor,0);assert.equal((await membershipState(buyer)).access.allowed,false);
  });
  await t.test('complimentary access survives disputed subscription metadata and cancel retries do not duplicate requests',async()=>{
    await setTier(admin,buyer,{tier:'complimentary',reason:'Protect complimentary access independently',revision:2,confirm_billing_unchanged:true});assert.equal((await membershipState(buyer)).access.allowed,true);
    await cancelSubscription(buyer,subscriptionId,{confirm:true},false,mock);await cancelSubscription(buyer,subscriptionId,{confirm:true},false,mock);
    assert.equal(calls.filter(c=>c.path.endsWith('/cancel')).length,1);assert.equal((await membershipState(buyer)).access.reason,'complimentary');
  });
  await t.test('enforced production HTTP paths preserve testers and block unpaid premium actions',async()=>{
    // This child is explicitly prevented from making external Square requests.
    const port=43179,url='http://127.0.0.1:'+port;let logs='';
    child=spawn(process.execPath,['--import',fileURLToPath(new URL('../helpers/block-square-network.mjs',import.meta.url)),'.output/server/index.mjs'],{env:{...process.env,...config,APP_ORIGIN:url,PORT:String(port),NITRO_PORT:String(port),HOST:'127.0.0.1',NITRO_HOST:'127.0.0.1'},stdio:['ignore','pipe','pipe']});
    child.stderr.on('data',b=>{logs=(logs+b).slice(-6000)});child.stdout.on('data',()=>{});
    let ready=false;for(let i=0;i<50;i++){try{if((await fetch(url+'/api/health')).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,100))}assert.ok(ready,logs);
    await setTier(admin,buyer,{tier:'collector',reason:'Exercise Collector limits',revision:3,confirm_billing_unchanged:true});
    const opts={url,origin:url,user:3};
    assert.equal((await request('/api/prices/summary',opts)).status,403);assert.equal((await request('/api/%70rices/summary',opts)).status,403);
    assert.equal((await request('/api/collection',{...opts,method:'PUT',body:{}})).status,403);
    assert.equal((await request('/api/binders',{...opts,method:'POST',body:{title:'Blocked collection',columns:3,rows:3,page_count:1}})).status,403);
    const tracker=await request('/api/binders',{...opts,method:'POST',body:{binder_type:'tracking',title:'Allowed tracking',columns:3,rows:3,page_count:1,color:'#46556d'}});assert.equal(tracker.status,200,JSON.stringify(tracker.data));
    assert.equal((await request('/api/marketplace/listings',{...opts,method:'POST',body:{}})).status,403);
    assert.equal((await request('/api/marketplace/access',opts)).data.can_sell,false);
    assert.equal((await request('/api/collection/export?format=json',opts)).status,200);
    const account=await request('/api/account/membership',{url,origin:url,user:2});assert.equal(account.data.access.features.length,11);assert.equal(account.data.access.payment_required,false);
    assert.equal((await request('/api/prices/summary',{url,origin:url,user:2})).status,200);
    assert.equal((await request('/api/admin/billing/overview',opts)).status,403);
    const bad=await fetch(url+'/api/billing/square/webhook',{method:'POST',body:'{}',headers:{'Content-Type':'application/json','x-square-hmacsha256-signature':'forged'}});assert.equal(bad.status,403);
    const event={merchant_id:'merchant-fixture',event_id:randomUUID(),type:'subscription.updated',data:{id:[...subscriptions.keys()][0]}};events.push(event.event_id);const raw=JSON.stringify(event);const sig=createHmac('sha256',config.SQUARE_WEBHOOK_SIGNATURE_KEY).update(config.SQUARE_WEBHOOK_URL).update(raw).digest('base64');
    const good=await fetch(url+'/api/billing/square/webhook',{method:'POST',body:raw,headers:{'Content-Type':'application/json','x-square-hmacsha256-signature':sig}});assert.equal(good.status,200);
    assert.equal((await fetch(url+'/api/referrals/claim',{method:'POST',body:'{}',headers:{'Content-Type':'application/json'}})).status,403);
  });
 }finally{
  if(child){child.kill('SIGTERM');await Promise.race([once(child,'exit'),new Promise(r=>setTimeout(r,3000))]);if(child.exitCode===null)child.kill('SIGKILL')}
  for(const k of Object.keys(process.env))if(!(k in envBefore))delete process.env[k];Object.assign(process.env,envBefore);
  await sql`DELETE FROM referral_payout_records WHERE commission_id IN (SELECT c.id FROM referral_commissions c JOIN referral_attributions a ON a.id=c.attribution_id WHERE a.referred_user_id=${buyer})`;
  await sql`DELETE FROM referral_commissions WHERE attribution_id IN (SELECT id FROM referral_attributions WHERE referred_user_id=${buyer})`;
  await sql`DELETE FROM referral_attributions WHERE referred_user_id=${buyer}`;await sql`DELETE FROM referral_partners WHERE user_id=${partner}`;
  await sql`DELETE FROM square_invoice_payments WHERE invoice_id IN (SELECT i.square_id FROM square_invoices i JOIN square_subscriptions s ON s.id=i.subscription_id WHERE s.user_id=${buyer})`;
  await sql`DELETE FROM square_invoices WHERE subscription_id IN (SELECT id FROM square_subscriptions WHERE user_id=${buyer})`;
  await sql`DELETE FROM square_subscriptions WHERE user_id=${buyer}`;await sql`DELETE FROM square_customers WHERE user_id=${buyer}`;
  if(offerId)await sql`DELETE FROM subscription_offers WHERE id=${offerId}`;
  for(const e of events)await sql`DELETE FROM square_webhook_events WHERE event_id=${e}`;
  await sql`DELETE FROM app_users WHERE id IN ${sql(ids)}`;await closeDatabase();
 }
});
