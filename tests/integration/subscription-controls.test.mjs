// Real database/HTTP checks with injected Stripe GET responses. No live financial API.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHmac} from 'node:crypto';
import '../helpers/block-payment-network.mjs';
import {db,closeDatabase} from '../../lib/db.mjs';
import {hashPassword,randomToken,digest} from '../../lib/security.mjs';
import {stripeFixture} from '../helpers/stripe-fixtures.mjs';
import {saveStripeConnection,saveStripeOffer,publishStripeOffer,stripeConfig} from '../../lib/stripe-connection.mjs';
import {receiveStripeWebhook,stripeTick} from '../../lib/stripe-webhooks.mjs';
import {saveSubscriptionControls,subscriptionControls} from '../../lib/subscription-controls.mjs';
import {publicSubscriptionOffers} from '../../lib/public-subscriptions.mjs';
import {billingPolicy} from '../../lib/billing-policy.mjs';
import {membershipState,setTier,createSubscriptionAccount} from '../../lib/membership.mjs';
const base=process.env.TEST_BASE_URL;
if(process.env.ALLOW_TEST_DATABASE!=='yes'||!base||!new URL(process.env.DATABASE_URL||'http://invalid').pathname.endsWith('_test'))throw new Error('Use only a disposable _test database.');
const sql=db(),originalEnv={...process.env},origin=process.env.APP_ORIGIN||base;
const ids=Array.from({length:4},()=>randomUUID()),[admin,tester,member,comp]=ids;
const tokens=ids.map(()=>randomToken()),password='Controls fixture password 123';
const webhook='whsec_'+'C'.repeat(32),eventId='evt_controls_'+randomUUID().replaceAll('-','');
const offers=[],calls=[];
async function api(cfg,path,body=null,method='GET') {
  calls.push({path,method});assert.equal(method,'GET','Activation must never create a charge or subscription.');
  const f=stripeFixture(cfg.environment);
  if(path==='/v1/account')return {id:'acct_controls',charges_enabled:true,business_profile:{name:'Controls fixture'}};
  if(path==='/v1/balance')return {livemode:cfg.environment==='production'};
  if(path==='/v1/billing_portal/configurations/bpc_controls')return {...f.portal,id:'bpc_controls'};
  if(path==='/v1/prices/price_controls')return {...f.price,id:'price_controls'};
  if(path==='/v1/events/'+eventId)return {id:eventId,object:'event',livemode:true,type:'invoice.updated',data:{object:{id:'in_controls'}}};
  if(path==='/v1/invoices/in_controls')return {id:'in_controls',parent:null};
  throw new Error('Unexpected test request '+path);
}
async function request(path,{user=0,method='GET',body,headers={}}={}) {
  const r=await fetch(base+path,{method,headers:{Origin:origin,'X-Requested-With':'cardshelf',
    ...(user===null?{}:{Cookie:'cardshelf_session='+tokens[user]}),
    ...(body===undefined?{}:{'Content-Type':'application/json'}),...headers},
    body:body===undefined?undefined:JSON.stringify(body)});
  const text=await r.text();let data;try{data=JSON.parse(text)}catch{data=text}
  return {status:r.status,data,headers:r.headers};
}
async function change(overrides={},provider=api) {
  const p=await billingPolicy();
  return saveSubscriptionControls(admin,{revision:p.revision,environment:p.environment,
    enabled:p.requested_enabled,enforce:p.enforce,password,reason:'Subscription control integration test',
    confirm_recurring:true,confirm_mode_change:true,confirm_access:true,
    live_confirmation:'ENABLE LIVE SUBSCRIPTIONS',...overrides},provider);
}
await test('Stripe-only runtime activation and preserved access',async t=>{
  let extraAccount=null;
  try {
    const hash=await hashPassword(password);
    for(const [i,id] of ids.entries()) {
      await sql`INSERT INTO app_users(id,email,name,password_hash,role)
        VALUES(${id},${'controls-'+id+'@example.test'},${'Controls fixture '+i},${hash},${i===0?'admin':'user'})`;
      await sql`INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(${digest(tokens[i])},${id},now()+interval '1 hour')`;
    }
    await sql`DELETE FROM account_access_grants WHERE user_id IN (${member},${comp})`;
    process.env.CARDSHELF_INTEGRATION_KEY='93'.repeat(32);
    process.env.STRIPE_ENVIRONMENT='sandbox';process.env.STRIPE_BILLING_ENABLED='false';process.env.MEMBERSHIP_ENFORCEMENT_ENABLED='false';
    process.env.APP_ORIGIN='https://cardshelf.example.test';delete process.env.STRIPE_CHECKOUT_KILL_SWITCH;
    await setTier(admin,comp,{tier:'complimentary',reason:'Protected fixture access',revision:0,expires_at:null,confirm_billing_unchanged:true});
    await t.test('controls are authenticated administrative JSON, not a public page',async()=>{
      const p='/api/admin/integrations/stripe/controls';
      assert.equal((await request(p,{user:null})).status,401);
      assert.equal((await request(p,{user:1})).status,403);
      const r=await request(p);assert.equal(r.status,200);assert.match(r.headers.get('content-type'),/json/);
      assert.match(r.headers.get('cache-control'),/no-store/);
      assert.equal((await request(p,{method:'POST',body:{},headers:{Origin:'https://evil.test'}})).status,403);
      assert.equal((await request('/api/billing/subscribe',{user:2,method:'POST',body:{}})).status,410);
    });
    await t.test('activation cannot bypass role/password checks or inject an administrator grant',async()=>{
      const b={revision:0,environment:'sandbox',enabled:false,enforce:false,password,reason:'Fixture policy check'};
      await assert.rejects(()=>saveSubscriptionControls(member,b,api),e=>e.status===403);
      await assert.rejects(()=>saveSubscriptionControls(admin,{...b,password:'wrong'},api),e=>e.status===403);
      await assert.rejects(()=>saveSubscriptionControls(admin,{...b,role:'admin'},api),e=>e.status===400);
      assert.equal(calls.length,0);assert.equal((await billingPolicy()).enabled,false);
    });
    await t.test('mode-specific connections and published offers are required',async()=>{
      await assert.rejects(()=>change({enabled:true}),e=>e.status===409);
      for(const environment of ['sandbox','production']) {
        await saveStripeConnection(admin,environment,{revision:0,password,
          secret_key:(environment==='production'?'sk_live_':'sk_test_')+'C'.repeat(32),
          webhook_secret:webhook,portal_id:'bpc_controls',accepting_new:false,confirm:true},api);
        const o=await saveStripeOffer(admin,environment,{price_id:'price_controls',plan_code:'plus',
          terms:'Fixture recurring membership for testing only. Cancel before renewal and contact the operator for refund queries.',tax_rate_id:''},api);
        offers.push(o.id);await publishStripeOffer(admin,environment,o.id,{revision:1,published:true,confirm_terms_reviewed:true},api);
      }
    });
    await t.test('sandbox activation overrides the old disabled server flag without charging anyone',async()=>{
      const r=await change({enabled:true});assert.equal(r.payments_created,false);
      assert.equal((await billingPolicy()).enabled,true);assert.equal((await stripeConfig()).accepting,true);
      assert.equal(process.env.STRIPE_BILLING_ENABLED,'false');
      assert.equal((await membershipState(tester)).access.reason,'beta_tester');
      assert.equal((await subscriptionControls(admin)).policy.source,'administrator');
      assert.ok(calls.every(c=>c.method==='GET'));
    });
    await t.test('test offers never appear on the public pricing endpoint',async()=>{
      const r=await request('/api/public/subscription-offers',{user:null});assert.equal(r.status,200);assert.equal(r.data.enabled,false);assert.equal(r.data.offers.length,0);
    });
    await t.test('stale saves cannot overwrite a newer policy',async()=>{
      await assert.rejects(()=>change({revision:0}),e=>e.status===409);
      assert.equal((await billingPolicy()).enabled,true);
    });
    await t.test('activation rejects a changed price and preserves the old state',async()=>{
      const p=await billingPolicy();
      const wrong=async(...args)=>args[1]==='/v1/prices/price_controls'?{...await api(...args),unit_amount:9999}:api(...args);
      await assert.rejects(()=>change({},wrong),e=>e.status===409);
      assert.equal((await billingPolicy()).revision,p.revision);
    });
    await t.test('live activation requires explicit confirmation and a signed live webhook',async()=>{
      await assert.rejects(()=>change({environment:'production',live_confirmation:''}),e=>e.status===400);
      await assert.rejects(()=>change({environment:'production'}),e=>e.status===409&&/webhook/.test(e.message));
      const event={id:eventId,object:'event',livemode:true,type:'invoice.updated',data:{object:{id:'in_controls'}}};
      const raw=Buffer.from(JSON.stringify(event)),stamp=Math.floor(Date.now()/1000);
      const sig='t='+stamp+',v1='+createHmac('sha256',webhook).update(stamp+'.').update(raw).digest('hex');
      await receiveStripeWebhook('production',raw,sig);
      await assert.rejects(()=>change({environment:'production'}),e=>e.status===409&&/reconciliation/.test(e.message));
      await stripeTick(api);
      assert.equal((await sql`SELECT status FROM stripe_webhook_events WHERE event_id=${eventId}`)[0].status,'done');
      assert.equal((await billingPolicy()).environment,'sandbox');
    });
    await t.test('enforced live policy preserves administrators, testers and complimentary users',async()=>{
      await change({environment:'production',enabled:true,enforce:true});
      for(const id of [admin,tester,comp]){const r=await membershipState(id);assert.equal(r.access.allowed,true);assert.equal(r.access.payment_required,false);assert.ok(r.access.features.some(f=>f.code==='prices'))}
      assert.equal((await membershipState(member)).access.allowed,false);
      assert.equal((await request('/api/collection',{user:2,method:'PUT',body:{}})).status,403);
      assert.equal((await request('/api/dashboard',{user:1})).status,200);
      assert.equal((await sql`SELECT role FROM app_users WHERE id=${comp}`)[0].role,'user');
    });
    await t.test('only enabled Live public offers expose allowlisted prices, never secrets',async()=>{
      const publicData=await publicSubscriptionOffers();assert.equal(publicData.enabled,true);
      assert.equal(publicData.environment,'production');assert.equal(publicData.offers.length,1);
      const text=JSON.stringify(publicData);assert.ok(!text.includes(webhook));assert.ok(!text.includes('sk_live_'));
      assert.equal(publicData.offers[0].plan_code,'plus');
      for(const key of ['price_id','terms_hash','api_secret','webhook_secret'])assert.equal(Object.hasOwn(publicData.offers[0],key),false);
    });
    await t.test('manual Collector and Plus grants work while enforcement is enabled',async()=>{
      await setTier(admin,member,{tier:'collector',reason:'Manual tier fixture',revision:0,confirm_billing_unchanged:true});
      let r=await membershipState(member);assert.equal(r.access.tier,'collector');assert.ok(!r.access.features.some(f=>f.code==='prices'));
      await setTier(admin,member,{tier:'plus',reason:'Manual upgrade fixture',revision:1,confirm_billing_unchanged:true});
      r=await membershipState(member);assert.ok(r.access.features.some(f=>f.code==='prices'));
      assert.equal((await sql`SELECT count(*)::integer AS n FROM stripe_subscriptions WHERE user_id=${member}`)[0].n,0);
    });
    await t.test('pausing checkouts during a provider outage keeps enforcement and access unchanged',async()=>{
      await change({enabled:false},async()=>{throw new Error('No Stripe calls may be made to pause.');});
      const p=await billingPolicy();assert.equal(p.enabled,false);assert.equal(p.enforce,true);
      assert.equal((await membershipState(tester)).access.reason,'beta_tester');assert.equal((await membershipState(comp)).access.reason,'complimentary');
    });
    await t.test('a mode switch requires an explicit acknowledgement and never moves subscriptions',async()=>{
      await assert.rejects(()=>change({environment:'sandbox',enforce:false,confirm_mode_change:false}),e=>e.status===400);
      await assert.rejects(()=>change({environment:'sandbox',enforce:true}),e=>e.status===400);
      await change({environment:'sandbox',enforce:false,enabled:false});
      assert.equal((await billingPolicy()).environment,'sandbox');
    });
    await t.test('connection changes during readiness verification reject the stale activation',async()=>{
      const p=await billingPolicy();let changed=false;
      const concurrent=async(...args)=>{const r=await api(...args);if(!changed&&args[1]==='/v1/prices/price_controls'){changed=true;await sql`UPDATE stripe_connections SET revision=revision+1 WHERE environment='sandbox'`;}return r;};
      await assert.rejects(()=>change({enabled:true},concurrent),e=>e.status===409);
      assert.equal((await billingPolicy()).revision,p.revision);
    });
    await t.test('server emergency stop cannot be bypassed from the frontend',async()=>{
      process.env.STRIPE_CHECKOUT_KILL_SWITCH='true';await assert.rejects(()=>change({enabled:true}),e=>e.status===409);
      await change({enabled:false});delete process.env.STRIPE_CHECKOUT_KILL_SWITCH;
    });
    await t.test('new subscriber creation cannot remove an existing tester grant',async()=>{
      await assert.rejects(()=>createSubscriptionAccount(admin,{name:'Cannot replace tester',email:'controls-'+tester+'@example.test',password,confirm_no_tester_grant:true}),e=>e.status===409);
      assert.equal((await membershipState(tester)).grant.kind,'beta_tester');
      extraAccount=await createSubscriptionAccount(admin,{name:'New subscriber fixture',email:'new-'+randomUUID()+'@example.test',password,confirm_no_tester_grant:true});
      assert.equal((await membershipState(extraAccount.id)).grant,null);
    });
    await t.test('saved settings survive reload and the administrative audit omits credentials',async()=>{
      const a=await subscriptionControls(admin),b=await subscriptionControls(admin);assert.deepEqual(a.policy,b.policy);
      const text=JSON.stringify(a);assert.ok(!text.includes(password));assert.ok(!text.includes(webhook));assert.ok(!text.includes('sk_test_'));
      const [grant]=await sql`SELECT kind,expires_at FROM account_access_grants WHERE user_id=${tester}`;assert.equal(grant.expires_at,null);
    });
  } finally {
    await sql`DELETE FROM stripe_billing_controls`;
    await sql`DELETE FROM stripe_webhook_events WHERE event_id=${eventId}`;
    await sql`DELETE FROM stripe_offers WHERE price_id='price_controls'`;
    await sql`DELETE FROM stripe_connections WHERE account_id='acct_controls'`;
    if(extraAccount)await sql`DELETE FROM app_users WHERE id=${extraAccount.id}`;
    await sql`DELETE FROM app_users WHERE id IN ${sql(ids)}`;
    for(const key of Object.keys(process.env))if(!(key in originalEnv))delete process.env[key];
    Object.assign(process.env,originalEnv);await closeDatabase();
  }
});
