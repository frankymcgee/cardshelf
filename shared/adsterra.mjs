// Public placement keys supplied for CardShelf website 6105596, not credentials.
// Keep the vendor URLs separate from administrator input: no arbitrary HTML runs.
export const ADSTERRA_FORMATS = Object.freeze({
  banner_728x90: { label: 'Desktop leaderboard', width: 728, height: 90 },
  banner_468x60: { label: 'Compact leaderboard', width: 468, height: 60 },
  banner_320x50: { label: 'Mobile banner', width: 320, height: 50 },
  banner_300x250: { label: 'Rectangle', width: 300, height: 250 },
  banner_160x600: { label: 'Tall side rail', width: 160, height: 600 },
  banner_160x300: { label: 'Compact side rail', width: 160, height: 300 },
  native: { label: 'Native card grid', width: 0, height: 250 }
});
export const ADSTERRA_CARDSHELF_UNITS = Object.freeze({
  banner_728x90: '17733ddbf4928c8d072d3bd37b4a55c9',
  banner_468x60: '72e34d62383c0ae3a65639a5778b3ec3',
  banner_320x50: '7fb192d01279fc4b127486e5f575c2a5',
  banner_300x250: '678ddb8088f978d721c86525733320d1',
  banner_160x600: 'faeddf077d8bdd3a0ba2fa19cfd3229e',
  banner_160x300: 'c2785ac2dc63dfcded992a2056a25470',
  native: 'd9fdbc82c3f1b28625cdf17b8837521e'
});
export function adsterraUnit(format, key) {
  if (!Object.hasOwn(ADSTERRA_FORMATS, format) || !/^[a-f0-9]{32}$/.test(key || '')) return null;
  return { format, key, ...ADSTERRA_FORMATS[format], src: `https://bicea.org/${format === 'native' ? '21' : '22'}/${key}` };
}
export function adsterraReady(units) {
  return !!units && typeof units === 'object' && Object.entries(units).some(([format, key]) => adsterraUnit(format, key));
}
/** Choose before requesting; never stretch, crop or request hidden variants. */
export function selectAdsterraUnit(units, layout, width, availableHeight = 600) {
  if (!Number.isFinite(width) || width < 120) return null;
  const formats = layout === 'rail' ? ['banner_160x600', 'banner_160x300']
    : layout === 'grid' ? ['native', 'banner_300x250', 'banner_160x300']
      : layout === 'rectangle' ? ['banner_300x250', 'native', 'banner_160x300']
        : ['banner_728x90', 'banner_468x60', 'banner_320x50', 'banner_300x250', 'native'];
  for (const format of formats) {
    const unit = adsterraUnit(format, units?.[format]);
    if (unit && unit.width <= width && (layout !== 'rail' || unit.height <= availableHeight)) return unit;
  }
  return null;
}

// A sandboxed srcdoc has an opaque origin: document.cookie throws instead of
// returning the empty string that a cookie-disabled browser normally exposes.
// Let vendor cookie readers use that empty interface without granting access to
// the app's origin, cookies or storage. Writes are discarded, never forwarded.
// This function is serialized into the frame and must remain self-contained.
export function adsterraCookieAccess(doc) {
  try { void doc.cookie; return false; }
  catch (error) {
    if (error?.name !== 'SecurityError') throw error;
    Object.defineProperty(doc, 'cookie', { configurable: false, enumerable: true,
      get() { return ''; }, set(_value) {} });
    return true;
  }
}

export function adsterraFrameDocument(unit, nonce) {
  const checked = adsterraUnit(unit?.format, unit?.key);
  if (!checked || !/^[a-f0-9]{32}$/.test(nonce || '')) return '';
  const { key, format, width, height, src } = checked;
  const bootstrap = `<script nonce="${nonce}">window.addEventListener('error',function(event){if(event.target?.tagName==='SCRIPT'||event.message)parent.postMessage({type:'cardshelf-adsterra-error',key:'${key}'},'*')},true);(${adsterraCookieAccess.toString()})(document);</script>`;
  const content = format === 'native'
    ? `<div id="container-${key}"></div><script nonce="${nonce}" async="async" data-cfasync="false" src="${src}"></script>`
    : `<script nonce="${nonce}">window.atOptions=${JSON.stringify({ key, format: 'iframe', height, width, params: {} })};</script><script nonce="${nonce}" src="${src}"></script>`;
  // Opaque sandbox frames cannot read the collector app's DOM, cookies or storage.
  // Native creatives report their height; the parent verifies the source window.
  const resize = format === 'native' ? `<script nonce="${nonce}">
    new ResizeObserver(function(){parent.postMessage({type:'cardshelf-adsterra-size',key:'${key}',height:Math.ceil(document.body.getBoundingClientRect().height)},'*')}).observe(document.body);
  </script>` : '';
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;padding:0;width:100%;background:transparent}body{display:flow-root}iframe{border:0}img{max-width:100%}</style></head><body>${bootstrap}${content}${resize}</body></html>`;
}
