// Verify presentation against real version-pinned engine views using original training cards.
import test from 'node:test';
import assert from 'node:assert/strict';
import { newArena, applyArenaAction, legalArenaActions, arenaView, assertArena } from '../lib/arena/engine.mjs';
import { trainingDeck } from '../lib/arena/training.mjs';
import { ARENA_VERSIONS } from '../shared/arena.mjs';
import { arenaEffectFrame, arenaEffectPlan, arenaEffectUnit } from '../shared/arena-effects.mjs';
const rng = n => n - 1;
function game(version) {
  const decks = ['ember', 'tide'].map(theme => trainingDeck(theme).map(row => ({ ...row, card: { ...row.card, compiler: version } })));
  return newArena(decks, { version, mode: 'tutorial', rng });
}
const apply = (s, seat, action) => applyArenaAction(s, seat, action, { rng });
function play(s, seat, predicate) {
  const move = legalArenaActions(s, seat).find(predicate); assert.ok(move, 'Expected a legal training move');
  return apply(s, seat, move.action);
}
const effectPlan = (a, b, observer) => {
  const before = arenaView(a, observer), after = arenaView(b, observer);
  return arenaEffectPlan(arenaEffectFrame(before, 'engine-test', 1), arenaEffectFrame(after, 'engine-test', 2), after.events);
};
for (const version of ARENA_VERSIONS) {
  test(`${version}: setup movement is private to the seated player and does not mutate the engine`, () => {
    const before = game(version), original = JSON.stringify(before);
    const after = play(before, 0, m => m.action.type === 'setup' && m.action.zone === 'active');
    const own = effectPlan(before, after, 0), opponent = effectPlan(before, after, 1);
    assert.equal(own.moves.length, 1); assert.equal(own.moves[0].id, after.players[0].active.id);
    assert.equal(opponent.moves.length, 0);
    assert.equal(arenaEffectUnit(arenaView(after, 1), after.players[0].active.id), null);
    assert.equal(JSON.stringify(before), original); assert.equal(assertArena(after), true);
  });
  test(`${version}: an actual attack produces exactly its logged amount and no hidden draw identity`, () => {
    let s = game(version);
    s = play(s, 0, m => m.action.type === 'first' && m.action.seat === 0);
    for (const seat of [0, 1]) {
      s = play(s, seat, m => m.action.type === 'setup' && m.action.zone === 'active');
      s = play(s, seat, m => m.action.type === 'setup' && m.action.zone === 'bench');
      s = play(s, seat, m => m.action.type === 'ready');
    }
    s = play(s, 0, m => m.action.type === 'end_turn');
    const beforeEnergy = s;
    s = play(s, 1, m => m.action.type === 'energy' && m.action.target === s.players[1].active.id);
    assert.equal(effectPlan(beforeEnergy, s, 1).moves.filter(m => m.kind === 'card').length, 1);
    assert.equal(effectPlan(beforeEnergy, s, 0).moves.filter(m => m.kind === 'card').length, 0);
    const before = s;
    s = play(s, 1, m => m.action.type === 'attack');
    const event = s.events.findLast(e => e.kind === 'attack'), effects = effectPlan(before, s, 0);
    assert.ok(event); assert.equal(effects.impacts.find(i => i.kind === 'attack').amount, event.damage);
    assert.ok(effects.cues.some(c => c.kind === 'attack' && c.text.includes(String(event.damage))));
    assert.ok(effects.moves.filter(m => m.kind === 'back').every(m => !Object.hasOwn(m, 'id')));
    assert.equal(assertArena(s), true);
  });
}
