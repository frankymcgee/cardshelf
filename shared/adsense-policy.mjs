// One allowlist shared by the server, browser and navigation boundary. Unknown
// routes stay ad-free; broad /admin/** or /marketplace/** matches are never used.
import { gameFromCardId } from './games.mjs';
import { adsterraReady } from './adsterra.mjs';
const MARKETING = ['/', '/features', '/pricing'];
const WORKSPACE = ['/app', '/cards'];
const SAFE_QUERY = new Set(['q','game','set','language','rarity','artist','dex','ownership','sort','order','condition','page','mine']);
/** @param {unknown} value @returns {'marketing'|'workspace'|'catalogue'|'marketplace'|null} */
export function adsensePageKind(value) {
  if (typeof value !== 'string' || value.length > 4096 || !value.startsWith('/') || value.startsWith('//') || /[\\#\x00-\x20\x7f]/.test(value)) return null;
  const [raw = ''] = value.split('?', 1);
  let path;
  try { path = decodeURIComponent(raw); } catch { return null; }
  if (/[%\\\x00-\x20\x7f]/.test(path) || path.includes('//') || path.split('/').some(p => p === '.' || p === '..')) return null;
  path = path.replace(/\/$/, '') || '/';
  let url;
  try { url = new URL(value, 'https://cardshelf.invalid'); } catch { return null; }
  const seen = new Set();
  for (const [key] of url.searchParams) {
    // A private card dialog, opt-out, checkout return or unknown query cannot
    // inherit the advertising policy of its surrounding catalogue path.
    if (!SAFE_QUERY.has(key) || seen.has(key)) return null;
    seen.add(key);
  }
  if (MARKETING.includes(path)) return url.search ? null : 'marketing';
  if (WORKSPACE.includes(path)) return 'workspace';
  if (path === '/marketplace') {
    const mine = url.searchParams.get('mine');
    return mine !== null && !['0', 'false'].includes(mine) ? null : 'marketplace';
  }
  if (path === '/explore') return 'catalogue';
  if (path.startsWith('/explore/')) {
    try { return gameFromCardId(path.slice('/explore/'.length)) ? 'catalogue' : null; } catch { return null; }
  }
  return null;
}
/** Guests can receive ads only on the existing public marketing/catalogue pages. */
export function adsenseGuestPage(path) {
  const kind = adsensePageKind(path);
  return kind === 'marketing' || kind === 'catalogue';
}
/** A view-only Free marketplace reader does NOT gain the enquiry/selling feature. */
export function freeMarketplaceReader(access) {
  return access?.allowed === true && access.tier === 'free' && access.reason === 'free_account';
}
/** @param {any} settings @param {unknown} path */
export function adsensePagePlan(settings, path) {
  const kind = adsensePageKind(path);
  if (!kind || settings?.enabled !== true) return null;
  if (settings.provider === 'adsterra') return adsterraReady(settings.adsterra_units)
    ? { provider: 'adsterra', adsterra_units: settings.adsterra_units, auto_ads: false, slot_id: '', page_kind: kind } : null;
  if (!/^ca-pub-\d{16}$/.test(settings.publisher_id)) return null;
  const auto = settings.auto_ads_enabled === true;
  let slot = '';
  if (kind === 'catalogue' && /^\d{5,20}$/.test(settings.slot_id)) slot = settings.slot_id;
  if (kind === 'marketplace' && settings.marketplace_enabled === true && /^\d{5,20}$/.test(settings.marketplace_slot_id)) slot = settings.marketplace_slot_id;
  if (!auto && !slot) return null;
  return { auto_ads: auto, slot_id: slot, page_kind: kind };
}
/** One stable, explicitly labelled slot. Never replaces or counts as a listing. */
export function marketplaceAdRows(items) {
  const list = Array.isArray(items) ? items : [];
  const rows = list.map(item => ({ key: 'sale:' + item.id, kind: 'sale', item }));
  rows.splice(Math.min(6, list.length), 0, { key: 'cardshelf-market-ad', kind: 'ad', item: null });
  return rows;
}
/** Catalogue cards keep their own stable keys; the preview never counts as a card. */
export function catalogueAdRows(items) {
  return marketplaceAdRows(items).map(row => row.kind === 'ad'
    ? { ...row, key: 'cardshelf-catalogue-ad' }
    : { ...row, key: 'card:' + row.item.id, kind: 'card' });
}
/** Fixed-size request within the card footprint; never scale or crop an iframe. */
export function marketplaceAdSize(width, height) {
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  const w = Math.floor(width), h = Math.floor(height);
  return w >= 120 && w <= 1200 && h >= 50 && h <= 1200 && (w <= 450 || h <= 450)
    ? { width: w, height: h } : null;
}
/** A security reset always lands on an ad-free document, not a new impression. */
export function adFreePath(value) {
  try {
    if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || /[\\\r\n\0]/.test(value)) throw new Error();
    const url = new URL(value, 'https://cardshelf.invalid');
    if (url.origin !== 'https://cardshelf.invalid') throw new Error();
    url.searchParams.set('ads', 'off');
    return url.pathname + url.search + url.hash;
  } catch { return '/app?ads=off'; }
}
export function privateCardPath(cardId) {
  try { if (!gameFromCardId(cardId)) return '/cards?ads=off'; } catch { return '/cards?ads=off'; }
  return '/cards?ads=off&card=' + encodeURIComponent(cardId);
}
/** Block pending loaders synchronously, before any private dialog data is fetched. */
export function enterPrivateCard(win, cardId) {
  win.__cardshelfAdSenseBlocked = true;
  if (win.__cardshelfAdSenseLoaded === true) {
    win.location.assign(privateCardPath(cardId));
    return true;
  }
  return false;
}
