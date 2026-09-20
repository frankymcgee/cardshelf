import test from 'node:test';
import assert from 'node:assert/strict';
import { newArena, arenaView, applyArenaAction, assertArena } from '../lib/arena/engine.mjs';
import * as core from '../lib/arena/engine-v1.mjs';
import { compileArenaCard, deckValidation } from '../lib/arena/cards.mjs';
import { trainingDeck } from '../lib/arena/training.mjs';
import { driveCpu } from '../lib/arena/bot.mjs';
import { ARENA_VERSION, LEGACY_ARENA_VERSION } from '../shared/arena.mjs';
import { rngFor, row } from './helpers/arena-fixtures.mjs';

const legacyDeck = theme => trainingDeck(theme).map(r => ({ ...r, card: { ...r.card, compiler: LEGACY_ARENA_VERSION } }));
const persisted = state => JSON.parse(JSON.stringify(state));
// Card identities are fresh opaque UUIDs when changing zones, not gameplay outcomes.
const outcome = state => JSON.parse(JSON.stringify(state).replace(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/g, '<instance>'));

test('new matches use Expanded while explicit Core matches retain their version', () => {
  const next = newArena([trainingDeck(), trainingDeck('tide')], { rng: rngFor(41) });
  assert.equal(next.version, ARENA_VERSION);
  const old = newArena([legacyDeck(), legacyDeck('tide')], { version: LEGACY_ARENA_VERSION, rng: rngFor(41) });
  assert.equal(old.version, LEGACY_ARENA_VERSION);
  assert.equal(arenaView(persisted(old), 0).version, LEGACY_ARENA_VERSION);
  assertArena(old);
  assert.throws(() => newArena([trainingDeck(), trainingDeck()], { version: LEGACY_ARENA_VERSION }));
  assert.throws(() => newArena([legacyDeck(), legacyDeck()], { version: ARENA_VERSION }));
});

test('unknown saved rules versions are rejected rather than upgraded', () => {
  const state = newArena([trainingDeck(), trainingDeck()], { rng: rngFor(7) });
  state.version = 'pokemon-future-v99';
  assert.throws(() => arenaView(state, 0));
  assert.throws(() => applyArenaAction(state, 0, { type: 'concede' }));
  assert.throws(() => assertArena(state));
  assert.throws(() => compileArenaCard(row(), state.version));
});

test('old deck compilation keeps the old card boundary and compiler stamps', () => {
  const normal = compileArenaCard(row(), LEGACY_ARENA_VERSION);
  assert.equal(normal.supported, true);
  assert.equal(normal.card.compiler, LEGACY_ARENA_VERSION);
  const ex = { ...row({ suffix: 'EX' }), name: 'Synthetic EX' };
  assert.equal(compileArenaCard(ex, LEGACY_ARENA_VERSION).supported, false);
  assert.equal(compileArenaCard(ex, ARENA_VERSION).supported, true);
  assert.equal(deckValidation(legacyDeck(), LEGACY_ARENA_VERSION).playable, true);
  assert.equal(deckValidation(legacyDeck(), ARENA_VERSION).playable, false);
});

test('a serialized unfinished Core decision resumes identically through the dispatcher', () => {
  let state = core.newArena([legacyDeck(), legacyDeck('tide')], { rng: rngFor(5) });
  state = core.applyArenaAction(state, state.toss, { type: 'first', seat: 0 });
  for (const seat of [0, 1]) {
    const basic = state.players[seat].hand.find(c => c.card.kind === 'pokemon' && c.card.stage === 'Basic');
    state = core.applyArenaAction(state, seat, { type: 'setup', card: basic.id, zone: 'active' });
    state = core.applyArenaAction(state, seat, { type: 'ready' });
  }
  while (state.pending) {
    const q = core.arenaView(state, state.pending.seat).prompt;
    state = core.applyArenaAction(state, state.pending.seat, { type: 'choose', choices: [q.options[0].id] });
  }
  const p = state.players[0];
  let search = p.hand.find(c => c.card.program?.kind === 'search');
  if (!search) {
    const i = p.deck.findIndex(c => c.card.program?.kind === 'search');
    search = p.deck.splice(i, 1)[0]; p.hand.push(search);
  }
  state = core.applyArenaAction(state, 0, { type: 'trainer', card: search.id });
  assert.equal(state.pending.kind, 'search');
  const snapshot = persisted(state), before = JSON.stringify(snapshot);
  assert.deepEqual(arenaView(snapshot, 0), core.arenaView(snapshot, 0));
  const action = { type: 'choose', choices: [] };
  const dispatched = applyArenaAction(snapshot, 0, action, { rng: rngFor(22) });
  const original = core.applyArenaAction(snapshot, 0, action, { rng: rngFor(22) });
  assert.deepEqual(outcome(dispatched), outcome(original));
  assert.equal(JSON.stringify(snapshot), before);
  assert.equal(dispatched.version, LEGACY_ARENA_VERSION);
  assertArena(dispatched);
});

test('saved Core CPU practice can still finish with the expanded release installed', () => {
  let state = core.newArena([legacyDeck(), legacyDeck('tide')], { rng: rngFor(15) });
  const rng = rngFor(2026);
  for (let n = 0; n < 240 && state.phase !== 'finished'; n++) {
    for (const seat of [0, 1]) {
      state = driveCpu(persisted(state), { seat, rng, max: 32 }).state;
      assert.equal(state.version, LEGACY_ARENA_VERSION);
      assertArena(state);
    }
  }
  assert.equal(state.phase, 'finished');
});
