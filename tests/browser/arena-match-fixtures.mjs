// Real authentication, HTTP handlers, engine and PostgreSQL. Never use a live database/site.
import { test as base, expect, request } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { hashPassword, randomToken, digest } from '../../lib/security.mjs';
const baseURL = process.env.TEST_BASE_URL, databaseURL = process.env.DATABASE_URL;
const local = value => ['127.0.0.1', 'localhost'].includes(new URL(value).hostname);
if (process.env.ALLOW_TEST_DATABASE !== 'yes' || process.env.ARENA_BROWSER_TEST !== 'yes'
  || !baseURL || !databaseURL || !local(baseURL) || !local(databaseURL)
  || !new URL(databaseURL).pathname.endsWith('_test') || process.env.APP_ORIGIN !== baseURL) {
  throw Error('Refusing Arena browser fixtures without matching local origins and an explicitly disposable _test database.');
}
const headers = { Origin: baseURL, 'X-Requested-With': 'cardshelf' };
export async function json(response) {
  expect(response.ok(), await response.text()).toBeTruthy(); return response.json();
}
export async function action(client, view, value) {
  return json(await client.post('/api/arena/matches/' + view.id + '/actions', { headers,
    data: { revision: view.revision, request_id: randomUUID(), action: value } }));
}
export const test = base.extend({
  controlledClock: [false, { option: true }],
  environment: [async ({}, use) => {
    const sql = postgres(databaseURL, { max: 4 }), ids = [], password = 'Disposable Arena browser password 123';
    const passwordHash = await hashPassword(password), old = await sql`SELECT * FROM arena_settings`;
    async function account(role = 'user', tier = 'complimentary') {
      const id = randomUUID(), token = randomToken(); ids.push(id);
      await sql`INSERT INTO app_users(id,name,email,password_hash,role) VALUES(${id},'Browser player',${id + '@example.test'},${passwordHash},${role})`;
      await sql`INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(${digest(token)},${id},now()+interval '1 hour')`;
      if (tier) await sql`INSERT INTO account_tier_overrides(user_id,tier,reason) VALUES(${id},${tier},'Disposable browser fixture')`;
      return { id, token };
    }
    let adminClient;
    try {
      const admin = await account('admin', null);
      adminClient = await request.newContext({ baseURL, extraHTTPHeaders: { ...headers, Cookie: 'cardshelf_session=' + admin.token } });
      const settings = await json(await adminClient.get('/api/admin/arena'));
      await json(await adminClient.post('/api/admin/arena/settings', { data: { enabled: true, revision: settings.revision,
        password, reason: 'Original training cards in disposable browser fixture', confirm_rules: true, confirm_rights: true } }));
      await use({ sql, account });
    } finally {
      await adminClient?.dispose();
      await sql`DELETE FROM arena_settings`; if (old.length) await sql`INSERT INTO arena_settings ${sql(old)}`;
      if (ids.length) await sql`DELETE FROM app_users WHERE id IN ${sql(ids)}`;
      await sql.end();
    }
  }, { scope: 'worker', timeout: 60_000 }],
  member: async ({ environment }, use) => { await use(await environment.account()); },
  context: async ({ context, member }, use) => {
    await context.addCookies([{ name: 'cardshelf_session', value: member.token, url: baseURL, httpOnly: true, sameSite: 'Strict' }]);
    await use(context);
  },
  game: async ({ context }, use) => {
    let view = await json(await context.request.post('/api/arena/matches', { headers,
      data: { mode: 'tutorial', training: true, alias: 'Browser player', difficulty: 'easy', request_id: randomUUID() } }));
    for (let i = 0; i < 30; i++) {
      if (view.table.phase === 'playing' && view.table.turn === view.seat && !view.table.prompt
        && view.table.waiting_for == null && view.table.legal.some(move => move.action?.type === 'end_turn')) break;
      view = await action(context.request, view, { type: 'autoplay' });
    }
    expect(view.status).toBe('active'); expect(view.table.phase).toBe('playing');
    expect(view.table.turn).toBe(view.seat); expect(view.table.prompt).toBeNull();
    await use(view);
  },
  page: [async ({ context, game, controlledClock }, use) => {
    const page = await context.newPage(), external = [];
    await page.route('**/*', async route => {
      const url = route.request().url();
      if (new URL(url).origin !== new URL(baseURL).origin) { external.push(url); await route.abort(); } else await route.continue();
    });
    // Start well before the test's fixed pause time. Sampling wall time again
    // after navigation races the running browser clock, especially in WebKit.
    if (controlledClock) await page.clock.install({ time: new Date('2026-01-01T08:00:00Z') });
    // Separate initial network/bootstrap readiness from the unchanged 5-second UI assertions.
    // Register before navigation so a fast first response cannot be missed.
    const initialResponse = page.waitForResponse(response =>
      new URL(response.url()).pathname === '/api/arena/matches/' + game.id
      && response.request().method() === 'GET', { timeout: 30_000 });
    const [, response] = await Promise.all([page.goto('/arena/matches/' + game.id), initialResponse]);
    const firstView = await json(response);
    expect(firstView.id).toBe(game.id); expect(firstView.revision).toBeGreaterThanOrEqual(game.revision);
    await expect(page.locator('.arena-connection')).toContainText('Connected');
    await expect(page.getByRole('region', { name: 'Match status' })).toContainText('Your move');
    await use(page);
    expect(external, 'No catalogue, advertising or external media requests in a training match').toEqual([]);
    await page.close();
  }, { timeout: 60_000 }]
});
export { expect };
