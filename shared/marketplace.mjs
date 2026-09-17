// Marketplace prices are seller asks, never a valuation or evidence of payment.
export const SALE_CONDITIONS = ['NM', 'LP', 'MP', 'HP', 'DMG', 'UNKNOWN'];
export const DELIVERY_OPTIONS = ['postage', 'pickup', 'both'];
export const REPORT_REASONS = ['suspected_counterfeit', 'misleading', 'prohibited', 'abuse', 'other'];
export const SALE_STATES = ['active', 'reserved', 'sold', 'withdrawn'];
const TRANSITIONS = Object.freeze({
  active: ['active', 'reserved', 'sold', 'withdrawn'],
  reserved: ['reserved', 'active', 'sold', 'withdrawn'],
  withdrawn: ['withdrawn', 'active'],
  sold: ['sold']
});
export function canTransitionSale(from, to) {
  return Object.hasOwn(TRANSITIONS, from) && TRANSITIONS[from].includes(to);
}
export function sellerAccess({ enforcement = false, grant = null, plan = '', status = '' } = {}) {
  if (!enforcement) return { allowed: true, reason: 'testing_policy' };
  if (grant && ['legacy_tester', 'beta_tester'].includes(grant.kind) && grant.expires_at == null)
    return { allowed: true, reason: 'tester_grant' };
  return { allowed: plan === 'plus' && status === 'active', reason: 'collector_plus' };
}
export function aud(amount) {
  return Number.isSafeInteger(amount) && amount >= 0
    ? new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(amount / 100)
    : 'Not available';
}
export function parseAud(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!/^\d{1,6}(?:\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ''] = text.split('.');
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(minor) ? minor : null;
}
export function saleStateLabel(state) {
  return ({ active: 'For sale', reserved: 'Reserved', sold: 'Sold · seller reported', withdrawn: 'Withdrawn' })[state] || 'Unavailable';
}
