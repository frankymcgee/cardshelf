import { test, expect, json } from './arena-match-fixtures.mjs';
import { randomUUID } from 'node:crypto';
import { prepareTournamentOpening } from '../helpers/arena-tournament-setup.mjs';
const baseURL = process.env.TEST_BASE_URL, headers = { Origin: baseURL, 'X-Requested-With': 'cardshelf' };
async function client(browser, member) {
  const context = await browser.newContext({ baseURL, serviceWorkers: 'block', viewport: { width: 1440, height: 1000 } });
  await context.addCookies([{ name: 'cardshelf_session', value: member.token, url: baseURL, httpOnly: true, sameSite: 'Strict' }]); return context;
}
async function fixture(environment, browser) {
  const sql = environment.sql, suffix = randomUUID().replaceAll('-', ''), set = 'en:browser-event-' + suffix;
  const admin = await environment.account('admin', null), a = await environment.account(), b = await environment.account();
  const contexts = await Promise.all([admin, a, b].map(user => client(browser, user)));
  const [ac, one, two] = contexts, users = [a, b];
  await sql`INSERT INTO card_sets(id,provider_id,game,language,name,card_count) VALUES(${set},${set.slice(3)},'pokemon','en','Event browser set',2)`;
  const raw = [{ category: 'Pokemon', stage: 'Basic', hp: 100, types: ['Fire'], retreat: 1, attacks: [{ name: 'Tackle', damage: 30, cost: ['Colorless'] }] }, { category: 'Energy', energyType: 'Basic', effect: 'Basic Energy' }];
  for (let i = 0; i < 2; i++) await sql`INSERT INTO cards(id,provider_id,set_id,game,language,local_id,name,category,raw_data) VALUES(${set + '-' + i},${set.slice(3) + '-' + i},${set},'pokemon','en',${String(i)},${i ? 'Fire Energy' : 'Browser Tournament Basic'},${raw[i].category},${sql.json(raw[i])})`;
  const decks = [];
  for (const ctx of [one, two]) decks.push(await json(await ctx.request.post('/api/arena/decks', { headers, data: { title: 'Cup contender', revision: 0, request_id: randomUUID(), cards: [{ card_id: set + '-0', quantity: 4 }, { card_id: set + '-1', quantity: 56 }] } })));
  let eventId;
  async function command(context, type, values = {}) {
    const current = await json(await context.request.get('/api/arena/tournaments/' + eventId));
    return json(await context.request.post('/api/arena/tournaments/' + eventId + '/actions', { headers, data: { type, revision: current.revision, request_id: randomUUID(), ...values } }));
  }
  async function create() { const e = await json(await ac.request.post('/api/arena/tournaments', { headers, data: { title: 'Browser Arena Cup', description: 'A live test event', capacity: 2, request_id: randomUUID() } })); eventId = e.id; return e; }
  async function register() {
    for (let i = 0; i < 2; i++) { await command(ac, 'invite', { email: users[i].id + '@example.test' }); await command(contexts[i + 1], 'accept', { deck_id: decks[i].id, deck_revision: decks[i].revision, alias: i ? 'Tide player' : 'Ember player', spectator_consent: true }); }
  }
  async function cleanup() {
    if (eventId) await sql`DELETE FROM arena_tournaments WHERE id=${eventId}`;
    for (const ctx of contexts) await ctx.close();
    await sql`DELETE FROM cards WHERE set_id=${set}`; await sql`DELETE FROM card_sets WHERE id=${set}`;
  }
  return { admin, a, b, ac, one, two, contexts, users, decks, create, register, command, cleanup, setEvent: id => { eventId = id; }, id: () => eventId };
}

test('organiser invitations, member registration and random draw work in the built UI', async ({ environment, browser }, info) => {
  test.setTimeout(60_000); const f = await fixture(environment, browser);
  try {
    const adminPage = await f.ac.newPage(); const initial = adminPage.waitForResponse(r => new URL(r.url()).pathname === '/api/arena/tournaments');
    await adminPage.goto('/arena/tournaments'); await json(await initial);
    await adminPage.getByLabel('Event name', { exact: true }).fill('Browser Arena Cup'); await adminPage.getByLabel('Maximum entrants', { exact: true }).fill('2');
    const created = adminPage.waitForResponse(r => new URL(r.url()).pathname === '/api/arena/tournaments' && r.request().method() === 'POST'); await adminPage.getByRole('button', { name: 'Create tournament', exact: true }).click(); const event = await json(await created); f.setEvent(event.id); await adminPage.waitForURL('**/arena/tournaments/' + event.id);
    for (const user of f.users) { await adminPage.getByLabel('Member email', { exact: true }).fill(user.id + '@example.test'); const reply = adminPage.waitForResponse(r => r.url().endsWith('/actions') && r.request().method() === 'POST'); await adminPage.getByRole('button', { name: 'Invite member', exact: true }).click(); await json(await reply); await expect(adminPage.getByLabel('Member email', { exact: true })).toHaveValue(''); }
    const entrant = await f.one.newPage(); const loaded = entrant.waitForResponse(r => new URL(r.url()).pathname === '/api/arena/tournaments/' + event.id); await entrant.goto('/arena/tournaments/' + event.id); await json(await loaded);
    await entrant.getByLabel('Player alias', { exact: true }).fill('Ember player'); await entrant.getByRole('combobox', { name: 'Registered deck', exact: true }).selectOption(f.decks[0].id);
    await entrant.getByRole('checkbox').check(); const accepted = entrant.waitForResponse(r => r.url().endsWith('/actions') && r.request().method() === 'POST'); await entrant.getByRole('button', { name: 'Accept invitation', exact: true }).click(); await json(await accepted); await expect(entrant.getByRole('heading', { name: 'Your registration', exact: true })).toBeVisible();
    await f.command(f.two, 'accept', { deck_id: f.decks[1].id, deck_revision: 1, alias: 'Tide player', spectator_consent: true });
    const refreshed = adminPage.waitForResponse(r => new URL(r.url()).pathname === '/api/arena/tournaments/' + event.id); await adminPage.reload(); await json(await refreshed); await expect(adminPage.getByText('2 accepted · 2 places', { exact: true })).toBeVisible();
    adminPage.once('dialog', d => d.accept()); const drawn = adminPage.waitForResponse(r => r.url().endsWith('/actions') && r.request().method() === 'POST'); await adminPage.getByRole('button', { name: 'Draw bracket & start', exact: true }).click(); const bracket = await json(await drawn); expect(bracket.nodes).toHaveLength(1); expect(bracket.nodes[0].left_id).not.toBe(bracket.nodes[0].right_id);
    await expect(adminPage.getByRole('heading', { name: 'Final', exact: true })).toBeVisible();
    await adminPage.setViewportSize({ width: 390, height: 844 }); await expect.poll(() => adminPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await adminPage.screenshot({ path: info.outputPath('tournament-bracket-mobile.png'), fullPage: true });
  } finally { await f.cleanup(); }
});

test('commentary is read-only, mobile-friendly and removed after administrator revocation', async ({ environment, browser }, info) => {
  test.setTimeout(60_000); const f = await fixture(environment, browser);
  try {
    await f.create(); await f.register(); const drawn = await f.command(f.ac, 'start', { confirm: true }); const opened = await f.command(f.ac, 'open', { node_id: drawn.nodes[0].id }); const id = opened.opened_match_id;
    const [stored] = await environment.sql`SELECT host_id FROM arena_matches WHERE id=${id}`;
    const [host, guest] = stored.host_id === f.a.id ? [f.one, f.two] : [f.two, f.one];
    const view = context => context.request.get('/api/arena/matches/' + id).then(json);
    async function move(context, action) { const before = await view(context); return json(await context.request.post('/api/arena/matches/' + id + '/actions', { headers, data: { revision: before.revision, request_id: randomUUID(), action } })); }
    await move(host, { type: 'ready' }); await move(guest, { type: 'ready' }); await move(host, { type: 'start' });
    await prepareTournamentOpening([host, guest], view, move);
    const page = await f.ac.newPage(), writes = []; page.on('request', r => { if (new URL(r.url()).pathname.startsWith('/api/') && r.method() !== 'GET') writes.push(r.url()); });
    const response = page.waitForResponse(r => r.url().includes('/spectate/' + id)); await page.goto('/arena/tournaments/' + f.id() + '/watch/' + id); const spectator = await json(await response);
    expect(spectator.table.players.every(p => p.hand.length === 0)).toBe(true); expect(spectator.table.prompt).toBeNull(); expect(spectator.table.legal).toEqual([]);
    await expect(page.getByRole('region', { name: 'Tournament scoreboard' })).toBeVisible(); await expect(page.getByRole('button', { name: 'Concede', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Stream view', exact: true }).click(); await expect(page.getByRole('navigation', { name: 'Arena navigation' })).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 844 }); await page.locator('[data-arena-drop^="card:"] .arena-card').first().click(); const modal = page.getByRole('dialog', { name: 'Public card details', exact: true }); await expect(modal).toBeVisible(); await page.keyboard.press('Escape'); await expect(modal).not.toBeVisible();
    await page.getByRole('button', { name: 'Match history', exact: true }).click(); await expect(page.getByRole('dialog', { name: 'Public match history', exact: true })).toBeVisible(); await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 320, height: 740 }); await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); expect(writes).toEqual([]);
    const instruction = page.getByText('Inspect any revealed card for commentary.', { exact: true });
    await expect(instruction).toBeVisible();
    const textBox = await instruction.evaluate(element => ({ width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height, line: parseFloat(getComputedStyle(element).lineHeight) }));
    expect(textBox.width).toBeGreaterThanOrEqual(160); expect(textBox.height).toBeLessThanOrEqual(textBox.line * 2 + 1);
    await page.screenshot({ path: info.outputPath('commentary-mobile.png'), fullPage: true });
    await environment.sql`UPDATE app_users SET role='user' WHERE id=${f.admin.id}`; await expect(page.getByRole('alert')).toContainText('Administrator access is required'); await expect(page.locator('.at-scoreboard')).toHaveCount(0); await expect(page.locator('.arena-board')).toHaveCount(0);
  } finally { await f.cleanup(); }
});
