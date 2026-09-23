import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTournament, tournamentRoundName } from '../shared/arena-tournaments.mjs';
import { arenaSpectatorView } from '../lib/arena/spectator.mjs';
import { newArena, applyArenaAction, arenaView } from '../lib/arena/engine.mjs';
import { trainingDeck } from '../lib/arena/training.mjs';
import { ARENA_VERSION, LEGACY_ARENA_VERSION } from '../shared/arena.mjs';
import { readyFixture, rngFor, take, trainer } from './helpers/arena-fixtures.mjs';

for (const count of [2, 3, 5, 7, 8, 9, 16, 31, 32, 33, 63, 64]) test(`${count} entrants produce a complete bracket with exactly the required byes`, () => {
  const entrants = Array.from({ length: count }, (_, i) => 'entrant-' + i), before = [...entrants];
  const draw = seedTournament(entrants, rngFor(427));
  assert.deepEqual(entrants, before); assert.equal(draw.size, 2 ** Math.ceil(Math.log2(count)));
  assert.deepEqual([...draw.seeds].sort(), [...entrants].sort());
  assert.deepEqual(draw.pairs.flat().filter(Boolean).sort(), [...entrants].sort());
  assert.equal(draw.pairs.filter(p => p.filter(Boolean).length === 1).length, draw.size - count);
  assert.ok(draw.pairs.every(p => p.some(Boolean)));
  // Resolve each real pairing once; byes contribute no played game.
  let layer = draw.pairs.map(p => p[0] || p[1]), played = draw.pairs.filter(p => p.every(Boolean)).length;
  while (layer.length > 1) { played += layer.length / 2; layer = layer.filter((_, i) => i % 2 === 0); }
  assert.equal(played, count - 1); assert.ok(entrants.includes(layer[0]));
});
test('the draw uses shrinking unbiased random ranges and does not silently accept invalid input', () => {
  const calls = [], result = seedTournament(['a', 'b', 'c', 'd'], max => { calls.push(max); return 0; });
  assert.deepEqual(calls, [4, 3, 2]); assert.notDeepEqual(result.seeds, ['a', 'b', 'c', 'd']);
  for (const ids of [[], ['a'], ['a', 'a'], Array.from({ length: 65 }, (_, i) => i)]) assert.throws(() => seedTournament(ids, rngFor(1)));
  assert.throws(() => seedTournament(['a', 'b'], max => max));
});
test('late-round names work for small and large events', () => {
  assert.equal(tournamentRoundName(1, 2), 'Final'); assert.equal(tournamentRoundName(1, 4), 'Semifinals');
  assert.equal(tournamentRoundName(4, 64), 'Quarterfinals'); assert.equal(tournamentRoundName(5, 64), 'Semifinals');
  assert.equal(tournamentRoundName(6, 64), 'Final'); assert.equal(tournamentRoundName(1, 64), 'Round of 64');
});
for (const version of [ARENA_VERSION, LEGACY_ARENA_VERSION]) test(`spectators receive neither player's setup cards or private choices under ${version}`, () => {
  const deck = theme => trainingDeck(theme).map(r => ({ ...r, card: { ...r.card, compiler: version } }));
  let state = newArena([deck(), deck('tide')], { version, rng: rngFor(32) });
  state = applyArenaAction(state, state.toss, { type: 'first', seat: 0 });
  const active = state.players[0].hand.find(u => u.card.stage === 'Basic');
  state = applyArenaAction(state, 0, { type: 'setup', card: active.id, zone: 'active' });
  assert.ok(arenaView(state, 0).players[0].active.card);
  const before = JSON.stringify(state), view = arenaSpectatorView(state), serialized = JSON.stringify(view);
  assert.equal(JSON.stringify(state), before); assert.deepEqual(view.players[0].active, { hidden: true });
  assert.deepEqual(view.legal, []); assert.equal(view.prompt, null); assert.deepEqual(view.attack_blocks, []);
  for (const p of state.players) for (const unit of [...p.hand, ...p.deck, ...p.prizes, ...(p.active ? [p.active] : [])]) assert.ok(!serialized.includes(unit.id));
  assert.ok(view.players.every(p => p.hand.length === 0 && !Object.hasOwn(p, 'deck') && !Object.hasOwn(p, 'prizes')));
});
test('the commentary projection preserves public cards/counts while discarding hidden state and extra event fields', () => {
  const state = readyFixture(); take(state, 0, c => c.card.kind === 'energy'); take(state, 1, c => c.card.kind === 'energy');
  state.events = [{ n: 1, seat: 0, kind: 'draw', text: 'Drew a card.', private_payload: 'never disclose' }];
  state.private_metadata = 'never disclose'; const view = arenaSpectatorView(state), encoded = JSON.stringify(view);
  assert.equal(view.players[0].active.card.name, state.players[0].active.card.name);
  assert.equal(view.players[1].active.card.name, state.players[1].active.card.name);
  assert.equal(view.players[0].hand_count, 1); assert.equal(view.players[1].prize_count, 6);
  for (const p of state.players) for (const unit of [...p.hand, ...p.deck, ...p.prizes]) assert.ok(!encoded.includes(unit.id));
  assert.ok(!encoded.includes('never disclose')); assert.deepEqual(view.events, [{ n: 1, seat: 0, kind: 'draw', text: 'Drew a card.' }]);
});
test('a live private search decision gives commentators no candidates, hand identities or legal moves', () => {
  let state = readyFixture(); const search = trainer(state, 0, { kind: 'search', filter: 'pokemon', count: 1 });
  state = applyArenaAction(state, 0, { type: 'trainer', card: search.id });
  assert.ok(arenaView(state, 0).prompt.options.length);
  const view = arenaSpectatorView(state); assert.equal(view.waiting_for, 0); assert.equal(view.prompt, null); assert.deepEqual(view.legal, []);
  const serialized = JSON.stringify(view);
  for (const option of arenaView(state, 0).prompt.options) assert.ok(!serialized.includes(option.id));
});
