import { ensure } from './errors.mjs';
import * as v from './validate.mjs';
import { strictObject } from './subscription-logic.mjs';

export const LIVE_CONFIRMATION = 'ENABLE LIVE SUBSCRIPTIONS';
export const MAX_WEBHOOK_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Environment flags are upgrade defaults only once no UI policy has been saved. */
export function initialBillingPolicy(env = process.env) {
  const environment = env.STRIPE_ENVIRONMENT || 'sandbox';
  ensure(['sandbox', 'production'].includes(environment), 503, 'Invalid Stripe environment.');
  const enforce = env.MEMBERSHIP_ENFORCEMENT_ENABLED === 'true';
  // Invalid old environment combinations cannot turn test payments into live access.
  ensure(!enforce || environment === 'production', 503,
    'Membership enforcement requires the production Stripe environment.');
  return {environment, enabled: env.STRIPE_BILLING_ENABLED === 'true', enforce,
    revision: 0, source: 'server_defaults'};
}

export function effectiveBillingPolicy(row, env = process.env) {
  const policy = row ? {environment: row.environment, enabled: row.subscriptions_enabled,
    enforce: row.enforcement_enabled, revision: row.revision, source: 'administrator'}
    : initialBillingPolicy(env);
  ensure(['sandbox','production'].includes(policy.environment) &&
    typeof policy.enabled === 'boolean' && typeof policy.enforce === 'boolean' &&
    (!policy.enforce || policy.environment === 'production'), 503, 'Invalid saved billing policy.');
  const emergencyStop = env.STRIPE_CHECKOUT_KILL_SWITCH === 'true';
  return {...policy, requested_enabled: policy.enabled, enabled: policy.enabled && !emergencyStop,
    emergency_stop: emergencyStop};
}

export function billingControlInput(input) {
  const o = strictObject(input, ['revision','environment','enabled','enforce','password',
    'reason','confirm_recurring','confirm_access','confirm_mode_change','live_confirmation']);
  ensure(typeof o.password==='string' && o.password.length>0 && o.password.length<=128,400,'Enter your administrator password.');
  return {revision: v.integer(o.revision, 'Revision', 0, Number.MAX_SAFE_INTEGER),
    environment: v.oneOf(o.environment, 'Environment', ['sandbox','production']),
    enabled: v.bool(o.enabled, 'Enable subscriptions'),
    enforce: v.bool(o.enforce, 'Enforce membership tiers'),
    password: o.password,
    reason: v.text(o.reason, 'Reason', 5, 500),
    confirm_recurring: v.bool(o.confirm_recurring ?? false, 'Acknowledge recurring billing'),
    confirm_access: v.bool(o.confirm_access ?? false, 'Acknowledge access changes'),
    confirm_mode_change: v.bool(o.confirm_mode_change ?? false, 'Acknowledge mode change'),
    live_confirmation: v.text(o.live_confirmation ?? '', 'Live confirmation', 0, 80)};
}

export function checkBillingTransition(previous, next) {
  ensure(!next.enforce || next.environment === 'production', 400,
    'Tier enforcement is available only in Live mode. Test payments never unlock Live access.');
  if (next.enabled) ensure(next.confirm_recurring, 400,
    'Acknowledge that subscriptions can renew automatically and pausing new sign-ups does not cancel renewals.');
  if (next.environment !== previous.environment) ensure(next.confirm_mode_change, 400,
    'Confirm the environment change. Existing subscriptions are not moved or cancelled.');
  if (next.enforce !== previous.enforce) ensure(next.confirm_access, 400,
    'Confirm the access-policy change. Protected testers and complimentary users keep full access.');
  if (next.environment === 'production' && (next.enabled || next.enforce)) {
    ensure(next.live_confirmation === LIVE_CONFIRMATION, 400,
      'Type ENABLE LIVE SUBSCRIPTIONS to confirm this Live policy.');
  }
  // Pausing new subscriptions while continuing enforcement is valid. It must not
  // remove paid access, stop webhook processing or pretend to cancel Stripe renewals.
}

export function recentlySeenWebhook(value, now = Date.now()) {
  const seen = Date.parse(value);
  return Number.isFinite(seen) && seen <= now + 60000 && now - seen <= MAX_WEBHOOK_AGE_MS;
}
