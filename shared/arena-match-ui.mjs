/** Presentation only. Inputs are the seated player's acknowledged projection. */
import { ARENA_VERSIONS } from './arena.mjs';
const versions = new Set(ARENA_VERSIONS);
const seatOK = seat => seat === 0 || seat === 1;
const integer = (value, max) => Number.isSafeInteger(value) && value >= 0 && value <= max;
const validTable = table => table && versions.has(table.version) && seatOK(table.seat);

export function arenaTurnStatus(table, { status = 'active', connected = true, busy = false, uncertain = false } = {}) {
  const result = (title, detail, tone = 'neutral') => ({ title, detail, tone });
  if (!validTable(table)) return result('Table unavailable', 'Wait for a supported, player-specific table.');
  if (status === 'finished' || status === 'cancelled' || table.phase === 'finished') {
    const title = table.result === 'draw' ? 'Draw' : seatOK(table.result) ? (table.result === table.seat ? 'Victory' : 'Defeat') : 'Match complete';
    return result(title, 'Review the final table or open History. No further game actions are available.', 'complete');
  }
  if (busy) return result('Sending action…', 'Waiting for the server to acknowledge your action.', 'paused');
  if (uncertain) return result('Action result uncertain', 'Use Retry same action. Do not repeat the move with a new request.', 'paused');
  if (!connected) return result('Connection interrupted', 'Actions are paused. You can still inspect the last confirmed table.', 'paused');
  if (status !== 'active') return result('Waiting for the table', 'The match is not currently active.');
  if (table.prompt) return result('Your decision is needed', 'Complete or resume the required decision before playing another card.', 'decision');
  if (table.waiting_for != null) return result(table.waiting_for === table.seat ? 'Resolving your decision' : 'Opponent is choosing…', 'Play continues after the required decision resolves.', 'decision');
  if (table.phase === 'setup') {
    if (table.players?.[table.seat]?.mulligan_waiting) return result('Waiting to resolve your mulligan', 'Your opponent must lock their opening field before your no-Basic hand is revealed and redealt.');
    if (table.players?.[table.seat]?.ready) return result('Opening field confirmed', 'Wait for the remaining setup decisions. Your opening field stays private until setup finishes.');
    return result('Prepare your opening field', 'Select a Basic Pokémon for Active, add optional Bench Pokémon, then confirm Ready.', 'own');
  }
  if (table.phase !== 'playing' || !seatOK(table.turn)) return result('Resolving the game', 'Wait for the next confirmed game state.');
  if (table.turn !== table.seat) return result('Opponent’s turn', 'You can inspect disclosed cards while your opponent plays.');
  return result('Your move', 'Select a card to see its server-checked moves. Attacking normally ends the turn.', 'own');
}

export function arenaPrizeCounts(table) {
  if (!validTable(table) || !Array.isArray(table.players) || table.players.length !== 2) return [];
  // Never inspect Prize arrays, hands, deck contents, or card identities.
  return [table.seat, 1 - table.seat].map(seat => ({ seat, own: seat === table.seat,
    count: integer(table.players[seat]?.prize_count, 6) ? table.players[seat].prize_count : null }));
}

export function arenaEndTurnMove(moves) {
  if (!Array.isArray(moves)) return null;
  return moves.slice(0, 256).find(move => move && !move.card && typeof move.label === 'string'
    && move.action && !Array.isArray(move.action) && move.action.type === 'end_turn'
    && Object.keys(move.action).length === 1) || null;
}

export function arenaEndTurnContext(table, matchId, revision, locked = false) {
  if (locked || !validTable(table) || typeof matchId !== 'string' || !matchId || matchId.length > 100
    || !integer(revision, Number.MAX_SAFE_INTEGER) || revision < 1 || table.phase !== 'playing'
    || table.turn !== table.seat || table.prompt || table.waiting_for != null
    || !arenaEndTurnMove(table.legal)) return '';
  return JSON.stringify([matchId, revision, table.version, table.seat, table.turn_number]);
}

export function arenaHistoryRows(events, seat, filter = 'all', query = '') {
  if (!Array.isArray(events) || !seatOK(seat) || !['all', 'mine', 'opponent', 'table'].includes(filter)) return [];
  const needle = typeof query === 'string' ? query.slice(0, 80).trim().toLowerCase() : '';
  const seen = new Set(), rows = [];
  for (const event of events.slice(-120).reverse()) {
    if (!event || !integer(event.n, Number.MAX_SAFE_INTEGER) || seen.has(event.n)
      || !(event.seat === null || seatOK(event.seat)) || typeof event.text !== 'string') continue;
    seen.add(event.n);
    const text = event.text.slice(0, 1200);
    const revealed = Array.isArray(event.revealed) ? event.revealed.slice(0, 60)
      .filter(card => card && typeof card.name === 'string').map(card => card.name.slice(0, 160)) : [];
    if (filter === 'mine' && event.seat !== seat || filter === 'opponent' && event.seat !== 1 - seat
      || filter === 'table' && event.seat !== null) continue;
    if (needle && ![text, ...revealed].join(' ').toLowerCase().includes(needle)) continue;
    rows.push({ n: event.n, seat: event.seat, text, revealed });
  }
  return rows.sort((a, b) => b.n - a.n);
}
