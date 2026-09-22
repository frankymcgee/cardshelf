// Original synthetic cards only. No accounts, real decks or catalogue requests.
export const tableUnit = (id, extra = {}) => ({
  id, card: { id: 'training:' + id, name: id, kind: 'pokemon', hp: 100, type: 'Grass', stage: 'Basic', attacks: [] },
  energy: [], under: [], damage: 0, conditions: {}, ...extra
});
export function tableFixture({ seat = 0, legacy = false, empty = false, setup = false, longHand = false, locked = false } = {}) {
  const players = [0, 1].map(n => ({
    hand: [], hand_count: empty ? 0 : 7, deck_count: empty ? 0 : 40, prize_count: empty ? 0 : 6,
    active: empty ? null : tableUnit('Active-' + n),
    bench: empty ? [] : Array.from({ length: 5 }, (_, i) => tableUnit(`Bench-${n}-${i}`)),
    discard: empty ? [] : [tableUnit('Discard-' + n)], ready: false
  }));
  const other = seat === 0 ? 1 : 0;
  players[seat].hand = Array.from({ length: empty ? 0 : longHand ? 30 : 7 }, (_, i) => tableUnit('Hand-' + i));
  players[seat].hand_count = players[seat].hand.length;
  // Deliberate poisoned private fields prove the board uses public counts only.
  players[other].hand = [tableUnit('SECRET-HAND')];
  for (const p of players) { p.deck = [tableUnit('SECRET-DECK')]; p.prizes = [tableUnit('SECRET-PRIZE')]; }
  if (setup) {
    players[other].active = { hidden: true, card: { name: 'SECRET-ACTIVE', image_url: '/SECRET.png' } };
    players[other].bench = [{ hidden: true, card: { name: 'SECRET-BENCH' }, tools: [tableUnit('SECRET-TOOL')] }];
  }
  const table = { seat, turn: seat, phase: setup ? 'setup' : 'playing', turn_number: 3, players, waiting_for: null, prompt: null };
  if (!legacy) table.stadium = empty ? null : { seat: other, unit: tableUnit('Training Park', { card: { id: 'training:park', name: 'Training Park', kind: 'trainer' } }) };
  return { table, aliases: ['North player', 'South player'], selected: '', locked,
    stadiumMoves: legacy || empty ? [] : [{ label: 'Use Stadium: Training Park', action: { type: 'stadium' } }] };
}
