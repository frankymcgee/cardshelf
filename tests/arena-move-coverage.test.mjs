import test from 'node:test';
import assert from 'node:assert/strict';
import {auditArenaMoves, moveFamily} from '../lib/arena/move-coverage.mjs';
import {compileArenaCard} from '../lib/arena/cards.mjs';
import {row} from './helpers/arena-fixtures.mjs';

const move = (overrides = {}) => ({name: 'Shared Strike', cost: ['Fire'], damage: 30,
  effect: "Discard a random card from your opponent's hand.", ...overrides});
const card = (id, name, attacks, overrides = {}) => ({...row({name, attacks, ...overrides}), id, name});

test('equivalent effects share a family across move names, costs, base damage and printings', () => {
  const a = move(), b = move({name: 'Different Name', cost: ['Water', 'Colorless'], damage: 80});
  assert.equal(moveFamily(a).id, moveFamily(b).id);
  const rows = [card('en:a', 'First Pokemon', [a]), card('en:b', 'Second Pokemon', [b]),
    card('en:c', 'First Pokemon', [a])];
  const report = auditArenaMoves(rows);
  assert.equal(report.priorities.length, 1);
  const family = report.priorities[0];
  assert.equal(family.printings, 3);
  assert.equal(family.distinct_pokemon, 2);
  assert.equal(family.exact_variants, 2);
  assert.equal(family.blocked_pokemon, 2);
  assert.equal(family.cards_with_only_this_attack_gap, 3);
});

test('same-named moves retain different clauses, targets, amounts, timing and formulas', () => {
  const attack = move();
  for (const variant of [
    {effect: 'This Pokemon does 20 damage to itself.'},
    {effect: 'This Pokemon also does 10 damage to itself.'},
    {effect: 'Put 1 damage counter on your opponent\'s Active Pokemon.'},
    {effect: 'During your next turn, this Pokemon can\'t attack.'},
    {damage: '30+'}, {damage: '30×'}, {effect: attack.effect + ' Discard your hand.'},
  ]) assert.notEqual(moveFamily(attack).id, moveFamily({...attack, ...variant}).id);
  const report = auditArenaMoves([card('en:a', 'First Pokemon', [attack]),
    card('en:b', 'Second Pokemon', [move({effect: 'This Pokemon does 20 damage to itself.'})])]);
  assert.deepEqual(report.same_name_different_effects, [{name: 'Shared Strike', families: 2}]);
});

test('normalization preserves cosmetic apostrophe, accent, whitespace and multiplication spelling', () => {
  assert.equal(moveFamily(move({effect: 'This Pokémon does 10 damage to itself.  ', damage: '30×'})).id,
    moveFamily(move({effect: 'This Pokemon does 10 damage to itself.', damage: '30x'})).id);
  assert.equal(moveFamily(move({effect: "Your opponent’s Active Pokémon is now Poisoned."})).id,
    moveFamily(move({effect: "Your opponent's Active Pokemon is now Poisoned."})).id);
});

test('GX name and unrecognised provider gameplay fields remain separate', () => {
  assert.notEqual(moveFamily(move()).id, moveFamily(move({name: 'Shared Strike-GX'})).id);
  assert.notEqual(moveFamily(move()).id, moveFamily(move({oncePerGame: true})).id);
  assert.equal(moveFamily(move({custom: {b: 1, a: 2}})).id,
    moveFamily(move({custom: {a: 2, b: 1}})).id);
});

test('parameterized review hints link numeric variants while retaining exact effects and target differences', () => {
  const result = auditArenaMoves([
    card('en:a', 'Pokemon A', [move({effect: "Discard 2 cards from your opponent's hand."})]),
    card('en:b', 'Pokemon B', [move({effect: "Discard 3 cards from your opponent's hand."})]),
    card('en:c', 'Pokemon C', [move({effect: 'This Pokemon does 20 damage to itself. Unknown clause.'})]),
  ]);
  assert.equal(result.priorities.length, 3);
  const hint = result.mechanic_priorities[0];
  assert.equal(hint.distinct_pokemon, 2);
  assert.equal(hint.parameterized_effect, "Discard {n} cards from your opponent's hand.");
  assert.equal(hint.family_ids.length, 2);
  assert.equal(result.priorities.filter(family => hint.family_ids.includes(family.id)).length, 2);
});

test('priorities favor effects shared across different Pokemon over many artworks of one Pokemon', () => {
  const rows = Array.from({length: 7}, (_, i) => card('en:art' + i, 'One Pokemon',
    [move({effect: 'Unknown rare clause.'})]));
  rows.push(card('en:wide-a', 'Pokemon A', [move()]), card('en:wide-b', 'Pokemon B', [move()]));
  const report = auditArenaMoves(rows);
  assert.equal(report.priorities[0].distinct_pokemon, 2);
  assert.equal(report.priorities[0].printings, 2);
});

test('a missing move never bypasses a missing Ability or accepts a whole card', () => {
  const raw = card('en:ability', 'Ability Pokemon', [move()], {
    abilities: [{type: 'Ability', name: 'Unknown Ability', effect: 'Unknown ability clause.'}],
  });
  const before = structuredClone(raw), result = auditArenaMoves([raw]);
  assert.equal(result.supported_pokemon_records, 0);
  assert.equal(result.priorities[0].cards_with_only_this_attack_gap, 1);
  assert.match(result.priorities[0].card_rejection_reasons[0].reason, /Ability/);
  assert.equal(compileArenaCard(raw).supported, false);
  assert.deepEqual(raw, before);
});

test('multiple missing move families are not counted as a sole attack gap', () => {
  const result = auditArenaMoves([card('en:a', 'First Pokemon', [move(), move({effect: 'Unknown other clause.'})])]);
  assert.equal(result.priorities.length, 2);
  assert.ok(result.priorities.every(family => family.cards_with_only_this_attack_gap === 0));
});

test('missing costs are recorded separately from missing effects without inventing free attacks', () => {
  const result = auditArenaMoves([card('en:unknown', 'Unknown Cost', [move({cost: undefined, effect: ''})])]);
  assert.equal(result.unsupported_attack_occurrences, 1);
  assert.equal(result.priorities.length, 0);
  assert.equal(result.metadata_priorities[0].metadata_blocked_attacks, 1);
  assert.equal(result.metadata_priorities[0].examples[0].cost, null);
});

test('one supported attack does not hide an unsupported second move', () => {
  const result = auditArenaMoves([card('en:a', 'First Pokemon', [move({effect: ''}), move()])]);
  assert.equal(result.attack_occurrences, 2);
  assert.equal(result.unsupported_attack_occurrences, 1);
  assert.equal(result.supported_pokemon_records, 0);
});

test('invalid and duplicate catalogue rows fail rather than lowering the denominator', () => {
  const raw = card('en:a', 'First Pokemon', [move()]);
  for (const rows of [[], [raw, raw], [{...raw, language: 'fr'}], [{...raw, raw_data: []}], [null]]) {
    assert.throws(() => auditArenaMoves(rows));
  }
});

test('malformed attacks are reported without stopping the rest of the audit', () => {
  const result = auditArenaMoves([card('en:a', 'First Pokemon', [null, move()])]);
  assert.equal(result.attack_occurrences, 2);
  assert.equal(result.unsupported_attack_occurrences, 2);
  assert.equal(result.metadata_priorities.length, 1);
});
