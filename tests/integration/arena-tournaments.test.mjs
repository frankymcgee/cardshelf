// Actual HTTP and isolated PostgreSQL; no real members, mail or external services.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { hashPassword, randomToken, digest } from '../../lib/security.mjs';
import { prepareTournamentOpening } from '../helpers/arena-tournament-setup.mjs';
import { lockArenaTournament, recordTournamentResult } from '../../lib/arena/tournament-state.mjs';
const base = process.env.TEST_BASE_URL, dbUrl = process.env.DATABASE_URL;
if (process.env.ALLOW_TEST_DATABASE !== 'yes' || !base || !new URL(dbUrl || 'http://invalid').pathname.endsWith('_test')) throw Error('Use the disposable _test database only.');
const sql = postgres(dbUrl, { max: 5 }), ids = [], events = [], suffix = randomUUID().replaceAll('-', ''), set = 'en:tournament-' + suffix;
const basic = set + '-1', energy = set + '-2';
async function request(path, user, method = 'GET', body, extra = {}) {
  const r = await fetch(base + path, { method, headers: { Origin: process.env.APP_ORIGIN || base, 'X-Requested-With': 'cardshelf', ...(user ? { Cookie: 'cardshelf_session=' + user.token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...extra }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json(), headers: r.headers };
}
const ok = r => { assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data; };
await test('Invited Arena tournaments and private administrator commentary', async t => {
  const old = await sql`SELECT * FROM arena_settings`; let admin, players, outsider, free, event, game, host, guest;
  const passwordHash = await hashPassword('Disposable tournament test password 123');
  async function account(role = 'user', tier = 'collector') {
    const id = randomUUID(), token = randomToken(), email = id + '@example.test'; ids.push(id);
    await sql`INSERT INTO app_users(id,name,email,password_hash,role) VALUES(${id},'Event tester',${email},${passwordHash},${role})`;
    await sql`INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(${digest(token)},${id},now()+interval '1 hour')`;
    if (tier) await sql`INSERT INTO account_tier_overrides(user_id,tier,reason) VALUES(${id},${tier},'Tournament fixture')`;
    return { id, token, email };
  }
  const get = (e = event, user = admin) => request('/api/arena/tournaments/' + e.id, user).then(ok);
  async function command(e, user, type, values = {}) {
    const current = await get(e, user);
    return request('/api/arena/tournaments/' + e.id + '/actions', user, 'POST', { type, revision: current.revision, request_id: randomUUID(), ...values });
  }
  async function tournament(count, members = players.slice(0, count)) {
    const result = ok(await request('/api/arena/tournaments', admin, 'POST', { title: 'Synthetic Cup', description: 'Disposable test event', capacity: count, request_id: randomUUID() })); events.push(result.id);
    for (const [i, user] of members.entries()) {
      ok(await command(result, admin, 'invite', { email: user.email }));
      ok(await command(result, user, 'accept', { deck_id: user.deck.id, deck_revision: user.deck.revision, alias: 'Entrant ' + i, spectator_consent: true }));
    }
    return get(result);
  }
  const view = (user, id = game.id) => request('/api/arena/matches/' + id, user).then(ok);
  async function move(user, action, id = game.id) { const before = await view(user, id); return ok(await request('/api/arena/matches/' + id + '/actions', user, 'POST', { revision: before.revision, request_id: randomUUID(), action })); }
  async function prepare(e, node) {
    const opened = ok(await command(e, admin, 'open', { node_id: node.id }));
    const [row] = await sql`SELECT * FROM arena_matches WHERE id=${opened.opened_match_id}`;
    const h = players.find(p => p.id === row.host_id), g = players.find(p => p.id === row.guest_id);
    await move(h, { type: 'ready' }, row.id); await move(g, { type: 'ready' }, row.id); await move(h, { type: 'start' }, row.id);
    return { row, h, g };
  }
  try {
    await sql`DELETE FROM arena_settings`; await sql`INSERT INTO arena_settings(enabled) VALUES(true)`;
    admin = await account('admin', null); players = await Promise.all(Array.from({ length: 4 }, () => account())); outsider = await account(); free = await account('user', null);
    await sql`INSERT INTO card_sets(id,provider_id,game,language,name,card_count) VALUES(${set},${set.slice(3)},'pokemon','en','Tournament synthetic set',2)`;
    const raw = [{ category: 'Pokemon', stage: 'Basic', hp: 100, types: ['Fire'], retreat: 1, attacks: [{ name: 'Tackle', damage: 30, cost: ['Colorless'] }] }, { category: 'Energy', energyType: 'Basic', effect: 'Basic Energy' }];
    for (const [i, id] of [basic, energy].entries()) await sql`INSERT INTO cards(id,provider_id,set_id,game,language,local_id,name,category,raw_data) VALUES(${id},${id.slice(3)},${set},'pokemon','en',${String(i + 1)},${i ? 'Fire Energy' : 'Tournament Basic'},${raw[i].category},${sql.json(raw[i])})`;
    for (const p of players) p.deck = ok(await request('/api/arena/decks', p, 'POST', { title: 'Registered snapshot', revision: 0, request_id: randomUUID(), cards: [{ card_id: basic, quantity: 4 }, { card_id: energy, quantity: 56 }] }));
    await t.test('creation is admin-only, origin-protected and idempotent', async () => {
      const body = { title: 'Main Cup', capacity: 3, request_id: randomUUID() };
      assert.equal((await request('/api/arena/tournaments')).status, 401);
      assert.equal((await request('/api/arena/tournaments', players[0], 'POST', body)).status, 403);
      assert.equal((await request('/api/arena/tournaments', admin, 'POST', body, { Origin: 'https://evil.test' })).status, 403);
      event = ok(await request('/api/arena/tournaments', admin, 'POST', body)); events.push(event.id);
      assert.equal(ok(await request('/api/arena/tournaments', admin, 'POST', body)).id, event.id);
      assert.equal((await request('/api/arena/tournaments', admin, 'POST', { ...body, title: 'Different' })).status, 409);
      assert.equal((await request('/api/arena/tournaments/' + event.id, outsider)).status, 404);
      assert.equal(ok(await request('/api/arena/tournaments', outsider)).events.length, 0);
    });
    await t.test('invitations use existing members and registrations require consent, access and the member’s own deck', async () => {
      ok(await command(event, admin, 'invite', { email: free.email }));
      assert.equal((await command(event, free, 'accept', { deck_id: players[0].deck.id, deck_revision: 1, alias: 'Free', spectator_consent: true })).status, 403);
      ok(await command(event, free, 'decline'));
      for (const [i, p] of players.slice(0, 3).entries()) {
        ok(await command(event, admin, 'invite', { email: p.email }));
        assert.equal((await command(event, p, 'accept', { deck_id: p.deck.id, deck_revision: p.deck.revision, alias: 'Entrant ' + i, spectator_consent: false })).status, 400);
        assert.equal((await command(event, p, 'accept', { deck_id: players[3].deck.id, deck_revision: 1, alias: 'Entrant ' + i, spectator_consent: true })).status, 404);
        ok(await command(event, p, 'accept', { deck_id: p.deck.id, deck_revision: p.deck.revision, alias: 'Entrant ' + i, spectator_consent: true }));
      }
      assert.equal((await command(event, admin, 'invite', { email: outsider.email })).status, 409);
      assert.equal((await command(event, players[0], 'invite', { email: outsider.email })).status, 403);
      const participant = await get(event, players[0]);
      assert.ok(participant.entries.every(e => !Object.hasOwn(e, 'email'))); assert.ok(!JSON.stringify(participant).includes('deck_snapshot'));
      assert.ok(participant.entries.filter(e => e.id !== participant.own_entry_id).every(e => !Object.hasOwn(e, 'deck_title')));
      const r = await request('/api/arena/tournaments/' + event.id, players[0]); assert.match(r.headers.get('cache-control'), /private.*no-store/); assert.match(r.headers.get('vary'), /Cookie/);
    });
    await t.test('registration snapshots survive later workshop edits; concurrent start retries never redraw', async () => {
      const p = players[0]; p.deck = ok(await request('/api/arena/decks/' + p.deck.id, p, 'PUT', { title: 'Later workshop edit', revision: p.deck.revision, request_id: randomUUID(), cards: [{ card_id: basic, quantity: 3 }, { card_id: energy, quantity: 57 }] }));
      const before = await get(), body = { type: 'start', confirm: true, revision: before.revision, request_id: randomUUID() };
      const results = await Promise.all([1, 2].map(() => request('/api/arena/tournaments/' + event.id + '/actions', admin, 'POST', body)));
      const [a, b] = results.map(ok); assert.deepEqual(a.nodes, b.nodes); assert.deepEqual(a.entries.map(e => e.seed), b.entries.map(e => e.seed));
      assert.equal(a.bracket_size, 4); assert.equal(a.nodes.length, 3); assert.equal(a.nodes.filter(n => n.status === 'bye').length, 1);
      assert.equal((await command(event, players[0], 'withdraw')).status, 409);
      const [snapshot] = await sql`SELECT deck_snapshot FROM arena_tournament_entries WHERE tournament_id=${event.id} AND user_id=${p.id}`;
      assert.equal(snapshot.deck_snapshot.title, 'Registered snapshot'); assert.equal(snapshot.deck_snapshot.cards[0].quantity, 4);
    });
    await t.test('one pairing creates one table under identical retries, and its seats cannot be changed', async () => {
      const current = await get(), node = current.nodes.find(n => n.status === 'ready' && n.round === 1), body = { type: 'open', node_id: node.id, revision: current.revision, request_id: randomUUID() };
      const [a, b] = (await Promise.all([1, 2].map(() => request('/api/arena/tournaments/' + event.id + '/actions', admin, 'POST', body)))).map(ok);
      assert.equal(a.opened_match_id, b.opened_match_id); game = { id: a.opened_match_id };
      const [row] = await sql`SELECT * FROM arena_matches WHERE id=${game.id}`; host = players.find(p => p.id === row.host_id); guest = players.find(p => p.id === row.guest_id);
      assert.equal(row.host_deck.title, 'Registered snapshot'); assert.equal(row.guest_deck.title, 'Registered snapshot');
      const outsidePair = players.slice(0, 3).find(p => p !== host && p !== guest);
      assert.equal((await command(event, outsidePair, 'open', { node_id: node.id })).status, 404);
      for (const [user, type] of [[host, 'cancel'], [host, 'invite'], [guest, 'leave']]) { const before = await view(user); assert.equal((await request('/api/arena/matches/' + game.id + '/actions', user, 'POST', { revision: before.revision, request_id: randomUUID(), action: { type } })).status, 409); }
    });
    await t.test('only administrators can spectate; the view reveals no setup cards, hands, deck order or choices', async () => {
      const path = '/api/arena/tournaments/' + event.id + '/spectate/' + game.id;
      for (const user of [host, guest, outsider, free]) assert.equal((await request(path, user)).status, 403);
      assert.equal(ok(await request(path, admin)).table, null);
      await move(host, { type: 'ready' }); await move(guest, { type: 'ready' }); await move(host, { type: 'start' });
      const current = await view(host), place = current.table.legal.find(m => m.action.type === 'setup' && m.action.zone === 'active'); await move(host, place.action);
      let watched = ok(await request(path, admin)); assert.deepEqual(watched.table.players[0].active, { hidden: true });
      const [stored] = await sql`SELECT state FROM arena_matches WHERE id=${game.id}`;
      const encoded = JSON.stringify(watched);
      for (const p of stored.state.players) for (const unit of [...p.deck, ...p.hand, ...p.prizes, ...(p.active ? [p.active] : [])]) assert.ok(!encoded.includes(unit.id));
      for (const key of ['host_deck', 'guest_deck', 'state', 'invite_hash', 'request_hash']) assert.ok(!Object.hasOwn(watched, key));
      assert.deepEqual(watched.table.legal, []); assert.equal(watched.table.prompt, null);
      await prepareTournamentOpening([host, guest], user => view(user), (user, action) => move(user, action));
      watched = ok(await request(path, admin)); assert.ok(watched.table.players.every(p => p.active?.card && p.hand.length === 0));
      await sql`UPDATE app_users SET role='user' WHERE id=${admin.id}`; assert.equal((await request(path, admin)).status, 403); await sql`UPDATE app_users SET role='admin' WHERE id=${admin.id}`;
      // Even an administrator with player entitlement gains no seat/action rights.
      await sql`INSERT INTO account_tier_overrides(user_id,tier,reason) VALUES(${admin.id},'collector','Spectator is not a player')`;
      assert.equal((await request('/api/arena/matches/' + game.id, admin)).status, 404);
      assert.equal((await request('/api/arena/matches/' + game.id + '/actions', admin, 'POST', { revision: watched.revision, request_id: randomUUID(), action: { type: 'concede' } })).status, 404);
    });
    await t.test('a verified finish advances once and the final declares the server’s winner', async () => {
      const before = await view(host), body = { revision: before.revision, request_id: randomUUID(), action: { type: 'concede' } };
      const replies = await Promise.all([1, 2].map(() => request('/api/arena/matches/' + game.id + '/actions', host, 'POST', body))); replies.forEach(ok);
      const current = await get(), first = current.nodes.find(n => n.match_id === game.id), winner = current.entries.find(e => e.id === first.winner_id);
      assert.equal(winner.alias, (await view(guest)).guest_alias); assert.equal(first.outcome, 'played'); assert.equal(current.nodes.find(n => n.round === 2).status, 'ready');
      const final = await prepare(event, current.nodes.find(n => n.round === 2)); await move(final.h, { type: 'concede' }, final.row.id);
      const finished = await get(); assert.equal(finished.status, 'completed'); assert.equal(finished.champion_id, finished.nodes.find(n => n.round === 2).right_id);
      assert.equal(finished.games.length, 2); assert.equal((await command(event, admin, 'start', { confirm: true })).status, 409);
      assert.equal(ok(await request('/api/arena/matches/' + game.id + '/actions', host, 'POST', body)).status, 'finished');
    });
    await t.test('draws require a new game with the same registered decks; old tables remain immutable', async () => {
      const e = await tournament(2); ok(await command(e, admin, 'start', { confirm: true })); const current = await get(e), prepared = await prepare(e, current.nodes[0]);
      // A rare engine draw is installed only in this disposable fixture. Exercise
      // the same transaction-bound recorder called by real match completion.
      await sql.begin(async tx => { const locked = await lockArenaTournament(tx, e.id); const [row] = await tx`SELECT * FROM arena_matches WHERE id=${prepared.row.id} FOR UPDATE`; row.state.phase = 'finished'; row.state.result = 'draw'; row.state.result_reason = 'Synthetic draw'; row.state.pending = null; row.state.queue = []; row.status = 'finished'; await tx`UPDATE arena_matches SET state=${tx.json(row.state)},status='finished',revision=revision+1 WHERE id=${row.id}`; await recordTournamentResult(tx, locked, row); });
      const drawn = await get(e); assert.equal(drawn.nodes[0].status, 'draw'); assert.equal(drawn.champion_id, null);
      const rematch = ok(await command(e, admin, 'open', { node_id: drawn.nodes[0].id })); assert.notEqual(rematch.opened_match_id, prepared.row.id); assert.equal(rematch.nodes[0].attempt, 2); assert.equal(rematch.games.length, 2);
      const rows = await sql`SELECT host_deck,guest_deck FROM arena_matches WHERE tournament_id=${e.id} ORDER BY created_at`; assert.deepEqual(rows[0], rows[1]);
      ok(await command(e, admin, 'cancel', { reason: 'Fixture complete' }));
    });
    await t.test('racing a forfeit against a game result resolves once; cancellation closes remaining tables', async () => {
      const e = await tournament(4); ok(await command(e, admin, 'start', { confirm: true })); const current = await get(e), prepared = await prepare(e, current.nodes.find(n => n.status === 'ready'));
      const before = await get(e), node = before.nodes.find(n => n.match_id === prepared.row.id), playerView = await view(prepared.h, prepared.row.id);
      const replies = await Promise.all([
        request('/api/arena/matches/' + prepared.row.id + '/actions', prepared.h, 'POST', { revision: playerView.revision, request_id: randomUUID(), action: { type: 'concede' } }),
        request('/api/arena/tournaments/' + e.id + '/actions', admin, 'POST', { type: 'forfeit', node_id: node.id, winner_id: node.left_id, reason: 'Confirmed organiser decision', revision: before.revision, request_id: randomUUID() })
      ]); assert.deepEqual(replies.map(r => r.status).sort(), [200, 409]);
      const resolved = await get(e), finishedNode = resolved.nodes.find(n => n.id === node.id), final = resolved.nodes.find(n => n.round === 2);
      assert.equal(finishedNode.status, 'completed'); assert.ok([final.left_id, final.right_id].includes(finishedNode.winner_id));
      const other = resolved.nodes.find(n => n.round === 1 && n.status === 'ready'); ok(await command(e, admin, 'forfeit', { node_id: other.id, winner_id: other.left_id, reason: 'Opponent did not attend' }));
      const pendingFinal = (await get(e)).nodes.find(n => n.round === 2); ok(await command(e, admin, 'open', { node_id: pendingFinal.id }));
      ok(await command(e, admin, 'cancel', { reason: 'Event ended by organiser' })); const cancelled = await get(e); assert.equal(cancelled.status, 'cancelled'); assert.ok(cancelled.games.every(g => !['ready', 'active'].includes(g.status)));
      assert.ok((await sql`SELECT action FROM audit_log WHERE action='arena.tournament.forfeit' AND detail->>'tournament_id'=${e.id}`).length >= 1);
    });
  } finally {
    if (events.length) await sql`DELETE FROM arena_tournaments WHERE id IN ${sql(events)}`;
    if (ids.length) await sql`DELETE FROM app_users WHERE id IN ${sql(ids)}`;
    await sql`DELETE FROM cards WHERE set_id=${set}`; await sql`DELETE FROM card_sets WHERE id=${set}`;
    await sql`DELETE FROM arena_settings`; if (old.length) await sql`INSERT INTO arena_settings ${sql(old)}`; await sql.end();
  }
});
