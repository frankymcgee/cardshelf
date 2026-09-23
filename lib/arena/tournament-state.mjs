import { ARENA_LOCK } from './access.mjs';
import * as v from './input.mjs';

// Every tournament write, including a player's match action, locks the event
// before billing/user/match rows. Simultaneous finishes cannot advance twice.
export async function lockArenaTournament(sql, id) {
  await sql`SELECT pg_advisory_xact_lock_shared(${ARENA_LOCK})`;
  const [event] = await sql`SELECT * FROM arena_tournaments WHERE id=${id} FOR UPDATE`;
  v.check(event, 'Tournament not found.', 404); return event;
}
export async function advanceTournamentWinner(sql, event, node, winnerId) {
  v.check(winnerId && [node.left_id, node.right_id].includes(winnerId), 'Invalid bracket winner.', 409);
  if (node.round === Math.log2(event.bracket_size)) {
    await sql`UPDATE arena_tournaments SET status='completed',champion_id=${winnerId},ended_at=now() WHERE id=${event.id}`;
    return;
  }
  const [next] = await sql`SELECT * FROM arena_tournament_nodes WHERE tournament_id=${event.id} AND round=${node.round + 1} AND position=${Math.floor(node.position / 2)}`;
  const key = node.position % 2 === 0 ? 'left_id' : 'right_id';
  v.check(next && (!next[key] || next[key] === winnerId) && next.status === 'pending', 'The next bracket slot has already been resolved.', 409);
  await sql`UPDATE arena_tournament_nodes SET ${sql({ [key]: winnerId })} WHERE id=${next.id}`;
  await sql`UPDATE arena_tournament_nodes SET status='ready' WHERE id=${next.id} AND left_id IS NOT NULL AND right_id IS NOT NULL`;
}
export async function recordTournamentResult(sql, event, match) {
  if (!event || match.status !== 'finished') return;
  const [node] = await sql`SELECT * FROM arena_tournament_nodes WHERE tournament_id=${event.id} AND match_id=${match.id}`;
  v.check(event.status === 'running' && node?.status === 'playing', 'Tournament match is no longer open.', 409);
  const result = match.state.result;
  v.check(result === 0 || result === 1 || result === 'draw', 'The server result cannot advance this bracket.', 409);
  const winner = result === 0 ? node.left_id : result === 1 ? node.right_id : null;
  await sql`UPDATE arena_tournament_nodes SET status=${winner ? 'completed' : 'draw'},winner_id=${winner},outcome=${winner ? 'played' : 'draw'},reason=${match.state.result_reason || ''} WHERE id=${node.id}`;
  if (winner) await advanceTournamentWinner(sql, event, node, winner);
  await sql`UPDATE arena_tournaments SET revision=revision+1,updated_at=now() WHERE id=${event.id}`;
}
