import { randomInt, randomUUID, createHash } from 'node:crypto';
import { db, audit } from '../db.mjs';
import { arenaSettings, requireArena } from './access.mjs';
import { arenaUserLock, snapshotArenaDeck } from './decks.mjs';
import { arenaMatchQuota, assertMatchVersion } from './matches.mjs';
import { arenaSpectatorView } from './spectator.mjs';
import { lockArenaTournament, advanceTournamentWinner } from './tournament-state.mjs';
import { seedTournament } from '../../shared/arena-tournaments.mjs';
import { ARENA_VERSION } from '../../shared/arena.mjs';
import * as v from './input.mjs';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function actor(sql, userId) {
  const [user] = await sql`SELECT id,role FROM app_users WHERE id=${userId}`;
  v.check(user, 'Sign in to continue.', 401); return user;
}
function admin(user) { v.check(user.role === 'admin', 'Administrator access is required.', 403); }
async function access(sql, userId, id) {
  const user = await actor(sql, userId);
  const [event] = await sql`SELECT * FROM arena_tournaments WHERE id=${id}`;
  const [entry] = await sql`SELECT * FROM arena_tournament_entries WHERE tournament_id=${id} AND user_id=${userId} AND status<>'removed'`;
  v.check(event && (user.role === 'admin' || entry), 'Tournament not found.', 404);
  return { user, event, entry };
}
export async function arenaTournamentList(userId) {
  const sql = db(), user = await actor(sql, userId), isAdmin = user.role === 'admin';
  const events = await sql`SELECT t.id,t.title,t.description,t.capacity,t.status,t.revision,t.created_at,t.started_at,
    me.status AS invitation_status,(SELECT count(*)::integer FROM arena_tournament_entries e WHERE e.tournament_id=t.id AND e.status='accepted') AS entrants
    FROM arena_tournaments t LEFT JOIN arena_tournament_entries me ON me.tournament_id=t.id AND me.user_id=${userId}
    WHERE ${isAdmin} OR (me.id IS NOT NULL AND me.status<>'removed') ORDER BY t.created_at DESC LIMIT 100`;
  return { events, is_admin: isAdmin };
}
export async function getArenaTournament(userId, id, sql = db()) {
  v.uuid(id); const { user, event, entry } = await access(sql, userId, id), isAdmin = user.role === 'admin';
  const entries = await sql`SELECT e.id,e.user_id,e.alias,e.status,e.seed,e.deck_id,e.deck_revision,e.deck_snapshot->>'title' AS deck_title,
    e.spectator_consent,u.email FROM arena_tournament_entries e LEFT JOIN app_users u ON u.id=e.user_id
    WHERE e.tournament_id=${id} AND e.status<>'removed' ORDER BY e.seed NULLS LAST,e.invited_at,e.id`;
  const nodes = await sql`SELECT id,round,position,left_id,right_id,winner_id,status,outcome,reason,attempt,match_id FROM arena_tournament_nodes WHERE tournament_id=${id} ORDER BY round,position`;
  const games = await sql`SELECT id,tournament_node_id AS node_id,status,revision,created_at,updated_at FROM arena_matches WHERE tournament_id=${id} ORDER BY created_at,id`;
  return { id: event.id, title: event.title, description: event.description, capacity: event.capacity, status: event.status,
    revision: event.revision, bracket_size: event.bracket_size, champion_id: event.champion_id, created_at: event.created_at,
    started_at: event.started_at, ended_at: event.ended_at, is_admin: isAdmin, own_entry_id: entry?.id || null,
    entries: entries.map(e => ({ id: e.id, alias: e.alias, status: e.status, seed: e.seed, unavailable: !e.user_id,
      ...(isAdmin ? { email: e.email || '' } : {}),
      ...(e.user_id === userId ? { deck_id: e.deck_id, deck_revision: e.deck_revision, deck_title: e.deck_title, spectator_consent: e.spectator_consent } : {}) })),
    nodes, games };
}
export async function createArenaTournament(userId, value) {
  const o = v.object(value, ['title', 'description', 'capacity', 'request_id']);
  const title = v.text(o.title, 1, 100), description = v.text(o.description || '', 0, 1000), capacity = v.integer(o.capacity, 2, 64), requestId = v.uuid(o.request_id);
  return db().begin(async sql => {
    admin(await actor(sql, userId));
    await sql`SELECT pg_advisory_xact_lock(72491702)`;
    const [old] = await sql`SELECT id,request_hash FROM arena_tournaments WHERE created_by=${userId} AND request_id=${requestId}`;
    if (old) { v.check(old.request_hash === hash(o), 'Request ID was used for another tournament.', 409); return getArenaTournament(userId, old.id, sql); }
    const [count] = await sql`SELECT count(*)::integer AS n FROM arena_tournaments WHERE status IN ('registration','running')`;
    v.check(count.n < 20, 'Complete or cancel an open event first. At most 20 open tournaments are allowed.', 409);
    const [event] = await sql`INSERT INTO arena_tournaments(created_by,title,description,capacity,engine_version,request_id,request_hash)
      VALUES(${userId},${title},${description},${capacity},${ARENA_VERSION},${requestId},${hash(o)}) RETURNING id`;
    await audit(sql, userId, 'arena.tournament.created', { tournament_id: event.id, title, capacity });
    return getArenaTournament(userId, event.id, sql);
  });
}
const fields = {
  invite: ['email'], remove: ['entry_id'], accept: ['deck_id', 'deck_revision', 'alias', 'spectator_consent'],
  decline: [], withdraw: [], start: ['confirm'], open: ['node_id'], forfeit: ['node_id', 'winner_id', 'reason'], cancel: ['reason']
};
export async function actArenaTournament(userId, id, value) {
  v.uuid(id); v.check(value && typeof value.type === 'string' && Object.hasOwn(fields, value.type), 'Choose a tournament action.');
  const o = v.object(value, ['type', 'revision', 'request_id', ...fields[value.type]]);
  v.integer(o.revision, 1); const requestId = v.uuid(o.request_id), requestHash = hash({ id, ...o });
  return db().begin(async sql => {
    const event = await lockArenaTournament(sql, id), { user, entry } = await access(sql, userId, id);
    if (['invite', 'remove', 'start', 'forfeit', 'cancel'].includes(o.type)) admin(user);
    const [receipt] = await sql`SELECT request_hash,response FROM arena_tournament_receipts WHERE user_id=${userId} AND request_id=${requestId}`;
    if (receipt) { v.check(receipt.request_hash === requestHash, 'Request ID was used for another action.', 409); return { ...await getArenaTournament(userId, id, sql), ...receipt.response }; }
    v.check(event.revision === o.revision, 'The tournament changed. Review the refreshed bracket before acting.', 409);
    const response = {};
    if (['invite', 'remove', 'accept', 'decline', 'withdraw', 'start'].includes(o.type)) v.check(event.status === 'registration', 'Registration is closed. The seeded bracket and decks are locked.', 409);
    if (o.type === 'invite') {
      const email = v.text(o.email, 3, 254).toLowerCase();
      const [member] = await sql`SELECT id,name FROM app_users WHERE lower(email)=${email}`;
      v.check(member, 'No registered member has that email address.', 404);
      const [old] = await sql`SELECT id,status FROM arena_tournament_entries WHERE tournament_id=${id} AND user_id=${member.id}`;
      v.check(!old || ['removed', 'declined', 'withdrawn'].includes(old.status), 'This member already has an invitation.', 409);
      const [counts] = await sql`SELECT count(*)::integer AS total,count(*) FILTER(WHERE status IN ('invited','accepted'))::integer AS active FROM arena_tournament_entries WHERE tournament_id=${id}`;
      v.check(counts.active < event.capacity && (old || counts.total < 256), 'The invitation capacity has been reached. Remove an unused invitation first.', 409);
      const alias = String(member.name || 'Player').trim().slice(0, 40) || 'Player';
      await sql`INSERT INTO arena_tournament_entries(tournament_id,user_id,alias) VALUES(${id},${member.id},${alias})
        ON CONFLICT(tournament_id,user_id) DO UPDATE SET status='invited',deck_id=null,deck_revision=null,deck_snapshot=null,spectator_consent=false,invited_at=now(),responded_at=null`;
    } else if (o.type === 'remove') {
      v.uuid(o.entry_id);
      const rows = await sql`UPDATE arena_tournament_entries SET status='removed',deck_id=null,deck_revision=null,deck_snapshot=null,spectator_consent=false WHERE id=${o.entry_id} AND tournament_id=${id} AND status<>'removed' RETURNING id`;
      v.check(rows.length, 'Invitation not found.', 404);
    } else if (o.type === 'accept') {
      v.check(entry && ['invited', 'accepted'].includes(entry.status), 'An open invitation is required.', 409);
      v.check(o.spectator_consent === true, 'Acknowledge administrator viewing and possible streaming of the public match board.');
      const alias = v.text(o.alias, 1, 40);
      await requireArena(userId, sql, true); await arenaUserLock(sql, userId);
      const snapshot = await snapshotArenaDeck(sql, userId, o.deck_id, o.deck_revision, event.engine_version);
      await sql`UPDATE arena_tournament_entries SET status='accepted',alias=${alias},deck_id=${o.deck_id},deck_revision=${o.deck_revision},deck_snapshot=${sql.json(snapshot)},spectator_consent=true,responded_at=now() WHERE id=${entry.id}`;
    } else if (o.type === 'decline' || o.type === 'withdraw') {
      v.check(entry && ['invited', 'accepted'].includes(entry.status), 'No open invitation or registration to change.', 409);
      await sql`UPDATE arena_tournament_entries SET status=${o.type === 'decline' ? 'declined' : 'withdrawn'},deck_id=null,deck_revision=null,deck_snapshot=null,spectator_consent=false,responded_at=now() WHERE id=${entry.id}`;
    } else if (o.type === 'start') {
      v.check(o.confirm === true, 'Confirm the final entrants before drawing the bracket.');
      v.check((await arenaSettings(sql)).enabled, 'Enable Arena before starting a tournament.', 403);
      const entries = await sql`SELECT * FROM arena_tournament_entries WHERE tournament_id=${id} AND status='accepted' ORDER BY user_id`;
      v.check(entries.length >= 2 && entries.length <= event.capacity, 'At least two accepted entrants with playable decks are required.');
      for (const entrant of entries) {
        v.check(entrant.user_id && entrant.deck_snapshot && entrant.spectator_consent, 'An entrant is unavailable. Remove their registration first.', 409);
        await requireArena(entrant.user_id, sql, true);
      }
      const draw = seedTournament(entries.map(e => e.id), randomInt); event.bracket_size = draw.size;
      for (let i = 0; i < draw.seeds.length; i++) await sql`UPDATE arena_tournament_entries SET seed=${i + 1} WHERE id=${draw.seeds[i]}`;
      const byes = [];
      for (let round = 1; round <= Math.log2(draw.size); round++) for (let position = 0; position < draw.size / (2 ** round); position++) {
        const [left, right] = round === 1 ? draw.pairs[position] : [null, null], bye = round === 1 && (!left || !right);
        const [node] = await sql`INSERT INTO arena_tournament_nodes(tournament_id,round,position,left_id,right_id,winner_id,status,outcome)
          VALUES(${id},${round},${position},${left},${right},${bye ? left || right : null},${bye ? 'bye' : left && right ? 'ready' : 'pending'},${bye ? 'bye' : ''}) RETURNING *`;
        if (bye) byes.push(node);
      }
      await sql`UPDATE arena_tournaments SET status='running',bracket_size=${draw.size},started_at=now() WHERE id=${id}`;
      for (const node of byes) await advanceTournamentWinner(sql, event, node, node.winner_id);
    } else if (o.type === 'open') {
      v.check(event.status === 'running', 'This tournament is not running.', 409); v.uuid(o.node_id);
      const [node] = await sql`SELECT * FROM arena_tournament_nodes WHERE id=${o.node_id} AND tournament_id=${id}`;
      v.check(node && (user.role === 'admin' || entry && [node.left_id, node.right_id].includes(entry.id)), 'Pairing not found.', 404);
      v.check(['ready', 'playing', 'draw'].includes(node.status), 'This pairing is not ready to play.', 409);
      if (node.status === 'playing' && node.match_id) response.opened_match_id = node.match_id;
      else {
        v.check(node.attempt < 20, 'The rematch limit has been reached. Ask the administrator to resolve this pairing.', 409);
        const entrants = await sql`SELECT * FROM arena_tournament_entries WHERE id IN ${sql([node.left_id, node.right_id])} ORDER BY user_id`;
        v.check(entrants.length === 2 && entrants.every(e => e.user_id && e.deck_snapshot && e.spectator_consent), 'A participant is unavailable. Ask the administrator to resolve this pairing.', 409);
        for (const entrant of entrants) { await requireArena(entrant.user_id, sql, true); await arenaUserLock(sql, entrant.user_id); await arenaMatchQuota(sql, entrant.user_id); }
        const left = entrants.find(e => e.id === node.left_id), right = entrants.find(e => e.id === node.right_id);
        const [match] = await sql`INSERT INTO arena_matches(host_id,guest_id,host_alias,guest_alias,mode,status,host_deck,guest_deck,request_id,request_hash,engine_version,tournament_id,tournament_node_id)
          VALUES(${left.user_id},${right.user_id},${left.alias},${right.alias},'pvp','ready',${sql.json(left.deck_snapshot)},${sql.json(right.deck_snapshot)},${randomUUID()},${hash({ id, node: node.id, attempt: node.attempt + 1 })},${event.engine_version},${id},${node.id}) RETURNING id`;
        await sql`UPDATE arena_tournament_nodes SET status='playing',match_id=${match.id},attempt=attempt+1 WHERE id=${node.id}`;
        response.opened_match_id = match.id;
      }
    } else if (o.type === 'forfeit') {
      v.check(event.status === 'running', 'This tournament is not running.', 409); v.uuid(o.node_id); v.uuid(o.winner_id);
      const reason = v.text(o.reason, 5, 500);
      const [node] = await sql`SELECT * FROM arena_tournament_nodes WHERE id=${o.node_id} AND tournament_id=${id}`;
      v.check(node && ['ready', 'playing', 'draw'].includes(node.status) && node.left_id && node.right_id && [node.left_id, node.right_id].includes(o.winner_id), 'Choose an unresolved pairing and one of its entrants.', 409);
      if (node.match_id) await sql`UPDATE arena_matches SET status='cancelled',revision=revision+1,updated_at=now() WHERE id=${node.match_id} AND status IN ('ready','active')`;
      await sql`UPDATE arena_tournament_nodes SET status='completed',winner_id=${o.winner_id},outcome='forfeit',reason=${reason} WHERE id=${node.id}`;
      await advanceTournamentWinner(sql, event, node, o.winner_id);
    } else if (o.type === 'cancel') {
      v.check(['registration', 'running'].includes(event.status), 'This tournament is already closed.', 409);
      const reason = v.text(o.reason, 5, 500);
      await sql`UPDATE arena_tournaments SET status='cancelled',ended_at=now() WHERE id=${id}`;
      await sql`UPDATE arena_tournament_nodes SET status='cancelled',reason=${reason} WHERE tournament_id=${id} AND status IN ('pending','ready','playing','draw')`;
      await sql`UPDATE arena_matches SET status='cancelled',revision=revision+1,updated_at=now() WHERE tournament_id=${id} AND status IN ('ready','active')`;
    }
    await sql`UPDATE arena_tournaments SET revision=revision+1,updated_at=now() WHERE id=${id}`;
    await sql`INSERT INTO arena_tournament_receipts(tournament_id,user_id,request_id,request_hash,response) VALUES(${id},${userId},${requestId},${requestHash},${sql.json(response)})`;
    await audit(sql, userId, 'arena.tournament.' + o.type, { tournament_id: id, ...(o.node_id ? { node_id: o.node_id } : {}), ...(o.winner_id ? { winner_id: o.winner_id } : {}), ...(o.reason ? { reason: o.reason } : {}) });
    return { ...await getArenaTournament(userId, id, sql), ...response };
  });
}
export async function spectateArenaTournament(userId, id, matchId) {
  v.uuid(id); v.uuid(matchId); const sql = db(); admin(await actor(sql, userId));
  const [row] = await sql`SELECT m.*,t.title AS tournament_title,n.round,n.position,t.bracket_size
    FROM arena_matches m JOIN arena_tournaments t ON t.id=m.tournament_id JOIN arena_tournament_nodes n ON n.id=m.tournament_node_id
    WHERE m.id=${matchId} AND m.tournament_id=${id}`;
  v.check(row, 'Tournament match not found.', 404); assertMatchVersion(row);
  return { id: row.id, tournament_id: id, tournament_title: row.tournament_title, round: row.round, position: row.position,
    bracket_size: row.bracket_size, host_alias: row.host_alias, guest_alias: row.guest_alias, status: row.status,
    revision: row.revision, host_ready: row.host_ready, guest_ready: row.guest_ready, updated_at: row.updated_at,
    table: row.state?.version ? arenaSpectatorView(row.state) : null };
}
