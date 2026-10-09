// Client-only presentation of acknowledged views. No rules, hidden-zone reads or persistence.
import { ARENA_VERSIONS } from './arena.mjs';
const VERSIONS = new Set(ARENA_VERSIONS);
export const ARENA_EFFECT_LIMITS = Object.freeze({ units: 160, events: 120, burst: 12, moves: 8, impacts: 6, accents: 6, cues: 4, lifetime: 1400, flight: 640 });
const list = value => Array.isArray(value) ? value : [];
const idOf = unit => unit && !unit.hidden && typeof unit.id === 'string' && unit.id.length <= 160 && unit.card ? unit.id : '';
const count = value => Number.isSafeInteger(value) && value >= 0 && value <= 10000 ? value : 0;
const text = value => typeof value === 'string' ? value.slice(0, 120) : '';
const conditions = value => [value?.poison ? 'Poisoned' : '', value?.burn ? 'Burned' : '',
  (['asleep', 'paralyzed', 'confused'].includes(value?.special) ? ({ asleep: 'Asleep', paralyzed: 'Paralyzed', confused: 'Confused' })[value.special] : '')].filter(Boolean).join(' · ');

// Explicitly enumerate disclosed zones. Do not recurse through hidden units or inspect deck/Prize arrays.
function visitDisclosed(table, visit) {
  let remaining = ARENA_EFFECT_LIMITS.units;
  const add = (unit, seat, zone, anchor, field = false) => {
    if (remaining <= 0) return;
    const id = idOf(unit);
    if (!id) return;
    remaining--; visit(unit, { id, seat, zone, anchor: anchor || 'unit:' + id, field });
  };
  for (const seat of [0, 1]) {
    const p = table.players[seat];
    if (seat === table.seat) for (const unit of list(p?.hand).slice(0, 60)) add(unit, seat, 'hand');
    const field = (unit, zone) => {
      if (!idOf(unit)) return;
      add(unit, seat, zone, '', true);
      for (const kind of ['energy', 'tools']) for (const child of list(unit[kind]).slice(0, 60)) add(child, seat, kind + ':' + unit.id, 'unit:' + unit.id);
      // Evolution cards under a Pokémon do not need a second movement or a stored historical face.
    };
    field(p?.active, 'active');
    for (const unit of list(p?.bench).slice(0, 5)) field(unit, 'bench');
    for (const unit of list(p?.discard).slice(0, 60)) add(unit, seat, 'discard', 'pile:' + seat + ':discard');
    for (const unit of list(p?.resolving).slice(0, 60)) add(unit, seat, 'resolving', 'trainer');
  }
  if ([0, 1].includes(table.stadium?.seat)) add(table.stadium.unit, table.stadium.seat, 'stadium', 'stadium');
}

/** Return metadata only. No card faces, names, artwork, private lists or raw event bodies are retained. */
export function arenaEffectFrame(table, matchId, revision) {
  if (!table || !VERSIONS.has(table.version) || ![0, 1].includes(table.seat) || !Array.isArray(table.players) || table.players.length !== 2
    || typeof matchId !== 'string' || !matchId || !Number.isSafeInteger(revision) || revision < 0) return null;
  const units = [], seen = new Set(); let ambiguous = false;
  visitDisclosed(table, (unit, meta) => {
    if (seen.has(meta.id)) { ambiguous = true; return; }
    seen.add(meta.id);
    units.push({ ...meta, damage: count(unit.damage), conditions: meta.field ? conditions(unit.conditions) : '' });
  });
  const numbers = list(table.events).slice(-ARENA_EFFECT_LIMITS.events).map(e => e?.n);
  const ordered = numbers.every((n, i) => Number.isSafeInteger(n) && n >= 0 && (i === 0 || n > numbers[i - 1]));
  return { key: JSON.stringify([matchId, table.seat, table.version, table.round ?? 1]), revision, seat: table.seat,
    turn: table.turn, turnNumber: count(table.turn_number), phase: table.phase, result: table.result,
    lastEvent: ordered ? numbers.at(-1) ?? 0 : 0, ordered, ambiguous, units,
    counts: table.players.map(p => ({ hand: count(p?.hand_count), deck: count(p?.deck_count), prizes: count(p?.prize_count) })),
    stadium: idOf(table.stadium?.unit) };
}

/** Resolve artwork from the CURRENT disclosed view only; removed/rekeyed units cannot produce faces. */
export function arenaEffectUnit(table, id) {
  if (!table || ![0, 1].includes(table.seat) || !Array.isArray(table.players) || table.players.length !== 2 || !id) return null;
  let found = null, duplicate = false;
  visitDisclosed(table, (unit, meta) => { if (meta.id === id) { if (found) duplicate = true; else found = unit; } });
  return duplicate ? null : found;
}

/** Build a bounded one-update effect batch. The board updates immediately; this never changes game state. */
export function arenaEffectPlan(before, after, sourceEvents) {
  const empty = () => ({ moves: [], impacts: [], accents: [], cues: [], coalesced: false });
  if (!before || !after || before.key !== after.key || after.revision <= before.revision || before.ambiguous || after.ambiguous
    || !before.ordered || !after.ordered || after.lastEvent < before.lastEvent) return empty();
  const events = list(sourceEvents).slice(-ARENA_EFFECT_LIMITS.events).filter(e => Number.isSafeInteger(e?.n) && e.n > before.lastEvent && e.n <= after.lastEvent);
  // A long reconnect or truncated history is not an animation backlog. Never reconstruct missing actions.
  if (after.revision - before.revision > ARENA_EFFECT_LIMITS.burst || events.length > ARENA_EFFECT_LIMITS.burst
    || after.lastEvent > before.lastEvent && (!events.length || events[0].n !== before.lastEvent + 1)) {
    return { ...empty(), coalesced: true, cues: [{ kind: 'update', text: 'Table updated · see History for the intervening actions.' }] };
  }
  const result = empty(), old = new Map(before.units.map(u => [u.id, u])), current = new Map(after.units.map(u => [u.id, u]));
  const evolutions = new Set(events.filter(e => e.kind === 'evolve' && current.get(e.target)?.field).map(e => e.target));
  const cue = (kind, message, seat = null) => result.cues.push({ kind, text: message, seat });
  for (const next of after.units) {
    const prior = old.get(next.id);
    // Newly disclosed opponent plays receive an arrival pulse without inventing a private hand origin.
    if (next.field && (!prior || prior.zone === 'hand')) result.accents.push({ kind: evolutions.has(next.id) ? 'evolve' : 'arrival', target: next.anchor });
    if (next.zone !== prior?.zone && (next.zone.startsWith('energy:') || next.zone.startsWith('tools:'))) {
      result.accents.push({ kind: next.zone.startsWith('energy:') ? 'energy' : 'attach', target: next.anchor });
    }
    if (prior && prior.seat === next.seat && prior.zone !== next.zone && (prior.anchor !== next.anchor || next.field)) {
      // Surviving IDs only. An unchanged bench/hand order is not movement; a fresh discard ID is not matched by name.
      result.moves.push({ kind: 'card', id: next.id, from: prior.anchor, to: next.anchor });
    }
    if (prior?.field && next.field) {
      if (next.damage < prior.damage) {
        result.impacts.push({ kind: 'heal', target: next.anchor, text: 'Damage removed', amount: null });
        cue('heal', 'Damage removed from a Pokémon.'); // A net difference is not a fabricated per-effect heal amount.
      }
      if (prior.conditions !== next.conditions) {
        result.impacts.push({ kind: 'status', target: next.anchor, text: next.conditions || 'Conditions cleared', amount: null });
        cue('status', next.conditions || 'Special Conditions cleared.');
      }
    }
  }
  const drew = new Set(), prizes = new Set();
  for (const e of events) {
    if (e.kind === 'attack' && Number.isSafeInteger(e.damage) && e.damage >= 0 && e.damage <= 100000) {
      cue('attack', `${text(e.attack) || 'Attack'} · ${e.damage} damage`, e.seat);
      const target = current.get(e.target), attacker = current.get(e.attacker);
      // A departed/knocked-out target is never replaced with the new Active Pokémon's identity.
      if (target?.field) result.impacts.push({ kind: 'attack', target: target.anchor, source: attacker?.field ? attacker.anchor : '', amount: e.damage, text: e.damage + ' damage' });
    } else if (['condition', 'recoil', 'confusion', 'effect_damage'].includes(e.kind) && Number.isSafeInteger(e.damage) && e.damage >= 0 && e.damage <= 100000) {
      cue('damage', `${({ condition: 'Condition', recoil: 'Recoil', confusion: 'Confusion', effect_damage: 'Effect' })[e.kind]} · ${e.damage} damage`, e.seat);
      const target = current.get(e.target);
      if (target?.field) result.impacts.push({ kind: 'damage', target: target.anchor, amount: e.damage, text: e.damage + ' damage' });
    } else if (e.kind === 'coin' && typeof e.heads === 'boolean') {
      cue('coin', e.heads ? 'Coin · Heads' : 'Coin · Tails', e.seat);
      result.impacts.push({ kind: 'coin', target: 'centre', text: e.heads ? 'HEADS' : 'TAILS', amount: null });
    } else if (e.kind === 'bench') cue('play', 'Pokémon played to the Bench', e.seat);
    else if (e.kind === 'energy') cue('attach', 'Energy attached', e.seat);
    else if (e.kind === 'evolve') cue('evolve', 'Pokémon evolved', e.seat);
    else if (e.kind === 'knockout') cue('knockout', `${text(e.card?.name) || 'Pokémon'} knocked out`, e.seat);
    else if (e.kind === 'attack_miss') cue('miss', 'Attack did no damage.', e.seat);
    else if (e.kind === 'ability') {
      cue('ability', 'Ability used', e.seat);
      const target = current.get(e.target);
      if (target?.field) result.impacts.push({ kind: 'ability', target: target.anchor, text: 'ABILITY', amount: null });
    }
    if (['draw', 'turn'].includes(e.kind) && [0, 1].includes(e.seat)) drew.add(e.seat);
    if (e.kind === 'prize' && [0, 1].includes(e.seat)) prizes.add(e.seat);
  }
  for (const seat of drew) if (after.counts[seat].hand > before.counts[seat].hand && after.counts[seat].deck < before.counts[seat].deck) {
    result.moves.push({ kind: 'back', from: `pile:${seat}:deck`, to: `pile:${seat}:hand` });
    cue('draw', 'Cards drawn · faces stay private', seat);
  }
  for (const seat of prizes) if (after.counts[seat].prizes < before.counts[seat].prizes && after.counts[seat].hand > before.counts[seat].hand) {
    result.moves.push({ kind: 'back', from: `pile:${seat}:prizes`, to: `pile:${seat}:hand` });
    cue('prize', 'Prize cards taken · faces stay private', seat);
  }
  if (before.stadium !== after.stadium) {
    cue('stadium', after.stadium ? 'New Stadium in play' : 'Stadium removed');
    result.impacts.push({ kind: 'stadium', target: 'stadium', text: after.stadium ? 'STADIUM' : 'STADIUM REMOVED', amount: null });
  }
  if (after.phase === 'playing' && [0, 1].includes(after.turn) && (before.turn !== after.turn || before.turnNumber !== after.turnNumber)) {
    cue('turn', (after.turn === after.seat ? 'Your turn' : 'Opponent turn') + ' · Turn ' + after.turnNumber, after.turn);
  }
  if (after.phase === 'finished' && before.phase !== 'finished' && [0, 1, 'draw'].includes(after.result)) cue('result', after.result === 'draw' ? 'Draw' : after.result === after.seat ? 'Victory' : 'Defeat');
  result.moves = result.moves.slice(0, ARENA_EFFECT_LIMITS.moves);
  result.impacts = result.impacts.slice(-ARENA_EFFECT_LIMITS.impacts);
  result.accents = result.accents.slice(0, ARENA_EFFECT_LIMITS.accents);
  // A compact latest-update recap, not a queue that can delay prompts or hide current state.
  if (result.cues.length > ARENA_EFFECT_LIMITS.cues) result.cues = [{ kind: 'update', text: 'Several actions resolved · full details in History.' }, ...result.cues.slice(-(ARENA_EFFECT_LIMITS.cues - 1))];
  return result;
}
