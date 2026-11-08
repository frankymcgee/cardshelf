import { extractTcgdexMarkets } from './tcgdex-pricing.mjs';
// Provider flags are hints, not a complete or verified printing checklist.
// In particular, do not invent edition × finish combinations from independent flags.
const LABELS = { normal: 'Normal', holo: 'Holo', reverse: 'Reverse Holo',
  firstEdition: 'First Edition — finish unspecified', shadowless: 'Shadowless — finish unspecified',
  wPromo: 'W stamp — finish unspecified' };
export function providerPrintingEvidence(flags, raw = {}, language = 'en') {
  const input = { ...(flags && typeof flags === 'object' ? flags : {}) }, basis = {};
  const plain = row => row && (!row.size || row.size === 'standard') && !row.subtype && !row.foil
    && (!row.stamp || (Array.isArray(row.stamp) && !row.stamp.length))
    && (!row.languages || (Array.isArray(row.languages) && row.languages.includes(language)));
  const details = Array.isArray(raw.variants_detailed) ? raw.variants_detailed : [];
  for (const row of details.filter(plain)) {
    if (['normal', 'holo', 'reverse'].includes(row.type) && row.variantId !== 'generated') {
      input[row.type] = true; basis[row.type] = 'detailed_variant';
    }
  }
  // TCGplayer's English finish-specific rows are useful evidence even when the
  // catalogue flags say false. Cardmarket aggregates do not identify a finish.
  // Reuse the price parser's scoped-product and special-printing safeguards.
  if (language === 'en') {
    const markets = extractTcgdexMarkets(raw.pricing, details);
    for (const row of [...markets.quotes, ...markets.metrics]) {
      // Do not flatten a language-specific/stamped/jumbo detail into a base finish.
      const typed = details.filter(d => d?.type === row.variant);
      if (typed.length && !typed.some(plain)) continue;
      input[row.variant] = true; basis[row.variant] ||= 'tcgplayer_finish';
    }
  }
  // A generated Normal row is a placeholder, not independent finish evidence.
  // Replace it only when plain finish data supplies Holo and no Normal evidence.
  const retired=[];
  if(details.length && details.every(d=>d?.variantId==='generated' && d.type==='normal')
    && basis.holo && !basis.normal) {
    input.normal=false;retired.push('normal');
  }
  // Missing prices are not proof that an existing finish does not exist.
  return { flags: input, basis, retired };
}
export function providerPrintings(flags, raw = {}, language = 'en') {
  const { flags: input, basis } = providerPrintingEvidence(flags, raw, language);
  const output = Object.entries(LABELS).filter(([key]) => input[key] === true)
    .map(([key, label]) => ({ key, label, verified: false, metadata: { basis: basis[key] || 'provider_flag', flag: key } }));
  if (!output.length) output.push({ key: 'unspecified', label: 'Unspecified printing', verified: false,
    metadata: { basis: 'missing_provider_flags' } });
  return output;
}
export function safeImageUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'assets.tcgdex.net' || url.port || url.username || url.password || url.search || url.hash) return null;
    return url.href.replace(/\/$/, '') + '/high.webp';
  } catch { return null; }
}
