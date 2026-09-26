// Limits do not grant collection or game access. Zero removes only the member cap.
export const SCAN_TIERS = Object.freeze([
  {code:'free', name:'Free', note:'Catalogue only; scanning is not included.'},
  {code:'collector', name:'Collector', note:'Scanning requires collection access; this tier does not include it when tier enforcement is enabled.'},
  {code:'plus', name:'Collector Plus / Pro', note:'Applies to paid subscriptions and manual Plus grants.'},
  {code:'complimentary', name:'Complimentary & testers', note:'Includes administrators and protected tester accounts.'}
]);
export function scanTierLimits(settings) {
  return Object.fromEntries(SCAN_TIERS.map(({code}) => [code, settings[code+'_monthly_limit']]));
}
export function scanAllowance(limits, tier, used = 0) {
  const limit = Object.hasOwn(limits, tier) ? limits[tier] : null;
  const valid = Number.isInteger(limit) && limit >= 0;
  return {tier, used, monthly_limit:valid ? limit : null, unlimited:valid && limit === 0,
    remaining:valid && limit > 0 ? Math.max(0,limit-used) : null,
    allowed:valid && (limit === 0 || used < limit)};
}
export function scanAllowanceLabel(limit) {
  return limit === 0 ? 'Unlimited photo scans' : Number.isInteger(limit) && limit > 0
    ? `${limit.toLocaleString('en-AU')} photo scans per month` : 'Photo scan allowance not available';
}
