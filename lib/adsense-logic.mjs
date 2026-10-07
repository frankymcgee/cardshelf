import { ensure } from './errors.mjs';
import * as v from './validate.mjs';
import { adsensePageKind } from '../shared/adsense-policy.mjs';
import { ADSTERRA_FORMATS, adsterraReady } from '../shared/adsterra.mjs';
export const ADSENSE_DEFAULTS = Object.freeze({ provider: 'adsense', adsterra_units: {}, placeholders_enabled: false, enabled: false, verification_enabled: false, publisher_id: '', slot_id: '', auto_ads_enabled: false, marketplace_enabled: false, marketplace_slot_id: '', revision: 0 });
export function adsenseInput(input) {
  const o = v.object(input);
  ensure(Object.keys(o).every(k => ['provider','adsterra_units','placeholders_enabled','enabled','verification_enabled','publisher_id','slot_id','revision','password','reason',
    'auto_ads_enabled','marketplace_enabled','marketplace_slot_id','confirm_scope','confirm_auto_ads',
    'confirm_approval','confirm_consent','confirm_auto_ads_off'].includes(k)), 400, 'Unsupported AdSense setting. Paste IDs, not advertising HTML or scripts.');
  const units = v.object(o.adsterra_units ?? {}, 'Adsterra units');
  ensure(Object.keys(units).every(key => Object.hasOwn(ADSTERRA_FORMATS, key)), 400, 'Unsupported Adsterra format.');
  const adsterra_units = {};
  for (const [format, value] of Object.entries(units)) {
    const key = v.text(value, 'Adsterra unit key', 0, 32);
    ensure(key === '' || /^[a-f0-9]{32}$/.test(key), 400, 'Use the 32-character Adsterra unit key, not a script or URL.');
    if (key) adsterra_units[format] = key;
  }
  ensure(new Set(Object.values(adsterra_units)).size === Object.keys(adsterra_units).length, 400, 'Each Adsterra format needs its own unique unit key.');
  const result = { provider: v.oneOf(o.provider ?? 'adsense', 'Advertising provider', ['adsense','adsterra']), adsterra_units,
    placeholders_enabled: v.bool(o.placeholders_enabled ?? false, 'Ad placeholders'), enabled: v.bool(o.enabled, 'Advertising'), verification_enabled: v.bool(o.verification_enabled, 'Site verification'),
    auto_ads_enabled: v.bool(o.auto_ads_enabled ?? false, 'Auto ads'), marketplace_enabled: v.bool(o.marketplace_enabled ?? false, 'Marketplace ad cards'),
    marketplace_slot_id: v.text(o.marketplace_slot_id ?? '', 'Marketplace ad unit ID', 0, 20),
    publisher_id: v.text(o.publisher_id ?? '', 'Publisher ID', 0, 23), slot_id: v.text(o.slot_id ?? '', 'Ad unit ID', 0, 20),
    revision: v.integer(o.revision, 'Revision', 0, Number.MAX_SAFE_INTEGER), reason: v.text(o.reason, 'Reason', 5, 500) };
  ensure(result.publisher_id === '' || /^ca-pub-\d{16}$/.test(result.publisher_id), 400, 'Use ca-pub- followed by the 16-digit AdSense publisher ID.');
  ensure(result.slot_id === '' || /^\d{5,20}$/.test(result.slot_id), 400, 'Use the numeric data-ad-slot value from your display ad unit.');
  ensure(result.marketplace_slot_id === '' || /^\d{5,20}$/.test(result.marketplace_slot_id), 400, 'Use a numeric marketplace display ad unit ID.');
  ensure(!result.marketplace_enabled || result.marketplace_slot_id, 400, 'Enter the marketplace display ad unit ID.');
  ensure(!result.verification_enabled || result.publisher_id, 400, 'Enter your publisher ID before publishing site verification.');
  if (result.enabled && result.provider === 'adsterra') {
    ensure(adsterraReady(result.adsterra_units), 400, 'Add at least one Adsterra banner or native unit.');
    ensure(o.confirm_approval === true && o.confirm_consent === true && o.confirm_scope === true, 400,
      'Confirm Adsterra site approval, privacy and consent setup, and Free-only page scope.');
  } else if (result.enabled) {
    ensure(result.publisher_id && (result.slot_id || result.auto_ads_enabled || result.marketplace_enabled) &&
      o.confirm_approval === true && o.confirm_consent === true, 400, 'Confirm site approval and published consent messages and select at least one advertising mode.');
    ensure(result.auto_ads_enabled ? o.confirm_auto_ads === true : o.confirm_auto_ads_off === true, 400,
      result.auto_ads_enabled ? 'Confirm Auto ads configuration in Google AdSense.' : 'Disable Auto ads in Google AdSense when using manual placements only.');
    if (result.auto_ads_enabled || result.marketplace_enabled) ensure(o.confirm_scope === true, 400,
      'Confirm Free-only page scope, private-screen exclusions and no other global advertising loader.');
  }
  ensure(typeof o.password === 'string' && o.password.length >= 1 && o.password.length <= 128, 400, 'Confirm your administrator password.');
  return { ...result, password: o.password };
}
// Legacy helper retained for catalogue-only consumers. New routing uses the
// complete request URL through adsensePageKind(), including private query modes.
export function adsenseCataloguePath(path) {
  return typeof path === 'string' && !path.includes('?') && adsensePageKind(path) === 'catalogue';
}
export function adsenseReady(settings) {
  if (settings?.provider === 'adsterra') return settings.enabled === true && adsterraReady(settings.adsterra_units);
  return settings?.enabled === true && /^ca-pub-\d{16}$/.test(settings.publisher_id) &&
    (/^\d{5,20}$/.test(settings.slot_id) || settings.auto_ads_enabled === true ||
      (settings.marketplace_enabled === true && /^\d{5,20}$/.test(settings.marketplace_slot_id)));
}
export function adsenseDeclaration(settings) {
  return settings?.verification_enabled === true && /^ca-pub-\d{16}$/.test(settings.publisher_id)
    ? `google.com, ${settings.publisher_id.slice(3)}, DIRECT, f08c47fec0942fa0\n` : '';
}
export function adsenseCsp(nonce) {
  ensure(typeof nonce === 'string' && /^[a-f0-9]{32}$/.test(nonce), 500, 'Invalid document nonce.');
  // Google's supported strict CSP; used ONLY on a server-approved Free ad
  // document. Sensitive screens and paid/protected accounts retain the default.
  return `object-src 'none'; script-src 'nonce-${nonce}' 'unsafe-inline' 'unsafe-eval' 'strict-dynamic' https: http:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`;
}
export function nonceScriptTags(html, nonce) {
  adsenseCsp(nonce); // Validate before inserting an attribute.
  return html.replace(/<script\b([^>]*)>/gi, (_, attrs) => {
    const clean = attrs.replace(/\snonce\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
    return `<script nonce="${nonce}"${clean}>`;
  }).replace(/<link\b([^>]*\brel\s*=\s*["']modulepreload["'][^>]*)>/gi, (_, attrs) =>
    `<link nonce="${nonce}"${attrs.replace(/\snonce\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')}>`);
}
