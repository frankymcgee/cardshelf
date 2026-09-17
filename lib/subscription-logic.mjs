import { createHash } from 'node:crypto';
import { ensure } from './errors.mjs';
import * as v from './validate.mjs';
export const hashValue = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function strictObject(input, keys) {
  const o=v.object(input); ensure(Object.keys(o).every(k=>keys.includes(k)),400,'Unsupported request field.'); return o;
}

export function isoDate(value) {
  return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
}

export function today(timezone='Australia/Perth',now=new Date()) {
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
  return ['year','month','day'].map(k=>parts.find(p=>p.type===k).value).join('-');
}
export function referralInput(input) {
  const o=strictObject(input,['status','reward_type','reward_value','max_payments','hold_days','terms','revision']);
  const type=v.oneOf(o.reward_type,'Reward type',['percentage','fixed']);
  return {status:v.oneOf(o.status,'Status',['approved','suspended']),reward_type:type,
    reward_value:v.integer(o.reward_value,'Reward value',0,type==='percentage'?10000:1000000),
    max_payments:v.integer(o.max_payments??1,'Rewarded payments',1,120),hold_days:v.integer(o.hold_days??30,'Hold days',0,180),
    terms:v.text(o.terms,'Referral terms',30,6000),revision:v.integer(o.revision,'Revision',0,Number.MAX_SAFE_INTEGER)};
}

export function referralReady(partner) {return partner?.status==='approved'&&Boolean(partner.opted_in_at)&&partner.opted_in_revision===partner.revision;}

export function commissionAmount(invoice,terms,environment='production') {
  if(environment!=='production'||!invoice.settled||invoice.disputed||invoice.refund_pending)return 0;
  const {paid_minor:paid,refunded_minor:refund,total_minor:total,tax_minor:tax}=invoice;
  if(![paid,refund,total,tax].every(n=>Number.isSafeInteger(n)&&n>=0)||!total||tax>total||refund>paid||paid>total)return 0;
  const base=BigInt(total-tax)*BigInt(paid-refund)/BigInt(total);
  if(!Number.isSafeInteger(terms.reward_value)||terms.reward_value<0)return 0;
  const value=BigInt(terms.reward_value);
  if(terms.reward_type==='percentage'&&value<=10000n)return Number(base*value/10000n);
  if(terms.reward_type==='fixed'){const full=BigInt(total-tax),cap=full<value?full:value;return Number(cap*BigInt(paid-refund)/BigInt(total));}
  return 0;
}

export function tierInput(input) {
  const o=strictObject(input,['tier','reason','expires_at','revision','confirm_billing_unchanged']);
  ensure(o.confirm_billing_unchanged===true,400,'Confirm that tier changes do not cancel or create subscription billing.');
  const tier=v.oneOf(o.tier,'Tier',['inherit','collector','plus','complimentary']);
  const expires=o.expires_at==null?null:v.text(o.expires_at,'Expiry',10,40);
  ensure(!expires||(Number.isFinite(Date.parse(expires))&&Date.parse(expires)>Date.now()),400,'Expiry must be in the future.');
  ensure(tier!=='complimentary'||expires===null,400,'Complimentary access is non-expiring.');
  return {tier,expires_at:expires,reason:v.text(o.reason,'Reason',5,500),revision:v.integer(o.revision,'Revision',0,Number.MAX_SAFE_INTEGER)};
}

/** Resolve access from stored, verified entitlements; never from a checkout redirect. */
export function membershipAccess({user, grant, override, subscription, features,
  collectorFeatures, enforce = false, environment = 'sandbox', date = today(), now = Date.now()}) {
  let tier = null, reason = 'subscription_required';
  if (user?.role === 'admin') { tier = 'complimentary'; reason = 'administrator'; }
  else if (['legacy_tester', 'beta_tester'].includes(grant?.kind)) {
    tier = 'complimentary'; reason = grant.kind;
  } else if (override?.tier === 'complimentary') {
    tier = 'complimentary'; reason = 'complimentary';
  } else if (override && ['collector', 'plus'].includes(override.tier) &&
    (!override.expires_at || Date.parse(override.expires_at) > now)) {
    tier = override.tier; reason = 'administrator_assignment';
  } else if (subscription?.environment === environment &&
    ['collector', 'plus'].includes(subscription.offer_snapshot?.plan_code)) {
    // Stripe periods are timestamps. Historical provider periods are exclusive
    // local dates and are retained read-only until their already-verified expiry.
    const paid = subscription.provider === 'legacy'
      ? isoDate(subscription.paid_through) && subscription.paid_through > date
      : Number.isFinite(Date.parse(subscription.paid_through)) && Date.parse(subscription.paid_through) > now;
    if (paid) { tier = subscription.offer_snapshot.plan_code;
      reason = subscription.provider === 'legacy' ? 'legacy_paid_period' : 'stripe_subscription'; }
  }
  if (!enforce && !tier) { tier = 'plus'; reason = 'testing_policy'; }
  const effective = enforce && tier === 'collector'
    ? features.filter(f => collectorFeatures.includes(f.code)) : tier ? features : [];
  return {allowed: effective.length > 0, tier, reason, expires_at: null,
    payment_required: !tier, billing_enabled: false, enforcement_enabled: enforce, features: effective};
}
