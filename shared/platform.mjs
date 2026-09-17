// Public routes are explicit. All other UI routes continue to require sign-in.
export const PUBLIC_PAGES = ['/', '/features', '/pricing', '/early-access', '/privacy'];
export const CURRENT_FEATURES = [
  { code: 'tracking_binders', label: 'Quick-add tracking binders' },
  { code: 'collection', label: 'Collection and variant tracking' },
  { code: 'binders', label: 'Custom binders and wallpapers' },
  { code: 'series', label: 'Set and series binder creation' },
  { code: 'prices', label: 'Market prices and AUD estimates' },
  { code: 'condition', label: 'Conditions, quantities and notes' },
  { code: 'sharing', label: 'Read-only binder sharing' },
  { code: 'printing', label: 'Printable binder checklists' },
  { code: 'exports', label: 'Collection imports and exports' },
  { code: 'marketplace_browse', label: 'Marketplace browsing and private enquiries' },
  { code: 'marketplace_sell', label: 'Card listings and seller management' }
];
// Legacy beta defaults. Configured production policy is resolved server-side in membership.mjs.
export const BILLING_ENABLED = false;
export const ACCESS_ENFORCED = false;
export function cleanPath(path) { return typeof path === 'string' ? path.replace(/\/+$/, '') || '/' : ''; }
export function publicPage(path) { return PUBLIC_PAGES.includes(cleanPath(path)); }
export function sharedPage(path) { return /^\/shared\/[a-f0-9]{64}\/?$/.test(path); }
export function safeReturnTo(value) {
  if (typeof value !== 'string' || value.length > 2048 || !value.startsWith('/') || value.startsWith('//') || /[\\\r\n\u0000]/.test(value)) return '/app';
  try {
    const url = new URL(value, 'https://cardshelf.invalid');
    if (url.origin !== 'https://cardshelf.invalid') return '/app';
    const path = decodeURIComponent(url.pathname);
    if (/[%\\\r\n\u0000]/.test(path) || !/^\/(?:app|cards|binders|marketplace|settings|account|membership|referrals|admin\/(?:platform|memberships|integrations)|print)(?:\/|$)/.test(path)) return '/app';
    return url.pathname + url.search + url.hash;
  } catch { return '/app'; }
}
export function testingAccess(grant) {
  return { allowed: true, billing_enabled: BILLING_ENABLED, enforcement_enabled: ACCESS_ENFORCED,
    reason: grant?.kind === 'legacy_tester' ? 'legacy_tester' : grant?.kind === 'beta_tester' ? 'beta_tester' : 'testing_policy',
    expires_at: null, payment_required: false, features: CURRENT_FEATURES };
}
