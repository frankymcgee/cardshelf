// Shared marketing presentation only; never an entitlement or checkout authority.
import { productGroups, productPresentation } from './stripe-products.mjs';
import { planFeatures } from './binder-types.mjs';
/**
 * @typedef {Object} PricingOffer
 * @property {string} plan_code
 * @property {string} cadence
 * @property {number} total_minor
 * @property {number} tax_minor
 * @property {string} tax_mode
 * @property {string} tax_behavior
 * @property {boolean} [tax_inclusive]
 * @property {ReturnType<typeof productPresentation>} product_snapshot
 */
/**
 * @typedef {Object} PricingPlan
 * @property {string} code
 * @property {string} name
 * @property {string} description
 * @property {ReturnType<typeof productPresentation>} product
 * @property {Array<{name: string}>} features
 * @property {PricingOffer[]} offers
 */
const DEFAULT_PLANS = [
  { code: 'collector', name: 'Collector', description: 'A card checklist without the paperwork. Generate a set or series binder, then tap to mark each find.' },
  { code: 'plus', name: 'Collector Plus', description: 'Everything in Collector, with tools to value, organise and personalise your collection.' }
];
/**
 * Photo scan quotas come from CardShelf's current tier settings, not saved
 * Stripe marketing copy. Filter only the display list; retain the snapshot.
 * @param {Array<{name: string}>} features
 * @returns {Array<{name: string}>}
 */
export function pricingFeatures(features) {
  return features.filter(({ name }) => !(
    /\b(?:scans?|scanning)\b/i.test(name) &&
    /\d|\b(?:unlimited|photo|card|image|ai)\b/i.test(name)
  ));
}
/** @param {PricingOffer[]} offers @param {boolean} [includeDefaults] @returns {PricingPlan[]} */
export function pricingPlans(offers, includeDefaults = true) {
  const values = Array.isArray(offers) ? offers : [];
  const groups = productGroups(values);
  if (groups.some(g => g.product.id)) return groups.map(g => ({
    ...g, name: g.product.name, description: g.product.description, features: pricingFeatures(g.product.marketing_features)
  }));
  return DEFAULT_PLANS.filter(p => includeDefaults || groups.some(g => g.code === p.code)).map(p => ({
    ...p, product: productPresentation(), features: planFeatures(p.code).map(f => ({ name: f.label })),
    offers: values.filter(o => o.plan_code === p.code)
  }));
}
/** @param {PricingOffer[]} offers @param {string} current @returns {string} */
export function pricingCadence(offers, current) {
  if (['MONTHLY', 'ANNUAL'].includes(current) && offers.some(o => o.cadence === current)) return current;
  return offers.some(o => o.cadence === 'MONTHLY') ? 'MONTHLY'
    : offers.some(o => o.cadence === 'ANNUAL') ? 'ANNUAL' : 'MONTHLY';
}
/** @param {PricingPlan} plan @returns {number} */
export function annualSaving(plan) {
  const month = plan.offers.find(o => o.cadence === 'MONTHLY'), year = plan.offers.find(o => o.cadence === 'ANNUAL');
  return month && year && month.tax_mode === year.tax_mode && month.tax_behavior === year.tax_behavior && month.tax_inclusive === year.tax_inclusive
    ? Math.max(0, month.total_minor * 12 - year.total_minor) : 0;
}
