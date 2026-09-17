import { db } from './db.mjs';
import { billingPolicy } from './billing-policy.mjs';
import { stripeConfig } from './stripe-connection.mjs';
/** Public marketing gets only saleable Live offers, never Test offers or secrets. */
export async function publicSubscriptionOffers() {
  const policy=await billingPolicy();
  if(policy.environment!=='production'||!policy.enabled)return {enabled:false,offers:[]};
  const cfg=await stripeConfig('production');
  if(!cfg.configured||!cfg.accepting)return {enabled:false,offers:[]};
  const offers=await db()`SELECT id,plan_code,cadence,total_minor,tax_minor,product_snapshot,tax_mode,tax_behavior FROM stripe_offers
    WHERE environment='production' AND published ORDER BY plan_code,cadence`;
  return {enabled:true,environment:'production',offers};
}
