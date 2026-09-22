import test from 'node:test';
import assert from 'node:assert/strict';
import { arenaHandOptions, arenaInteractionStamp, arenaActionKey, ARENA_VERSIONS } from '../shared/arena.mjs';
const unit = (id, card = {}) => ({ id, card: { name: id, kind: 'pokemon', ...card }, energy: [], tools: [], under: [] });
function fixture(seat = 0, version = ARENA_VERSIONS[1]) {
  const players = [0, 1].map(index => ({ hand: [], active: unit('active-' + index), bench: [unit('bench-' + index)], discard: [], hand_count: 6, deck_count: 40, prize_count: 6 }));
  players[seat].hand = ['basic', 'energy', 'evolution', 'tool', 'trainer', 'stadium'].map(id => unit(id, { program: { kind: id } }));
  return { version, seat, players, turn: seat, turn_number: 3, phase: 'playing', waiting_for: null, prompt: null, stadium: null, legal: [], events: [{ n: 1 }] };
}
const add = (table, card, type, more = {}) => {
  const move = { card, label: 'Use ' + card, action: { type, card, ...more } }; table.legal.push(move); return move;
};
for (const version of ARENA_VERSIONS) for (const seat of [0, 1]) {
  test(`${version}, seat ${seat}: route exact server hand moves without deriving new payloads`, () => {
    const table = fixture(seat, version);
    add(table, 'basic', 'bench'); add(table, 'energy', 'energy', { target: 'active-' + seat });
    add(table, 'evolution', 'evolve', { target: 'bench-' + seat }); add(table, 'tool', 'trainer', { target: 'active-' + seat });
    add(table, 'trainer', 'trainer'); add(table, 'stadium', 'trainer');
    const before = JSON.stringify(table), options = arenaHandOptions(table);
    assert.deepEqual(options.map(o => o.target), [`zone:${seat}:bench`, `card:active-${seat}`, `card:bench-${seat}`, `card:active-${seat}`, 'trainer', 'stadium']);
    assert.equal(new Set(options.map(o => o.key)).size, 6);
    for (const [index, option] of options.entries()) assert.equal(option.action, table.legal[index].action);
    assert.equal(JSON.stringify(table), before);
    table.legal.splice(1, 1); assert.equal(arenaHandOptions(table).some(o => o.card === 'energy'), false);
  });
  test(`${version}, seat ${seat}: setup has separate Active and Bench destinations`, () => {
    const table = fixture(seat, version); table.phase = 'setup'; table.turn = 1 - seat;
    add(table, 'basic', 'setup', { zone: 'active' }); add(table, 'basic', 'setup', { zone: 'bench' });
    assert.deepEqual(arenaHandOptions(table).map(o => o.target), [`zone:${seat}:active`, `zone:${seat}:bench`]);
  });
}
test('targeted Trainers can use the opposing public field, not opposing hidden zones', () => {
  const table = fixture(); add(table, 'trainer', 'trainer', { target: 'bench-1' });
  assert.equal(arenaHandOptions(table)[0].target, 'card:bench-1');
  assert.match(arenaHandOptions(table)[0].targetLabel, /Opponent/);
  table.players[1].bench[0].hidden = true; assert.deepEqual(arenaHandOptions(table), []);
});
for (const [name, change] of [
  ['prompt', t => { t.prompt = {}; }], ['opponent decision', t => { t.waiting_for = 1; }],
  ['own decision', t => { t.waiting_for = 0; }], ['opponent turn', t => { t.turn = 1; }],
  ['finished', t => { t.phase = 'finished'; }], ['resolution', t => { t.phase = 'resolution'; }],
  ['unknown rules', t => { t.version = 'future'; }], ['invalid seat', t => { t.seat = 2; }],
  ['no legal list', t => { delete t.legal; }], ['hidden own card', t => { t.players[0].hand[0].hidden = true; }]
]) test(`${name}: no playable indicators or drag routes`, () => {
  const table = fixture(); add(table, 'basic', 'bench'); change(table);
  assert.deepEqual(arenaHandOptions(table), []);
});
test('network/pending/action lock clears every indicator and route', () => {
  const table = fixture(); add(table, 'basic', 'bench'); assert.deepEqual(arenaHandOptions(table, true), []);
});
test('hand routing excludes attacks, global controls, absent identities and foreign payloads', () => {
  const table = fixture();
  table.legal = [
    { card: 'basic', label: 'Attack', action: { type: 'attack', index: 0 } },
    { card: null, label: 'End turn', action: { type: 'end_turn' } },
    { card: 'absent', label: 'Play', action: { type: 'bench', card: 'absent' } },
    { card: 'basic', label: 'Mismatch', action: { type: 'bench', card: 'energy' } },
    { card: 'basic', label: 'Injected', action: { type: 'bench', card: 'basic', seat: 1 } },
    { card: 'basic', label: 'Unknown', action: { type: '__proto__', card: 'basic' } },
    { card: 'basic', label: 'No zone', action: { type: 'setup', card: 'basic', zone: 'deck' } }
  ];
  assert.deepEqual(arenaHandOptions(table), []);
});
test('Energy and evolution never target a foreign or absent field unit', () => {
  const table = fixture();
  for (const type of ['energy', 'evolve']) for (const target of ['active-1', 'unknown', 'basic']) add(table, type === 'energy' ? 'energy' : 'evolution', type, { target });
  assert.deepEqual(arenaHandOptions(table), []);
});
test('generic Trainers retain typed follow-up handling; missing Stadium support is not invented', () => {
  const table = fixture(); add(table, 'trainer', 'trainer'); add(table, 'stadium', 'trainer'); delete table.stadium;
  assert.deepEqual(arenaHandOptions(table).map(o => o.target), ['trainer']);
});
test('duplicate equivalent server actions have a single stable confirmation', () => {
  const table = fixture(), move = add(table, 'basic', 'bench');
  table.legal.push({ ...move, action: { card: 'basic', type: 'bench' } });
  assert.equal(arenaHandOptions(table).length, 1);
  assert.equal(arenaActionKey(move.action), arenaActionKey(table.legal[1].action));
});
test('identical polling retains an intent; all relevant acknowledged changes invalidate it', () => {
  const table = fixture(); add(table, 'energy', 'energy', { target: 'active-0' });
  const stamp = arenaInteractionStamp(table); assert.equal(arenaInteractionStamp(structuredClone(table)), stamp);
  for (const mutate of [
    t => { t.events.push({ n: 2 }); }, t => { t.turn = 1; }, t => { t.round = 2; },
    t => { t.phase = 'finished'; }, t => { t.players[0].active.damage = 10; },
    t => { t.players[0].hand.pop(); }, t => { t.players[0].deck_count--; },
    t => { t.legal = []; }, t => { t.prompt = {}; }, t => { t.players[0].active.tools.push(unit('attachment')); }
  ]) { const next = structuredClone(table); mutate(next); assert.notEqual(arenaInteractionStamp(next), stamp); }
});
test('private poison getters are never read by routing or snapshot invalidation', () => {
  const table = fixture(); add(table, 'basic', 'bench');
  const deny = { get() { throw new Error('Private field was read'); } };
  for (const p of table.players) { Object.defineProperty(p, 'deck', deny); Object.defineProperty(p, 'prizes', deny); }
  Object.defineProperty(table.players[1], 'hand', deny);
  const hidden = { hidden: true }; for (const key of ['id', 'card', 'tools', 'energy', 'under']) Object.defineProperty(hidden, key, deny);
  table.players[1].active = hidden; table.players[1].bench = [hidden];
  assert.equal(arenaHandOptions(table).length, 1); assert.doesNotThrow(() => arenaInteractionStamp(table));
});
test('unknown action objects and malformed views fail closed', () => {
  for (const value of [null, undefined, [], {}, 'bad']) assert.deepEqual(arenaHandOptions(value), []);
  for (const value of [null, undefined, [], { type: 'choose', choices: ['x'] }, { type: 'bench', card: {} }]) assert.equal(arenaActionKey(value), '');
});
