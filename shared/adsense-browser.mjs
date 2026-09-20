// No code is loaded at module import. One official Google loader per eligible
// document, shared by Auto ads and its optional manually placed display unit.
import { adsensePageKind, marketplaceAdSize } from './adsense-policy.mjs';
export function startAdSense(win, doc, unit, placement, nonce, stillAllowed, onFailure) {
  if (placement?.eligible !== true || !/^ca-pub-\d{16}$/.test(placement.publisher_id) ||
      !/^[a-f0-9]{32}$/.test(nonce) || win.__cardshelfAdSenseBlocked || !stillAllowed()) return false;
  const automatic = placement.auto_ads === true;
  const display = /^\d{5,20}$/.test(placement.slot_id);
  if (!automatic && !display) return false;
  if (win.__cardshelfAdSenseLoaded || doc.getElementById('cardshelf-adsense-loader')) return false;
  let manual = display;
  if (manual) {
    if (!unit?.isConnected || unit.getBoundingClientRect().width <= 0) return false;
    if (placement.page_kind === 'marketplace') {
      const rect = unit.getBoundingClientRect(), size = marketplaceAdSize(rect.width, rect.height);
      if (!size) { if (!automatic) return false; manual = false; }
      else {
        // Google permits an explicit responsive unit size. Do not stretch the
        // returned iframe or use full-width expansion inside the card grid.
        unit.style.width = '100%'; unit.style.height = size.height + 'px';
        const space = unit.closest?.('.market-ad-space');
        if (space) space.style.minHeight = (size.height + 28) + 'px';
      }
    }
    if (manual) {
      unit.setAttribute('data-ad-client', placement.publisher_id);
      unit.setAttribute('data-ad-slot', placement.slot_id);
      if (placement.page_kind !== 'marketplace') {
        unit.setAttribute('data-ad-format', 'auto');
        unit.setAttribute('data-full-width-responsive', 'true');
      }
    }
  }
  win.__cardshelfAdSenseLoaded = true;
  const script = doc.createElement('script');
  script.id = 'cardshelf-adsense-loader'; script.async = true; script.crossOrigin = 'anonymous'; script.nonce = nonce;
  script.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + placement.publisher_id;
  let loadHandled = false;
  script.onload = () => {
    if (loadHandled) return;
    loadHandled = true;
    if (!manual || !unit.isConnected || win.__cardshelfAdSenseBlocked || !stillAllowed()) return;
    try {
      win.adsbygoogle = win.adsbygoogle || [];
      win.adsbygoogle.push({});
    } catch { onFailure(); }
  };
  script.onerror = onFailure;
  // Auto ads run through Google's site settings, not a fabricated adsbygoogle
  // command. CMP consent is never overridden by a CardShelf client flag.
  doc.head.appendChild(script);
  return true;
}
export function adDocumentNeedsReload(loaded, to, from, initial = false) {
  if (initial || to === from) return false;
  const toDocument = String(to).split('#')[0], fromDocument = String(from).split('#')[0];
  if (toDocument === fromDocument) return false; // In-page anchor, no new data.
  // Enter ad-capable routes through a server-selected document/CSP, including
  // transitions between two eligible pages or out of an explicit ad-free view.
  return loaded === true || !!adsensePageKind(toDocument);
}
// Do not degrade paid/ad-free navigation into a full reload on every page.
// This read is advisory only: the destination's server middleware still decides
// its nonce and the component independently rechecks eligibility before loading.
export async function adDocumentNeedsReloadForUser(loaded, to, from, initial, lookup) {
  if (!adDocumentNeedsReload(loaded, to, from, initial)) return false;
  if (loaded === true) return true;
  try { return (await lookup(String(to).split('#')[0]))?.eligible === true; }
  catch { return false; } // Ad lookup failure never makes navigation unavailable.
}
