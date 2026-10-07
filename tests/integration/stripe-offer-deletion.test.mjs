import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import '../helpers/block-payment-network.mjs';
import {stripeFixture} from '../helpers/stripe-fixtures.mjs';
import {db,closeDatabase} from '../../lib/db.mjs';
import {hashPassword,randomToken,digest} from '../../lib/security.mjs';
import {deleteStripeOffer,publishStripeOffer,saveStripeOffer,stripeStatus} from '../../lib/stripe-connection.mjs';

const base=process.env.TEST_BASE_URL;
if(process.env.ALLOW_TEST_DATABASE!=='yes'||!base||!new URL(process.env.DATABASE_URL||'http://invalid').pathname.endsWith('_test'))throw new Error('Use only a disposable _test database.');
const originalOrigin=process.env.APP_ORIGIN,requestOrigin=originalOrigin||base;
const sql=db(),admin=randomUUID(),member=randomUUID(),tokens=[randomToken(),randomToken()],offerIds=[],connections=[];
const terms='Monthly CardShelf membership. Cancel before renewal through Membership. Contact the operator for support and refund requests.';
async function draft(environment='production',values={}) {
  const id=randomUUID();offerIds.push(id);
  const [row]=await sql`INSERT INTO stripe_offers ${sql({id,environment,price_id:'price_'+id.replaceAll('-',''),plan_code:'collector',cadence:'MONTHLY',amount_minor:1000,total_minor:1000,tax_minor:0,terms,terms_hash:'draft-fixture',...values})} RETURNING *`;
  return row;
}
async function request(offer,{user=0,environment=offer.environment,body={revision:offer.revision,confirm:true},origin=requestOrigin}={}) {
  const response=await fetch(base+'/api/admin/integrations/stripe/offers/'+offer.id+'/delete?environment='+environment,{
    method:'POST',headers:{Origin:origin,'X-Requested-With':'cardshelf','Content-Type':'application/json',...(user===null?{}:{Cookie:'cardshelf_session='+tokens[user]})},body:JSON.stringify(body)
  });
  return {status:response.status,data:await response.json()};
}
const priceApi=async(cfg,path)=>{
  assert.match(path,/^\/v1\/prices\/price_/);
  return {...stripeFixture(cfg.environment).price,id:path.split('/').at(-1)};
};
const statusOffer=async offer=>(await stripeStatus(admin,offer.environment)).offers.find(o=>o.id===offer.id);

await test('administrators can remove unused Stripe drafts and correct their tier',async t=>{
  try {
    process.env.APP_ORIGIN='https://cardshelf.example.test';
    const hash=await hashPassword('Draft deletion fixture password 123');
    for(const [i,id] of [admin,member].entries()) {
      await sql`INSERT INTO app_users(id,email,name,password_hash,role) VALUES(${id},${id+'@example.test'},'Draft offer fixture',${hash},${i===0?'admin':'user'})`;
      await sql`INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(${digest(tokens[i])},${id},now()+interval '1 hour')`;
    }
    for(const environment of ['sandbox','production']) {
      const added=await sql`INSERT INTO stripe_connections(environment,account_id,api_secret,webhook_secret) VALUES(${environment},'acct_offer_deletion_fixture','unconfigured-fixture','unconfigured-fixture') ON CONFLICT DO NOTHING RETURNING environment`;
      if(added.length)connections.push(environment);
    }
    await t.test('API requires an administrator, same origin and explicit confirmation',async()=>{
      const offer=await draft();
      assert.equal((await request(offer,{user:null})).status,401);
      assert.equal((await request(offer,{user:1})).status,403);
      assert.equal((await request(offer,{origin:'https://other.example'})).status,403);
      assert.equal((await request(offer,{body:{revision:1}})).status,400);
      assert.equal((await request(offer,{body:{revision:1,confirm:false}})).status,400);
      await assert.rejects(()=>deleteStripeOffer(member,'production',offer.id,{revision:1,confirm:true}),e=>e.status===403);
      assert.equal((await statusOffer(offer)).can_delete,true);
    });
    await t.test('deletion rejects another environment and stale offer revisions',async()=>{
      const offer=await draft();
      assert.equal((await request(offer,{environment:'sandbox'})).status,404);
      assert.equal((await request(offer,{body:{revision:2,confirm:true}})).status,409);
      assert.equal((await statusOffer(offer)).can_delete,true);
    });
    await t.test('published and Stripe-managed offers remain protected',async()=>{
      for(const values of [{published:true},{sync_managed:true}]) {
        const offer=await draft('production',values);
        assert.equal((await statusOffer(offer)).can_delete,false);
        assert.equal((await request(offer)).status,409);
        assert.ok(await statusOffer(offer));
      }
      await sql`INSERT INTO stripe_product_sync(environment,managed) VALUES('sandbox',true)`;
      try {
        const offer=await draft('sandbox');
        assert.equal((await statusOffer(offer)).can_delete,false);
        assert.equal((await request(offer)).status,409);
      } finally {await sql`DELETE FROM stripe_product_sync WHERE environment='sandbox'`;}
    });
    await t.test('pending checkout and cancelled subscription history prevent deletion',async()=>{
      for(const status of ['pending','canceled']) {
        const offer=await draft();
        const [subscription]=await sql`INSERT INTO stripe_subscriptions(user_id,environment,request_id,offer_id,offer_snapshot,checkout_expires_at,status,current)
          VALUES(${member},'production',${randomUUID()},${offer.id},${sql.json(offer)},now()+interval '1 hour',${status},${status==='pending'}) RETURNING id`;
        assert.equal((await statusOffer(offer)).can_delete,false);
        const result=await request(offer);assert.equal(result.status,409);assert.match(result.data.message,/checkout or subscription history/);
        assert.equal((await sql`SELECT offer_id FROM stripe_subscriptions WHERE id=${subscription.id}`)[0].offer_id,offer.id);
      }
    });
    for(const environment of ['sandbox','production'])await t.test(environment+' deletes only the draft mapping and allows the same price on Collector Plus',async()=>{
      const offer=await draft(environment);
      const result=await request(offer);assert.equal(result.status,200);assert.equal(result.data.deleted,true);
      assert.equal(await statusOffer(offer),undefined);
      const [audit]=await sql`SELECT detail FROM audit_log WHERE user_id=${admin} AND action='stripe.offer_deleted' AND detail->>'offer_id'=${offer.id}`;
      assert.deepEqual(audit.detail,{environment,offer_id:offer.id,price_id:offer.price_id,plan_code:'collector'});
      const corrected=await saveStripeOffer(admin,environment,{price_id:offer.price_id,plan_code:'plus',terms},priceApi);offerIds.push(corrected.id);
      const [row]=await sql`SELECT plan_code,published FROM stripe_offers WHERE id=${corrected.id}`;
      assert.deepEqual(row,{plan_code:'plus',published:false});
      assert.equal((await request(offer)).status,404);
    });
    await t.test('a draft being published cannot also be deleted from a stale screen',async()=>{
      const offer=await draft('sandbox');
      const results=await Promise.allSettled([
        publishStripeOffer(admin,'sandbox',offer.id,{revision:1,published:true,confirm_terms_reviewed:true},priceApi),
        deleteStripeOffer(admin,'sandbox',offer.id,{revision:1,confirm:true})
      ]);
      assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
      const failed=results.find(r=>r.status==='rejected');assert.ok([404,409].includes(failed.reason.status));
      const remaining=await statusOffer(offer);
      if(results[0].status==='fulfilled')assert.equal(remaining.published,true);
      else assert.equal(remaining,undefined);
    });
  } finally {
    await sql`DELETE FROM stripe_subscriptions WHERE user_id=${member}`;
    if(offerIds.length)await sql`DELETE FROM stripe_offers WHERE id IN ${sql(offerIds)}`;
    if(connections.length)await sql`DELETE FROM stripe_connections WHERE environment IN ${sql(connections)}`;
    await sql`DELETE FROM audit_log WHERE user_id IN ${sql([admin,member])}`;
    await sql`DELETE FROM app_users WHERE id IN ${sql([admin,member])}`;
    if(originalOrigin===undefined)delete process.env.APP_ORIGIN;else process.env.APP_ORIGIN=originalOrigin;
    await closeDatabase();
  }
});
