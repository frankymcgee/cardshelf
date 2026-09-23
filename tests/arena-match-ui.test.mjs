import test from 'node:test';
import assert from 'node:assert/strict';
import { arenaTurnStatus, arenaPrizeCounts, arenaEndTurnContext, arenaEndTurnMove, arenaHistoryRows } from '../shared/arena-match-ui.mjs';
const end = () => ({ label: 'End turn', action: { type: 'end_turn' } });
const table = (seat = 0, version = 'pokemon-expanded-v2') => ({ version, seat, phase: 'playing', turn: seat, turn_number: 3,
  players: [{ prize_count: 6, ready: false }, { prize_count: 4, ready: false }], legal: [end()], prompt: null, waiting_for: null });
for (const seat of [0, 1]) for (const version of ['pokemon-core-v1', 'pokemon-expanded-v2']) {
  test(`${version}, seat ${seat}: guidance and public Prize counts are relative to the viewer`, () => {
    const view = table(seat, version), before = structuredClone(view);
    assert.equal(arenaTurnStatus(view).title, 'Your move');
    assert.deepEqual(arenaPrizeCounts(view).map(row => row.seat), [seat, 1 - seat]);
    assert.equal(arenaPrizeCounts(view)[0].count, view.players[seat].prize_count);
    assert.ok(arenaEndTurnContext(view, 'match', 1)); assert.deepEqual(view, before);
    view.turn = 1 - seat; assert.equal(arenaTurnStatus(view).title, 'Opponent’s turn');
    assert.equal(arenaEndTurnContext(view, 'match', 1), '');
  });
}
for (const [name, options, title] of [
  ['sending', { busy: true, uncertain: true, connected: false }, 'Sending action…'],
  ['uncertain', { uncertain: true }, 'Action result uncertain'],
  ['offline', { connected: false }, 'Connection interrupted'],
  ['not active', { status: 'ready' }, 'Waiting for the table'],
]) test(name + ' cannot tell the player to make a new move', () => assert.equal(arenaTurnStatus(table(), options).title, title));
test('decisions take priority over setup and ordinary turns', () => {
  const view = table(); view.phase = 'setup'; view.prompt = { kind: 'first' };
  assert.equal(arenaTurnStatus(view).title, 'Your decision is needed'); view.prompt = null; view.waiting_for = 1;
  assert.equal(arenaTurnStatus(view).title, 'Opponent is choosing…'); view.waiting_for = null;
  assert.equal(arenaTurnStatus(view).title, 'Prepare your opening field'); view.players[0].ready = true;
  assert.equal(arenaTurnStatus(view).title, 'Opening field confirmed');
});
for (const result of [undefined, null, 'victory', 'unknown', 7, -1]) test('unknown result never invents defeat: ' + result, () => {
  const view = table(); view.result = result; assert.equal(arenaTurnStatus(view, { status: 'finished' }).title, 'Match complete');
});
for (const [result, expected] of [[0, 'Victory'], [1, 'Defeat'], ['draw', 'Draw']]) test('finished result: ' + expected, () => {
  const view = table(); view.result = result; assert.equal(arenaTurnStatus(view, { status: 'finished' }).title, expected);
});
for (const count of [undefined, null, -1, 7, '3', NaN, Infinity]) test('invalid Prize count remains unknown: ' + count, () => {
  const view = table(); view.players[0].prize_count = count; assert.equal(arenaPrizeCounts(view)[0].count, null);
});
test('zero Prizes is a real count, not a missing value or a locally declared win', () => {
  const view = table(); view.players[0].prize_count = 0;
  assert.equal(arenaPrizeCounts(view)[0].count, 0); assert.equal(arenaTurnStatus(view).title, 'Your move');
});
for (const patch of [{ version: 'future' }, { seat: '0' }, { seat: 2 }]) test('unsupported projection fails closed ' + JSON.stringify(patch), () => {
  const view = Object.assign(table(), patch); assert.equal(arenaTurnStatus(view).title, 'Table unavailable');
  assert.deepEqual(arenaPrizeCounts(view), []); assert.equal(arenaEndTurnContext(view, 'match', 1), '');
});
for (const patch of [{ phase: 'setup' }, { phase: 'finished' }, { turn: 1 }, { prompt: {} }, { waiting_for: 0 }, { waiting_for: 1 }, { legal: [] }]) {
  test('end-turn review invalidated by ' + JSON.stringify(patch), () => assert.equal(arenaEndTurnContext(Object.assign(table(), patch), 'match', 1), ''));
}
test('confirmation identity binds match, revision, seat, rules and turn', () => {
  const view = table(), original = arenaEndTurnContext(view, 'match', 2);
  assert.equal(original, arenaEndTurnContext(structuredClone(view), 'match', 2));
  assert.notEqual(original, arenaEndTurnContext(view, 'other', 2));
  assert.notEqual(original, arenaEndTurnContext(view, 'match', 3));
  assert.equal(arenaEndTurnContext(view, 'match', 2, true), '');
  assert.equal(arenaEndTurnContext(view, '', 2), ''); assert.equal(arenaEndTurnContext(view, 'match', 0), '');
});
test('only an exact End turn action qualifies; no newly constructed action is returned', () => {
  const move = end(); assert.equal(arenaEndTurnMove([move]), move);
  for (const action of [{ type: 'attack' }, { type: 'end_turn', seat: 0 }, ['end_turn'], null]) assert.equal(arenaEndTurnMove([{ label: 'End turn', action }]), null);
  assert.equal(arenaEndTurnMove([{ ...move, card: 'foreign' }]), null);
});
test('guidance and review metadata never access hidden contents', () => {
  const view = table(); const poison = () => { throw Error('private field accessed'); };
  for (const player of view.players) for (const key of ['hand', 'deck', 'prizes', 'active', 'bench']) Object.defineProperty(player, key, { get: poison });
  assert.equal(arenaTurnStatus(view).title, 'Your move'); assert.equal(arenaPrizeCounts(view).length, 2);
  assert.ok(arenaEndTurnContext(view, 'match', 1));
});
const events = [{ n: 1, seat: null, text: 'The table opened.' }, { n: 2, seat: 0, text: 'Played a Trainer.', revealed: [{ name: 'Original card', hidden: { SECRET: true } }] }, { n: 3, seat: 1, text: 'Attack dealt 30 damage.', raw: { SECRET: true } }];
test('history is newest first, has a strict output allowlist and never mutates events', () => {
  const before = structuredClone(events), rows = arenaHistoryRows(events, 0);
  assert.deepEqual(rows.map(row => row.n), [3, 2, 1]); assert.ok(!JSON.stringify(rows).includes('SECRET')); assert.deepEqual(events, before);
});
for (const seat of [0, 1]) test('history filters relative to seat ' + seat, () => {
  assert.equal(arenaHistoryRows(events, seat, 'mine')[0].seat, seat);
  assert.equal(arenaHistoryRows(events, seat, 'opponent')[0].seat, 1 - seat);
  assert.equal(arenaHistoryRows(events, seat, 'table')[0].seat, null);
});
test('history search includes only event text and disclosed names', () => {
  assert.equal(arenaHistoryRows(events, 0, 'all', '  original  ')[0].n, 2);
  assert.equal(arenaHistoryRows(events, 0, 'all', 'SECRET').length, 0);
  assert.equal(arenaHistoryRows(events, 0, 'all', 'missing').length, 0);
});
test('history rejects invalid seats, filters, rows and duplicate event IDs', () => {
  assert.deepEqual(arenaHistoryRows(events, '0'), []); assert.deepEqual(arenaHistoryRows(events, 0, 'invalid'), []);
  const rows = arenaHistoryRows([...events, events[2], { n: 4, seat: '0', text: 'bad' }, { n: 5, seat: 0, text: {} }], 0);
  assert.equal(rows.length, 3);
});
test('history processing, text and revealed names are bounded', () => {
  const rows = arenaHistoryRows(Array.from({ length: 5000 }, (_, n) => ({ n, seat: 0, text: 'x'.repeat(2000), revealed: Array.from({ length: 80 }, () => ({ name: 'a'.repeat(200) })) })), 0);
  assert.equal(rows.length, 120); assert.equal(rows[0].text.length, 1200); assert.equal(rows[0].revealed.length, 60); assert.equal(rows[0].revealed[0].length, 160);
});
