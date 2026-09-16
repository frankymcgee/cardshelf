// Provider flags are hints, not a complete or verified printing checklist.
// In particular, do not invent edition × finish combinations from independent flags.
const LABELS = { normal: 'Normal', holo: 'Holo', reverse: 'Reverse Holo',
  firstEdition: 'First Edition — finish unspecified', shadowless: 'Shadowless — finish unspecified',
  wPromo: 'W stamp — finish unspecified' };
export function providerPrintings(flags) {
  const input = flags && typeof flags === 'object' ? flags : {};
  const output = Object.entries(LABELS).filter(([key]) => input[key] === true)
    .map(([key, label]) => ({ key, label, verified: false, metadata: { basis: 'provider_flag', flag: key } }));
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
