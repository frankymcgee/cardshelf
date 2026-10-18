/** Development-only move index. Groups are review candidates, never permission
 * to accept a card. Runtime compilation still checks every clause of every card. */
import {createHash} from 'node:crypto';
import {attackProgram, compileArenaCard} from './cards.mjs';
import {printingFreeCost} from './printing-metadata-v5.mjs';
import {ARENA_VERSION} from '../../shared/arena.mjs';

const normalize = value => typeof value === 'string'
  ? value.replace(/[’‘]/g, "'").replace(/Pokémon/gi, 'Pokemon').replace(/\s+/g, ' ').trim()
  : value;
const stable = value => Array.isArray(value) ? value.map(stable)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
const key = value => createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
const metadataFailure = reason => /^(Attack Energy cost is missing or unsupported\.|Attack name is missing\.|Malformed attack data\.|Gameplay text is malformed\.)$/.test(reason);

/** Keep the full clause, formula and power rules. Cost and base damage are
 * parameters of a reusable implementation, rather than separate effect code.
 * Do not erase numbers, targets, optionality, timing, or printed card names. */
export function moveFamily(attack) {
  const name = normalize(attack?.name), effect = normalize(attack?.effect ?? '');
  const printed = String(attack?.damage ?? '').replace('×', 'x');
  const power = /(?:-| )GX$/i.test(String(name)) ? 'gx-name' : null;
  // Nonstandard fields may carry semantics. Preserve them in candidate identity.
  const extra = Object.fromEntries(Object.entries(attack || {}).filter(([field]) =>
    !['name', 'effect', 'damage', 'cost'].includes(field)));
  const description = {effect, formula: printed.match(/[+x-]$/)?.[0] || '', power, extra};
  return {id: key(description), ...description};
}

export function auditArenaMoves(rows, {version = ARENA_VERSION} = {}) {
  if (!Array.isArray(rows) || !rows.length) throw Error('Provide a non-empty array of catalogue rows.');
  const seen = new Set(), groups = new Map(), names = new Map();
  let pokemon = 0, attacks = 0, unsupportedAttacks = 0, supportedCards = 0;
  for (const row of rows) {
    if (!row || typeof row.id !== 'string' || seen.has(row.id) || row.game !== 'pokemon'
      || row.language !== 'en' || !row.raw_data || typeof row.raw_data !== 'object'
      || Array.isArray(row.raw_data)) throw Error('Expected unique English Pokemon catalogue rows with raw_data.');
    seen.add(row.id);
    const raw = row.raw_data;
    if (raw.category !== 'Pokemon') continue;
    pokemon++;
    const whole = compileArenaCard(row, version);
    if (whole.supported) supportedCards++;
    if (!Array.isArray(raw.attacks)) continue;
    const entries = raw.attacks.map((attack, index) => {
      if (!attack || typeof attack !== 'object' || Array.isArray(attack)) {
        return {index, attack: {}, supported: false, reason: 'Malformed attack data.'};
      }
      try {
        const resolved = {...attack, cost: attack.cost ?? (version === ARENA_VERSION ? printingFreeCost(row, index) : undefined)};
        attackProgram(resolved, version); return {index, attack, supported: true};
      }
      catch (error) { return {index, attack, supported: false, reason: String(error.message)}; }
    });
    const missing = new Set(entries.filter(entry => !entry.supported).map(entry => moveFamily(entry.attack).id));
    for (const entry of entries) {
      attacks++;
      if (!entry.supported) unsupportedAttacks++;
      const family = moveFamily(entry.attack);
      let group = groups.get(family.id);
      if (!group) {
        group = {...family, occurrences: 0, supported_attacks: 0, unsupported_attacks: 0,
          cards: new Set(), pokemon: new Set(), moves: new Set(), variants: new Set(),
          blocked: new Set(), effectBlocked: new Set(), soleAttackGap: new Set(), effectGaps: 0, metadataGaps: 0,
          failures: new Map(), cardFailures: new Map(), examples: []};
        groups.set(family.id, group);
      }
      const moveName = typeof entry.attack.name === 'string' && normalize(entry.attack.name) || '(missing name)';
      group.occurrences++;
      group.cards.add(row.id);
      group.pokemon.add(normalize(raw.name || row.name));
      group.moves.add(moveName);
      // Exact printing variants retain name, cost, base damage and every extra
      // provider field; same-named attacks with different text never alias.
      group.variants.add(key({...entry.attack, name: moveName, effect: family.effect}));
      if (!names.has(moveName)) names.set(moveName, new Set());
      names.get(moveName).add(family.id);
      if (entry.supported) group.supported_attacks++;
      else {
        group.unsupported_attacks++;
        if (metadataFailure(entry.reason)) group.metadataGaps++;
        else group.effectGaps++;
        group.failures.set(entry.reason, (group.failures.get(entry.reason) || 0) + 1);
        if (!whole.supported) {
          group.blocked.add(normalize(raw.name || row.name));
          if (!metadataFailure(entry.reason)) group.effectBlocked.add(normalize(raw.name || row.name));
          if (missing.size === 1) group.soleAttackGap.add(row.id);
          group.cardFailures.set(whole.reason, (group.cardFailures.get(whole.reason) || 0) + 1);
        }
      }
      if (group.examples.length < 5) group.examples.push({id: row.id, pokemon: row.name,
        move: moveName, attack_index: entry.index, supported: entry.supported,
        cost: entry.attack.cost ?? null, damage: entry.attack.damage ?? null});
    }
  }
  const reasons = values => [...values].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([reason, count]) => ({reason, count}));
  // Numeric templates are review hints only: e.g. recoil 10 and recoil 20 can
  // use one parameterized handler. Full-text families and original values remain
  // distinct; this grouping never establishes gameplay equivalence.
  const templates = new Map();
  for (const group of groups.values()) {
    if (!group.effectGaps) continue;
    const effect = typeof group.effect === 'string' ? group.effect.replace(/\b\d+\b/g, '{n}') : group.effect;
    const id = key({effect, formula: group.formula, power: group.power, extra: group.extra});
    if (!templates.has(id)) templates.set(id, {id, parameterized_effect: effect,
      family_ids: [], printings: new Set(), pokemon: new Set(), unsupported_attacks: 0});
    const template = templates.get(id);
    template.family_ids.push(group.id);
    for (const id of group.cards) template.printings.add(id);
    for (const name of group.effectBlocked) template.pokemon.add(name);
    template.unsupported_attacks += group.effectGaps;
  }
  const mechanicPriorities = [...templates.values()].map(template => ({id: template.id,
    parameterized_effect: template.parameterized_effect, family_ids: template.family_ids.sort(),
    distinct_pokemon: template.pokemon.size, printings: template.printings.size,
    unsupported_effect_attacks: template.unsupported_attacks,
  })).sort((a, b) => b.distinct_pokemon - a.distinct_pokemon
    || b.unsupported_effect_attacks - a.unsupported_effect_attacks || a.id.localeCompare(b.id));
  const families = [...groups.values()].map(group => ({
    id: group.id, effect: group.effect, formula: group.formula, power: group.power,
    occurrences: group.occurrences, printings: group.cards.size, distinct_pokemon: group.pokemon.size,
    move_names: [...group.moves].sort(), exact_variants: group.variants.size,
    supported_attacks: group.supported_attacks, unsupported_attacks: group.unsupported_attacks,
    unsupported_effect_attacks: group.effectGaps, metadata_blocked_attacks: group.metadataGaps,
    blocked_pokemon: group.blocked.size, effect_blocked_pokemon: group.effectBlocked.size,
    cards_with_only_this_attack_gap: group.soleAttackGap.size,
    rejection_reasons: reasons(group.failures), card_rejection_reasons: reasons(group.cardFailures), examples: group.examples,
  })).sort((a, b) => b.effect_blocked_pokemon - a.effect_blocked_pokemon
    || b.unsupported_attacks - a.unsupported_attacks || a.id.localeCompare(b.id));
  return {engine: version,
    notice: 'Development priorities, not card acceptance. Families retain complete text; cost and base damage remain per-card parameters. A sole attack gap can still have Ability, rule or metadata blockers. Coverage counts include reprints and do not imply format legality.',
    records: rows.length, pokemon_records: pokemon, supported_pokemon_records: supportedCards,
    attack_occurrences: attacks, unsupported_attack_occurrences: unsupportedAttacks,
    effect_families: families.length, missing_effect_families: families.filter(group => group.unsupported_effect_attacks).length,
    same_name_different_effects: [...names].filter(([, ids]) => ids.size > 1)
      .map(([name, ids]) => ({name, families: ids.size})).sort((a, b) => b.families - a.families || a.name.localeCompare(b.name)),
    priorities: families.filter(group => group.unsupported_effect_attacks),
    metadata_priorities: families.filter(group => group.metadata_blocked_attacks),
    mechanic_priorities: mechanicPriorities, families};
}
