import test from 'node:test';
import assert from 'node:assert/strict';
import { arenaEffectFrame, arenaEffectPlan, arenaEffectUnit, ARENA_EFFECT_LIMITS } from '../shared/arena-effects.mjs';
const unit = id => ({ id, card: { name: 'FACE-' + id, image_url: '/private-' + id + '.png', kind: 'pokemon', hp: 100 }, damage: 0, conditions: {}, energy: [], tools: [], under: [] });
function table(seat = 0, version = 'pokemon-expanded-v2') {
  return { version, seat, round: 1, turn: seat, turn_number: 3, phase: 'playing', result: null, stadium: null,
    players: [0, 1].map(i => ({ hand: [unit('hand-' + i)], active: unit('active-' + i), bench: [unit('bench-' + i)],
      discard: [], resolving: [], hand_count: 1, deck_count: 40, prize_count: 6 })), events: [{ n: 1, kind: 'setup', seat }] };
}
const frame = (t, revision = 1, match = 'match') => arenaEffectFrame(t, match, revision);
const plan = (a, b, revision = 2) => arenaEffectPlan(frame(a), frame(b, revision), b.events);
for (const version of ['pokemon-core-v1', 'pokemon-expanded-v2']) for (const seat of [0, 1]) {
  test(`${version}, seat ${seat}: only the player's own surviving hand identity flies to the field`, () => {
    const a = table(seat, version), b = structuredClone(a), card = b.players[seat].hand.pop(); b.players[seat].bench.push(card);
    assert.deepEqual(plan(a, b).moves, [{ kind: 'card', id: card.id, from: 'unit:' + card.id, to: 'unit:' + card.id }]);
    const before = JSON.stringify(a); frame(a); plan(a, b); assert.equal(JSON.stringify(a), before);
    assert.equal(arenaEffectUnit(b, card.id), card); assert.equal(arenaEffectUnit(b, 'hand-' + (1 - seat)), null);
  });
}
test('metadata snapshots contain no card faces, artwork, names, hidden contents or event text', () => {
  const t = table(), snapshot = JSON.stringify(frame(t));
  assert.doesNotMatch(snapshot, /FACE-|private-|image_url|"card"|"events"/);
  t.players[0].active.damage = 50; assert.equal(JSON.parse(snapshot).units.find(u => u.id === 'active-0').damage, 0);
});
test('poisoned hidden hand/deck/Prize arrays and face-down descendants are never touched', () => {
  const t = table(), deny = { get() { throw Error('hidden data read'); } };
  Object.defineProperty(t.players[1], 'hand', deny);
  for (const p of t.players) for (const key of ['deck', 'prizes']) Object.defineProperty(p, key, deny);
  const hidden = { hidden: true }; for (const key of ['id', 'card', 'energy', 'tools', 'under', 'damage', 'conditions']) Object.defineProperty(hidden, key, deny);
  t.players[1].active = hidden; t.players[1].bench = [hidden]; t.players[0].active.tools = [hidden];
  assert.doesNotThrow(() => frame(t)); assert.equal(arenaEffectUnit(t, 'SECRET'), null);
  assert.equal(arenaEffectUnit(t, 'hand-0').id, 'hand-0');
});
test('attachment movement uses the receiving public Pokémon anchor, not a guessed card identity', () => {
  const a = table(), b = structuredClone(a), c = b.players[0].hand.pop(); b.players[0].active.energy.push(c);
  assert.deepEqual(plan(a, b).moves, [{ kind: 'card', id: c.id, from: 'unit:' + c.id, to: 'unit:active-0' }]);
});
test('Active and Bench swaps animate the two existing IDs without mutating either view', () => {
  const a = table(), b = structuredClone(a), p = b.players[1], old = p.active; p.active = p.bench[0]; p.bench = [old];
  assert.equal(plan(a, b).moves.length, 2);
  assert.ok(plan(a, b).moves.every(m => m.id === 'active-1' || m.id === 'bench-1'));
});
test('hand/Bench order and identical polling produce no artificial movement', () => {
  const a = table(); a.players[0].hand.push(unit('more')); a.players[0].bench.push(unit('second'));
  const b = structuredClone(a); b.players[0].hand.reverse(); b.players[0].bench.reverse();
  assert.equal(plan(a, b).moves.length, 0); assert.deepEqual(plan(a, structuredClone(a)).cues, []);
  assert.deepEqual(arenaEffectPlan(frame(a), frame(a), a.events).moves, []);
});
test('rekeyed discards are never connected using equal names or matching catalogue artwork', () => {
  const a = table(), b = structuredClone(a), c = b.players[0].hand.pop(); c.id = 'new-discard-id'; b.players[0].discard.push(c);
  assert.deepEqual(plan(a, b).moves, []); assert.equal(arenaEffectUnit(b, 'hand-0'), null);
});
test('a face removed by a newer private view cannot remain a motion preview', () => {
  const t = table(); assert.ok(arenaEffectUnit(t, 'active-1')); t.players[1].active.hidden = true;
  assert.equal(arenaEffectUnit(t, 'active-1'), null); t.players[0].hand = []; assert.equal(arenaEffectUnit(t, 'hand-0'), null);
});
for (const [name, change] of [
  ['match', f => { f.key = 'other-match'; }], ['seat', f => { f.key = 'other-seat'; }], ['rules version', f => { f.key = 'other-engine'; }],
  ['new round', f => { f.key = 'round-two'; }], ['stale revision', f => { f.revision = 0; }], ['same revision', f => { f.revision = 1; }]
]) test(`${name}: no effect replay across snapshot boundaries`, () => {
  const a = table(), b = structuredClone(a); b.events.push({ n: 2, kind: 'coin', heads: true }); const next = frame(b, 2); change(next);
  assert.deepEqual(arenaEffectPlan(frame(a), next, b.events).cues, []);
});
test('initial load, unsupported rules, invalid metadata and missing views do not animate', () => {
  assert.equal(arenaEffectFrame(table(), '', 1), null); assert.equal(arenaEffectFrame(table(), 'id', -1), null);
  const t = table(); t.version = 'future'; assert.equal(frame(t), null);
  for (const t of [null, {}, [], 'wrong']) assert.equal(frame(t), null);
  assert.deepEqual(arenaEffectPlan(null, frame(table()), []).cues, []);
});
test('attack and subsequent poison show their exact server amounts rather than a recomputed total', () => {
  const a = table(), b = structuredClone(a); b.players[1].active.damage = 40;
  b.events.push({ n: 2, kind: 'attack', seat: 0, attacker: 'active-0', target: 'active-1', attack: 'Strike', damage: 30 },
    { n: 3, kind: 'condition', seat: 1, target: 'active-1', damage: 10 });
  const p = plan(a, b); assert.deepEqual(p.impacts.map(i => i.amount), [30, 10]); assert.match(p.cues[0].text, /30 damage/);
});
test('Knock Outs never redirect an attack to a replacement Active Pokémon', () => {
  const a = table(), b = structuredClone(a); b.players[1].active = unit('replacement');
  b.events.push({ n: 2, kind: 'attack', attacker: 'active-0', target: 'active-1', attack: 'Strike', damage: 100 },
    { n: 3, kind: 'knockout', seat: 1, card: { name: 'Defeated Pokémon' } });
  const p = plan(a, b); assert.equal(p.impacts.length, 0); assert.match(p.cues[1].text, /Defeated Pokémon knocked out/);
});
test('misses and zero damage remain zero, and invalid amounts are ignored', () => {
  const a = table(), b = structuredClone(a); b.events.push({ n: 2, kind: 'attack', damage: 0, target: 'active-1' }, { n: 3, kind: 'attack_miss' }, { n: 4, kind: 'attack', damage: -1 });
  const p = plan(a, b); assert.equal(p.impacts[0].amount, 0); assert.equal(p.cues.length, 2); assert.match(p.cues[1].text, /no damage/);
});
test('coin feedback uses the disclosed boolean result only', () => {
  const a = table(), b = structuredClone(a); b.events.push({ n: 2, kind: 'coin', heads: true }, { n: 3, kind: 'coin', heads: false }, { n: 4, kind: 'coin', heads: 'heads' });
  assert.deepEqual(plan(a, b).impacts.map(i => i.text), ['HEADS', 'TAILS']);
});
test('healing and conditions use confirmed state without inventing per-effect heal values', () => {
  const a = table(); a.players[0].active.damage = 50; const b = structuredClone(a); b.players[0].active.damage = 20; b.players[0].active.conditions = { poison: true, special: 'asleep' };
  const p = plan(a, b); assert.equal(p.impacts[0].text, 'Damage removed'); assert.equal(p.impacts[0].amount, null);
  assert.equal(p.impacts[1].text, 'Poisoned · Asleep');
});
for (const seat of [0, 1]) test(`seat ${seat}: draw and Prize movement is anonymous, never a revealed face`, () => {
  const a = table(), b = structuredClone(a); b.players[seat].deck_count--; b.players[seat].hand_count++; b.events.push({ n: 2, kind: 'turn', seat });
  assert.deepEqual(plan(a, b).moves, [{ kind: 'back', from: `pile:${seat}:deck`, to: `pile:${seat}:hand` }]);
  const c = structuredClone(a); c.players[seat].prize_count--; c.players[seat].hand_count++; c.events.push({ n: 2, kind: 'prize', seat });
  assert.deepEqual(plan(a, c).moves, [{ kind: 'back', from: `pile:${seat}:prizes`, to: `pile:${seat}:hand` }]);
  c.events = a.events; assert.deepEqual(plan(a, c).moves, []);
});
test('Stadium and turn/result cues reflect the new confirmed table', () => {
  const a = table(), b = structuredClone(a); b.stadium = { seat: 1, unit: unit('park') }; b.turn = 1; b.turn_number++;
  assert.deepEqual(plan(a, b).cues.map(c => c.kind), ['stadium', 'turn']);
  const c = structuredClone(a); c.phase = 'finished'; c.result = 0;
  assert.equal(plan(a, c).cues.at(-1).text, 'Victory'); c.result = 1; assert.equal(plan(a, c).cues.at(-1).text, 'Defeat');
  c.result = 'draw'; assert.equal(plan(a, c).cues.at(-1).text, 'Draw');
});
test('large gaps and truncated event logs coalesce instead of replaying an animation backlog', () => {
  const a = table(), b = structuredClone(a); b.events = [{ n: 50, kind: 'coin', heads: true }];
  const p = plan(a, b); assert.equal(p.coalesced, true); assert.equal(p.moves.length, 0); assert.equal(p.impacts.length, 0);
  assert.equal(plan(a, a, 50).coalesced, true);
});
test('effect lists and metadata are bounded under oversized disclosed data', () => {
  const a = table(), b = structuredClone(a);
  for (let n = 2; n <= 12; n++) b.events.push({ n, kind: 'coin', heads: true });
  const p = plan(a, b); assert.ok(p.impacts.length <= ARENA_EFFECT_LIMITS.impacts); assert.ok(p.cues.length <= ARENA_EFFECT_LIMITS.cues);
  b.players[0].hand = Array.from({ length: 10000 }, (_, i) => unit('large-' + i));
  assert.ok(frame(b).units.length <= ARENA_EFFECT_LIMITS.units);
});
test('duplicate IDs and malformed event ordering fail closed rather than binding the wrong card', () => {
  const a = table(), b = structuredClone(a); b.players[0].bench.push(b.players[0].active);
  assert.equal(frame(b).ambiguous, true); assert.equal(arenaEffectUnit(b, 'active-0'), null); assert.deepEqual(plan(a, b).moves, []);
  b.players[0].bench.pop(); b.events.push({ n: 1, kind: 'coin', heads: true }); assert.deepEqual(plan(a, b).impacts, []);
});

test('a newly revealed opponent play pulses only at its public destination without reading the private hand', () => {
  const a = table(), b = structuredClone(a);
  for (const t of [a, b]) Object.defineProperty(t.players[1], 'hand', { get() { throw Error('private hand read'); } });
  b.players[1].bench.push(unit('revealed')); b.events.push({ n: 2, kind: 'bench', seat: 1 });
  const p = plan(a, b); assert.deepEqual(p.moves, []);
  assert.deepEqual(p.accents, [{ kind: 'arrival', target: 'unit:revealed' }]);
  assert.doesNotMatch(JSON.stringify(p.accents), /FACE-|private-|card|image/);
});

test('Energy attachment and evolution pulses follow the exact receiving disclosed instance', () => {
  const a = table(), b = structuredClone(a), energy = b.players[0].hand.pop(); b.players[0].active.energy.push(energy);
  assert.deepEqual(plan(a, b).accents, [{ kind: 'energy', target: 'unit:active-0' }]);
  const c = structuredClone(a), evolution = c.players[0].hand.pop(); c.players[0].active = evolution;
  c.events.push({ n: 2, kind: 'evolve', seat: 0, target: evolution.id });
  assert.deepEqual(plan(a, c).accents, [{ kind: 'evolve', target: 'unit:hand-0' }]);
  assert.equal(plan(a, c).cues[0].text, 'Pokémon evolved');
});

test('polling, removed identities and reconnect gaps never queue arrival pulses', () => {
  const a = table(), b = structuredClone(a); b.players[0].hand = [];
  assert.deepEqual(plan(a, a).accents, []); assert.deepEqual(plan(a, b).accents, []);
  b.players[1].bench.push(unit('revealed')); b.events = [{ n: 50, kind: 'bench', seat: 1 }];
  assert.deepEqual(plan(a, b).accents, []);
});

test('oversized newly disclosed attachment lists have bounded pulse counts', () => {
  const a = table(), b = structuredClone(a); b.players[1].active.energy = Array.from({ length: 60 }, (_, i) => unit('energy-' + i));
  assert.equal(plan(a, b).accents.length, ARENA_EFFECT_LIMITS.accents);
});
