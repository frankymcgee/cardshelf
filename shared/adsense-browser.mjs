// No global script, cookie or request is created until the caller supplies a
// server-validated Free placement and that document's nonce.
export function startAdSense(win, doc, unit, placement, nonce, stillAllowed, onFailure) {
  if (placement?.eligible !== true || !/^ca-pub-\d{16}$/.test(placement.publisher_id) ||
      !/^\d{5,20}$/.test(placement.slot_id) || !/^[a-f0-9]{32}$/.test(nonce) ||
      !unit?.isConnected || unit.getBoundingClientRect().width <= 0 || !stillAllowed()) return false;
  // One manually requested display unit per full document; never timed refreshes.
  if (win.__cardshelfAdSenseLoaded || doc.getElementById('cardshelf-adsense-loader')) return false;
  unit.setAttribute('data-ad-client', placement.publisher_id);
  unit.setAttribute('data-ad-slot', placement.slot_id);
  unit.setAttribute('data-ad-format', 'auto');
  unit.setAttribute('data-full-width-responsive', 'true');
  win.__cardshelfAdSenseLoaded = true;
  const script = doc.createElement('script');
  script.id = 'cardshelf-adsense-loader'; script.async = true; script.crossOrigin = 'anonymous'; script.nonce = nonce;
  script.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + placement.publisher_id;
  let loadHandled = false;
  script.onload = () => {
    if (loadHandled) return;
    loadHandled = true;
    if (!unit.isConnected || !stillAllowed()) return;
    try {
      // Consent decisions are handled by the operator's published Google CMP,
      // not by a home-grown consent flag or forced personalised-ad parameter.
      win.adsbygoogle = win.adsbygoogle || [];
      win.adsbygoogle.push({});
    } catch { onFailure(); }
  };
  script.onerror = onFailure;
  doc.head.appendChild(script);
  return true;
}
export function adDocumentNeedsReload(loaded, to, from, initial = false) {
  if (initial || to === from) return false;
  // Enter through a full document request so the server decides CSP and audience.
  const entersCatalogue = /^\/explore(?:\/|\?|$)/.test(to) && !/^\/explore(?:\/|\?|$)/.test(from);
  return loaded === true || entersCatalogue;
}
