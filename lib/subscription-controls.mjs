import { db, audit } from './db.mjs';
import { ensure } from './errors.mjs';
import { billingPolicy, BILLING_CONTROL_LOCK } from './billing-policy.mjs';
import { billingControlInput, checkBillingTransition, recentlySeenWebhook } from './billing-control-logic.mjs';
import { stripeConfig, stripeAdmin } from './stripe-connection.mjs';
import { stripeRequest } from './stripe-client.mjs';
import { stripeEnvironment, stripeId, stripePrice, stripeOrigin, verifyStripePortal } from './stripe-logic.mjs';

async function impact(sql) {
  const [counts] = await sql`SELECT count(*)::integer AS total,
    count(*) FILTER (WHERE u.role='admin' OR g.user_id IS NOT NULL OR o.tier='complimentary')::integer AS protected,
    count(*) FILTER (WHERE u.role<>'admin' AND g.user_id IS NULL
      AND coalesce(o.tier,'inherit')<>'complimentary'
      AND NOT (coalesce(o.tier IN ('collector','plus'),false) AND (o.expires_at IS NULL OR o.expires_at>now()))
      AND NOT EXISTS (SELECT 1 FROM stripe_subscriptions s WHERE s.user_id=u.id
        AND s.environment='production' AND s.paid_through>now())
      AND NOT EXISTS (SELECT 1 FROM square_subscriptions s WHERE s.user_id=u.id
        AND s.environment='production' AND s.paid_through>to_char(now() AT TIME ZONE 'Australia/Perth','YYYY-MM-DD'))
    )::integer AS without_live_access
    FROM app_users u LEFT JOIN account_access_grants g ON g.user_id=u.id
    LEFT JOIN account_tier_overrides o ON o.user_id=u.id`;
  return counts;
}

/** The overview is administrative and contains no credentials or personal account rows. */
export async function subscriptionControls(userId) {
  await stripeAdmin(userId);
  const sql=db(), policy=await billingPolicy(sql);
  const [connections,offers,counts,heartbeat,legacy] = await Promise.all([
    sql`SELECT environment,account_name,portal_id,checked_at,webhook_seen_at FROM stripe_connections`,
    sql`SELECT environment,count(*)::integer AS count FROM stripe_offers WHERE published GROUP BY environment`,
    impact(sql),
    sql`SELECT updated_at FROM app_state WHERE key='stripe_heartbeat'`,
    sql`SELECT count(*)::integer AS count FROM square_subscriptions WHERE current`
  ]);
  return {policy,impact:counts,worker_seen_at:heartbeat[0]?.updated_at??null,
    legacy_open_records:legacy[0].count,
    environments:await Promise.all(['sandbox','production'].map(async environment=>{
      const cfg=await stripeConfig(environment),c=connections.find(c=>c.environment===environment);
      return {environment,configured:cfg.configured,account_name:c?.account_name??'',
        portal_configured:Boolean(c?.portal_id),published_offers:offers.find(o=>o.environment===environment)?.count??0,
        webhook_seen_at:c?.webhook_seen_at??null,webhook_recent:recentlySeenWebhook(c?.webhook_seen_at),
        accepting_new:cfg.accepting};
    }))};
}

/** All external calls here are GETs. Enabling the policy never creates a payment. */
async function verifyActivation(userId, environment, api) {
  const cfg=await stripeConfig(environment),sql=db();
  ensure(cfg.configured&&cfg.portalId,409,'Save Stripe credentials and a customer portal for this environment first.');
  stripeOrigin(environment);
  const account=await api(cfg,'/v1/account'),balance=await api(cfg,'/v1/balance');
  ensure(stripeId(account.id,'acct')===cfg.account&&balance.livemode===(environment==='production'),409,
    'Stripe business or key mode does not match the selected environment.');
  if(environment==='production')ensure(account.charges_enabled===true,409,'Stripe has not enabled charges for this business.');
  verifyStripePortal(await api(cfg,'/v1/billing_portal/configurations/'+cfg.portalId));
  const [connection]=await sql`SELECT revision,webhook_seen_at FROM stripe_connections WHERE environment=${environment}`;
  ensure(connection&&connection.revision===cfg.connection_revision,409,'Stripe credentials changed during verification. Retry.');
  if(environment==='production')ensure(recentlySeenWebhook(connection.webhook_seen_at),409,
    'A signed Live webhook must have reached CardShelf within the last seven days. Verify the Live endpoint before activation.');
  if(environment==='production') {
    const [verifiedEvent]=await sql`SELECT event_id FROM stripe_webhook_events WHERE environment='production'
      AND status='done' AND received_at>now()-interval '7 days' LIMIT 1`;
    ensure(verifiedEvent,409,'A signed Live webhook must also finish authenticated reconciliation. Check the webhook queue before activation.');
  }
  const offers=await sql`SELECT * FROM stripe_offers WHERE environment=${environment} AND published ORDER BY id LIMIT 5`;
  ensure(offers.length>0&&offers.length<=4,409,'Publish at least one compatible subscription offer for this environment.');
  for(const offer of offers) {
    const price=await api(cfg,'/v1/prices/'+stripeId(offer.price_id,'price'));
    const tax=offer.tax_rate_id?await api(cfg,'/v1/tax_rates/'+stripeId(offer.tax_rate_id,'txr')):null;
    const checked=stripePrice(price,environment,tax);
    for(const key of ['price_id','cadence','amount_minor','total_minor','tax_minor','tax_bps','tax_inclusive','tax_rate_id']) {
      ensure(checked[key]===offer[key],409,'A published price or tax changed in Stripe. Review and republish the offer.');
    }
    ensure(['collector','plus'].includes(offer.plan_code)&&offer.terms?.length>=60,409,'A published offer needs reviewed subscription terms.');
  }
  return {connectionRevision:connection.revision,offers:offers.map(o=>({id:o.id,revision:o.revision}))};
}

export async function saveSubscriptionControls(userId,input,api=stripeRequest) {
  const next=billingControlInput(input);
  await stripeAdmin(userId,next.password);
  const previous=await billingPolicy();
  ensure(previous.revision===next.revision,409,'Subscription settings changed. Reload before saving.');
  checkBillingTransition(previous,next);
  ensure(!next.enabled||!previous.emergency_stop,409,
    'The server emergency checkout stop is active. Clear it on the server before enabling new subscriptions.');
  // Pausing or turning enforcement off remains possible during a Stripe outage.
  const needsVerification=next.enabled || (next.enforce && (!previous.enforce || previous.environment!==next.environment));
  const verified=needsVerification?await verifyActivation(userId,next.environment,api):null;
  return db().begin(async sql=>{
    await sql`SELECT pg_advisory_xact_lock(${BILLING_CONTROL_LOCK})`;
    const current=await billingPolicy(sql);
    ensure(current.revision===next.revision,409,'Subscription settings changed during verification. Reload.');
    checkBillingTransition(current,next);
    if(verified) {
      const [connection]=await sql`SELECT revision FROM stripe_connections WHERE environment=${next.environment} FOR UPDATE`;
      ensure(connection?.revision===verified.connectionRevision,409,'Stripe connection changed during verification. Retry.');
      const offers=await sql`SELECT id,revision FROM stripe_offers WHERE environment=${next.environment} AND published ORDER BY id FOR SHARE`;
      ensure(JSON.stringify(offers.map(o=>({id:o.id,revision:o.revision})))===JSON.stringify(verified.offers),409,
        'Subscription offers changed during verification. Review them and retry.');
    }
    const [saved]=await sql`INSERT INTO stripe_billing_controls(id,environment,subscriptions_enabled,enforcement_enabled,updated_by)
      VALUES(1,${next.environment},${next.enabled},${next.enforce},${userId})
      ON CONFLICT(id) DO UPDATE SET environment=excluded.environment,subscriptions_enabled=excluded.subscriptions_enabled,
      enforcement_enabled=excluded.enforcement_enabled,revision=stripe_billing_controls.revision+1,
      updated_by=excluded.updated_by,updated_at=now() RETURNING revision`;
    // One activation action enables both existing checkout gates for the chosen mode.
    // Other environments and every existing subscription are left untouched.
    await sql`UPDATE stripe_connections SET accepting_new=${next.enabled},revision=revision+1,updated_at=now()
      WHERE environment=${next.environment} AND accepting_new IS DISTINCT FROM ${next.enabled}`;
    await audit(sql,userId,'stripe.subscription_controls_changed',{
      environment:next.environment,subscriptions_enabled:next.enabled,enforcement_enabled:next.enforce,
      revision:saved.revision,reason:next.reason});
    return {saved:true,revision:saved.revision,policy:await billingPolicy(sql),
      payments_created:false,existing_subscriptions_unchanged:true,tester_grants_unchanged:true};
  });
}
