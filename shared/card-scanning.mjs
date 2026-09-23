// Provider-independent UI vocabulary; API credentials only exist in server modules.
export const SCAN_MODEL = 'gpt-4.1-mini-2025-04-14';
export const SCAN_MODEL_LABEL = 'GPT-4.1 mini';
export const SCAN_PRICE_CHECKED = '2026-09-23';
export const SCAN_ERRORS = Object.freeze({
  image: 'Use a clear, single-card JPEG, PNG or WebP photo. Try a smaller image.',
  provider_auth: 'The scanning connection needs administrator attention.',
  provider_busy: 'The recognition service is busy. Try a new scan later.',
  provider_unavailable: 'Recognition could not finish. Check this scan before trying again.',
  provider_response: 'The recognition service did not return a usable result. Retake the photo or search manually.',
  interrupted: 'This scan was interrupted. Its usage allowance is retained because the provider outcome is unknown.',
  internal: 'The scan could not finish. Search manually or ask an administrator for help.'
});
export function scanMoney(micros) {
  return new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:4}).format(Number(micros||0)/1000000);
}
