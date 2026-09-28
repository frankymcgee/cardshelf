// A foil finish, a named card mechanic and rarity are different dimensions.
// Decorations NEVER modify printing keys, prices, ownership or catalogue metadata.
const FINISHES = { normal: { type: 'normal', label: 'Normal' }, holo: { type: 'holo', label: 'Holo' },
  reverse: { type: 'reverse', label: 'Reverse Holo' } };
export function printingVisual(printing) {
  if (!printing || typeof printing !== 'object') return { type: 'unknown', label: 'Choose printing' };
  const explicit = Object.hasOwn(FINISHES,printing.key) ? FINISHES[printing.key] : null;
  if (explicit && printing.source !== 'manual') return { ...explicit };
  // User-created labels need an explicit finish; avoid guesses from arbitrary words.
  const manualLabels = { normal: 'normal', holo: 'holo', 'reverse holo': 'reverse', 'reverse holographic': 'reverse' };
  const label = typeof printing.label === 'string' ? printing.label.trim() : '';
  if (printing.source === 'manual' && printing.verified === true && Object.hasOwn(manualLabels,label.toLowerCase()))
    return { ...FINISHES[manualLabels[label.toLowerCase()]] };
  return { type: 'unknown', label: label || 'Finish unspecified' };
}
export function namedCardClass(name) {
  if (typeof name !== 'string') return null;
  // Preserve ex vs EX. A Latin word ending in "ex" (Calyrex, for example) is not ex.
  const match = name.trim().match(/(?:^|[^\p{Script=Latin}\p{Number}])(VMAX|VSTAR|GX|EX|ex|V|BREAK)$/u);
  if (!match) return null;
  return { label: match[1], type: match[1] === 'EX' ? 'classic-ex' : match[1].toLowerCase() };
}
export function singlePrinting(card) {
  return Array.isArray(card?.visual_printings) && card.visual_printings.length === 1 ? card.visual_printings[0] : null;
}
// The mechanic chooses a decorative texture only AFTER a foil printing is known.
// In particular, an EX name must never turn Normal or unspecified artwork into foil.
export function foilTreatment(card, printing) {
  const finish = printingVisual(printing).type;
  if (finish === 'reverse') return 'reverse';
  if (finish !== 'holo') return 'none';
  const mechanic = !card?.game || card.game === 'pokemon' ? namedCardClass(card?.name)?.type : null;
  if (mechanic === 'ex' || mechanic === 'classic-ex') return 'ex';
  if (mechanic) return 'full';
  return 'holo';
}
