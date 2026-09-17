// Plan definitions are preparation only. Billing/enforcement remain disabled.
export const BINDER_TYPES = ['tracking', 'collection'];
export const TRACKING_COLOUR = '#46556d';
export const PLAN_FEATURES = Object.freeze({
  collector: Object.freeze(['tracking_binders', 'series', 'sharing', 'printing', 'marketplace_browse']),
  plus: Object.freeze(['tracking_binders', 'series', 'sharing', 'printing', 'collection', 'binders', 'prices', 'condition', 'exports', 'marketplace_browse', 'marketplace_sell'])
});
export const FEATURE_LABELS = Object.freeze({
  tracking_binders: 'Quick-add tracking binders', series: 'Set and series binder generation',
  sharing: 'Read-only binder sharing', printing: 'Printable binder checklists',
  collection: 'Detailed collection and quantity management', binders: 'Custom layouts, colours and wallpapers',
  prices: 'Market prices, history and value estimates', condition: 'Condition records and notes',
  exports: 'Collection imports and exports',
  marketplace_browse: 'Browse cards for sale and send private enquiries',
  marketplace_sell: 'List cards for sale and manage seller enquiries'
});
/**
 * Describe a public plan's capabilities for JavaScript and typed Vue consumers.
 * @param {string} code
 * @returns {Array<{code: string, label: string}>}
 */
export function planFeatures(code) {
  return Object.hasOwn(PLAN_FEATURES, code) ? PLAN_FEATURES[code].map(code => ({ code, label: FEATURE_LABELS[code] })) : [];
}
export function isTrackingBinder(binder) { return binder?.binder_type === 'tracking'; }
export function binderTypeLabel(binder) { return isTrackingBinder(binder) ? 'Tracking binder' : 'Collection binder'; }
export function trackingProgress(slots = []) {
  const total = slots.length, collected = slots.filter(s => s.is_collected === true).length;
  return { total, collected, missing: total - collected, percent: total ? Math.round(collected / total * 100) : 0 };
}
