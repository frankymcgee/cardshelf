import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {attackProgram, compileArenaCard} from '../lib/arena/cards.mjs';
import {applyArenaAction as act, arenaView, assertArena} from '../lib/arena/engine.mjs';
import {readyFixture, power, row} from './helpers/arena-fixtures.mjs';

// Complete source records: TCGdex af57972e8f784c2507ab9e573c99bf02ae2e5e42.
const rows = JSON.parse(fs.readFileSync(new URL('./helpers/arena-shared-moves-v5.json', import.meta.url)));
const compiled = id => {
  const result = compileArenaCard(rows.find(row => row.id === 'en:' + id));
  assert.equal(result.supported, true, result.reason);
  return result.card;
};
for (const raw of rows) test('shared templates compile all attacks of ' + raw.id, () => {
  const card = compiled(raw.id.slice(3));
  assert.equal(card.attacks.length, raw.raw_data.attacks.length);
});

test('one coin-bonus template preserves per-card base damage, bonus and Energy cost', () => {
  for (const [id, base, bonus] of [['col1-37', 50, 30], ['col1-59', 10, 10], ['dp1-101', 10, 20]]) {
    const card = compiled(id), index = card.attacks.findIndex(attack => attack.effects.some(effect => effect.kind === 'coin_bonus'));
    const attack = card.attacks[index];
    assert.equal(attack.damage, base);
    assert.equal(attack.effects[0].amount, bonus);
    assert.deepEqual(attack.cost, rows.find(row => row.id === 'en:' + id).raw_data.attacks[index].cost);
    assert.match(attack.text, /damage plus/);
    for (const heads of [0, 1]) {
      let state = readyFixture(); state.players[0].active.card = card;
      for (const type of attack.cost) power(state, 0, 1, type);
      state.players[1].active.card.hp = 500;
      state.players[1].active.card.weakness = []; state.players[1].active.card.resistance = [];
      state = act(state, 0, {type: 'attack', index}, {rng: () => heads});
      assert.equal(state.players[1].active.damage, base + (heads ? bonus : 0));
      assert.equal(state.events.filter(event => event.kind === 'coin').length, 1);
      assertArena(state);
    }
  }
});

test('recoil template applies printed self damage once across different moves', () => {
  for (const [id, expected] of [['bw1-16', 30], ['bw1-42', 70]]) {
    const card = compiled(id), index = card.attacks.findIndex(attack => attack.effects.some(effect => effect.kind === 'recoil'));
    let state = readyFixture(); state.players[0].active.card = card;
    for (const type of card.attacks[index].cost) power(state, 0, 1, type);
    state.players[1].active.card.hp = 500;
    state.players[1].active.card.weakness = []; state.players[1].active.card.resistance = [];
    state = act(state, 0, {type: 'attack', index});
    assert.equal(state.players[0].active.damage, 10);
    assert.equal(state.players[1].active.damage, expected);
    assertArena(state);
  }
});

test('Bench template retains Active damage, targeting and resumable Bench damage without Weakness', () => {
  let state = readyFixture(); state.players[0].active.card = compiled('bwp-BW89'); power(state, 0, 1);
  state.players[1].active.card.weakness = [];
  state.players[1].active.card.resistance = [];
  state.players[1].bench[0].card.weakness = [{type: 'Water', value: 'x2'}];
  state = act(state, 0, {type: 'attack', index: 0});
  assert.equal(state.players[1].active.damage, 20);
  assert.equal(arenaView(state, 0).prompt.options.length, 1);
  const target = state.players[1].bench[0].id;
  state = act(JSON.parse(JSON.stringify(state)), 0, {type: 'choose', choices: [target]});
  assert.equal(state.players[1].bench[0].damage, 20);
  assertArena(state);
});

test('legacy templates reject mismatched formulas, out-of-range amounts and additional unknown clauses', () => {
  const attack = {name: 'Quick Attack', cost: ['Colorless'], damage: '10+',
    effect: 'Flip a coin. If heads, this attack does 10 damage plus 20 more damage.'};
  for (const variant of [
    {damage: '20+'}, {damage: 10}, {damage: '10×'},
    {effect: attack.effect + ' Discard your hand.'},
    {effect: 'This Pokemon does 15 damage to itself.'},
    {effect: 'This Pokemon does 10000 damage to itself.'},
  ]) assert.throws(() => attackProgram({...attack, ...variant}));
  assert.equal(compileArenaCard(row({attacks: [{...attack, name: 'Different Move'}],
    abilities: [{name: 'Unknown', type: 'Ability', effect: 'Unknown extra rule.'}]})).supported, false);
});
