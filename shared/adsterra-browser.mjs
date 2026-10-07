import { adsterraFrameDocument } from './adsterra.mjs';

// Document lifetime, not component lifetime: filters/view changes cannot refresh ads.
export function startAdsterra(win, doc, frame, unit, nonce, stillAllowed) {
  if (!frame?.isConnected || doc.visibilityState !== 'visible' ||
      win.__cardshelfAdSenseBlocked || !stillAllowed()) return false;
  const html = adsterraFrameDocument(unit, nonce);
  if (!html || (unit.width && frame.getBoundingClientRect().width < unit.width)) return false;
  win.__cardshelfAdsterraUnits ||= new Set();
  if (win.__cardshelfAdsterraUnits.has(unit.key)) return false;
  win.__cardshelfAdsterraUnits.add(unit.key);
  // The historic flag now marks ANY advertising document. Existing navigation,
  // private-card and membership controls must also retire Adsterra documents.
  win.__cardshelfAdSenseLoaded = true;
  frame.setAttribute('sandbox', 'allow-scripts allow-popups allow-popups-to-escape-sandbox');
  frame.srcdoc = html;
  return true;
}
