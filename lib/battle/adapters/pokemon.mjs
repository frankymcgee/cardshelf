// Pokémon casual-table adapter, version 1. No card text is executed.
// Metadata comes only from the locally imported TCGdex catalogue.
import { ensure } from '../../errors.mjs';
const bounded = (value, max = 500) => typeof value === 'string' ? value.replaceAll('\0', '').slice(0, max) : '';
const strings = (value, max = 12) => Array.isArray(value) ? value.filter(v => typeof v === 'string').slice(0, max).map(v => bounded(v, 80)) : [];
export function safeArtwork(value) {
  if (typeof value !== 'string') return null;
  if (/^\/api\/public\/catalogue\/artwork\/[a-f0-9]{64}$/.test(value)) return value;
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && u.hostname === 'assets.tcgdex.net' && !u.port && !u.username && !u.password &&
      /^\/en\/[A-Za-z0-9_./-]+$/.test(u.pathname) && !u.search && !u.hash ? u.href : null;
  } catch { return null; }
}
export function cardSnapshot(row) {
  ensure(row?.game === 'pokemon' && row.language === 'en' && /^en:[A-Za-z0-9_-]+$/.test(row.id), 400, 'Use English Pokémon cards from the imported catalogue.');
  const raw = row.raw_data || {}, category = bounded(raw.category || row.category, 60);
  return { id: row.id, name: bounded(row.name, 200), number: bounded(row.local_id, 50), set_name: bounded(row.set_name, 200),
    image_url: safeArtwork(row.image_url), category, stage: bounded(raw.stage, 40), energy_type: bounded(raw.energyType, 40),
    hp: typeof raw.hp === 'number' && Number.isFinite(raw.hp) ? raw.hp : null,
    types: strings(raw.types), evolves_from: bounded(raw.evolveFrom, 200), effect: bounded(raw.effect, 1500),
    attacks: (Array.isArray(raw.attacks) ? raw.attacks : []).slice(0, 4).map(a => ({ name: bounded(a?.name, 100), cost: strings(a?.cost), damage: bounded(String(a?.damage ?? ''), 30), effect: bounded(a?.effect, 1500) })),
    abilities: (Array.isArray(raw.abilities) ? raw.abilities : []).slice(0, 3).map(a => ({ name: bounded(a?.name, 100), effect: bounded(a?.effect, 1500) })),
    retreat: Number.isInteger(raw.retreat) && raw.retreat >= 0 && raw.retreat < 20 ? raw.retreat : null,
    weakness: (Array.isArray(raw.weaknesses) ? raw.weaknesses : []).slice(0, 3).map(w => ({ type: bounded(w?.type, 40), value: bounded(w?.value, 20) })),
    resistance: (Array.isArray(raw.resistances) ? raw.resistances : []).slice(0, 3).map(w => ({ type: bounded(w?.type, 40), value: bounded(w?.value, 20) })) };
}
export const isBasic = card => card?.category === 'Pokemon' && card.stage === 'Basic';
export function validateDeck(rows) {
  const total = rows.reduce((n, r) => n + r.quantity, 0), errors = [], warnings = [];
  if (total !== 60) errors.push(`Add exactly 60 cards before entering a match (currently ${total}).`);
  if (!rows.some(r => isBasic(r.card))) errors.push('Include a Pokémon whose imported stage is Basic. Reimport missing metadata if necessary.');
  const names = new Map();
  for (const r of rows) {
    // Different foil/artwork printings share the same gameplay name limit.
    const name = r.card.name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en');
    const value = names.get(name) || { count: 0, basicEnergy: true, name: r.card.name };
    value.count += r.quantity;
    value.basicEnergy &&= r.card.category === 'Energy' && r.card.energy_type === 'Basic'; names.set(name, value);
  }
  for (const row of names.values()) if (row.count > 4 && !row.basicEnergy) warnings.push(`${row.name}: ${row.count} copies by name. The usual four-copy limit may be exceeded; verify any card-specific exception.`);
  if (rows.some(r => !r.card.category || r.card.category === 'Pokemon' && !r.card.stage)) warnings.push('Some imported gameplay metadata is incomplete. Read and resolve the printed cards manually.');
  warnings.push('Standard/Expanded rotation, bans, special deck-building limits and card-effect exceptions are not validated. Both players must agree to casual play.');
  return { total, playable: !errors.length, errors, warnings };
}
export const pokemonAdapter = Object.freeze({ code: 'pokemon', version: 1, deckSize: 60, openingHand: 7, prizeCount: 6, benchSize: 5, cardSnapshot, validateDeck, isBasic });
