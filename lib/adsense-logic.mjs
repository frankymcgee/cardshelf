import { ensure } from './errors.mjs';
import * as v from './validate.mjs';
import { publicPage } from '../shared/platform.mjs';
export const ADSENSE_DEFAULTS = Object.freeze({ enabled: false, verification_enabled: false, publisher_id: '', slot_id: '', revision: 0 });
export function adsenseInput(input) {
  const o = v.object(input);
  ensure(Object.keys(o).every(k => ['enabled','verification_enabled','publisher_id','slot_id','revision','password','reason',
    'confirm_approval','confirm_consent','confirm_auto_ads_off'].includes(k)), 400, 'Unsupported AdSense setting. Paste IDs, not advertising HTML or scripts.');
  const result = { enabled: v.bool(o.enabled, 'AdSense'), verification_enabled: v.bool(o.verification_enabled, 'Site verification'),
    publisher_id: v.text(o.publisher_id ?? '', 'Publisher ID', 0, 23), slot_id: v.text(o.slot_id ?? '', 'Ad unit ID', 0, 20),
    revision: v.integer(o.revision, 'Revision', 0, Number.MAX_SAFE_INTEGER), reason: v.text(o.reason, 'Reason', 5, 500) };
  ensure(result.publisher_id === '' || /^ca-pub-\d{16}$/.test(result.publisher_id), 400, 'Use ca-pub- followed by the 16-digit AdSense publisher ID.');
  ensure(result.slot_id === '' || /^\d{5,20}$/.test(result.slot_id), 400, 'Use the numeric data-ad-slot value from your display ad unit.');
  ensure(!result.verification_enabled || result.publisher_id, 400, 'Enter your publisher ID before publishing site verification.');
  if (result.enabled) ensure(result.publisher_id && result.slot_id && o.confirm_approval === true && o.confirm_consent === true &&
    o.confirm_auto_ads_off === true, 400, 'Confirm site approval, published consent messages and disabled Auto ads before enabling AdSense.');
  ensure(typeof o.password === 'string' && o.password.length >= 1 && o.password.length <= 128, 400, 'Confirm your administrator password.');
  return { ...result, password: o.password };
}
export function adsenseCataloguePath(path) {
  return typeof path === 'string' && publicPage(path) && (path.replace(/\/+$/, '') === '/explore' || path.startsWith('/explore/'));
}
export function adsenseReady(settings) {
  return settings?.enabled === true && /^ca-pub-\d{16}$/.test(settings.publisher_id) && /^\d{5,20}$/.test(settings.slot_id);
}
export function adsenseDeclaration(settings) {
  return settings?.verification_enabled === true && /^ca-pub-\d{16}$/.test(settings.publisher_id)
    ? `google.com, ${settings.publisher_id.slice(3)}, DIRECT, f08c47fec0942fa0\n` : '';
}
export function adsenseCsp(nonce) {
  ensure(typeof nonce === 'string' && /^[a-f0-9]{32}$/.test(nonce), 500, 'Invalid document nonce.');
  // Google's supported strict CSP; used ONLY on an eligible Free public catalogue
  // document. The original restrictive policy remains on all private/paid pages.
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
