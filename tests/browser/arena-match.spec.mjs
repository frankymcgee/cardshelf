import { test, expect, action, json } from './arena-match-fixtures.mjs';
const status = page => page.getByRole('region', { name: 'Match status' });
const endButton = page => page.locator('.arena-turn-actions').getByRole('button', { name: /end turn/i });
const review = page => page.getByRole('dialog', { name: 'End your turn?', exact: true });
const writes = (page, game) => {
  const bodies = []; page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/matches/' + game.id + '/actions')) bodies.push(request.postDataJSON()); }); return bodies;
};
async function tools(page) { const menu = page.locator('.arena-table-tools'); if (!await menu.evaluate(el => el.open)) await menu.locator('summary').click(); }

test('signed-in focused table retains status, controls and inspection without writes', async ({ page, game }, info) => {
  const sent = writes(page, game);
  await page.getByRole('button', { name: 'Focus table', exact: true }).click();
  await expect(page.locator('.arena-header')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Exit focus', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(status(page)).toContainText('Your Prizes left'); await expect(endButton(page)).toBeVisible();
  await tools(page); await page.getByRole('button', { name: 'How to play', exact: true }).click();
  const help = page.getByRole('dialog', { name: 'How to play', exact: true }); await expect(help).toBeVisible();
  await page.keyboard.press('Escape'); await expect(help).not.toBeVisible();
  await page.locator('.arena-table-tools > summary').click();
  await page.screenshot({ path: info.outputPath('phase5-focus-desktop.png'), fullPage: true });
  await page.getByRole('button', { name: 'Exit focus', exact: true }).click(); await expect(page.locator('.arena-header')).toBeVisible();
  expect(sent).toEqual([]);
});

test('manual End turn reviews first and sends the exact action once after confirmation', async ({ page, game }) => {
  const sent = writes(page, game);
  await endButton(page).click(); await expect(review(page)).toBeVisible(); expect(sent).toEqual([]);
  await review(page).getByRole('button', { name: 'Keep playing' }).click(); await expect(review(page)).not.toBeVisible();
  await expect(endButton(page)).toBeFocused(); expect(sent).toEqual([]);
  await endButton(page).click();
  const reply = page.waitForResponse(r => r.url().endsWith('/matches/' + game.id + '/actions') && r.request().method() === 'POST');
  await review(page).getByRole('button', { name: 'Confirm end turn' }).click();
  expect((await reply).ok()).toBeTruthy(); await expect(review(page)).not.toBeVisible();
  expect(sent[0].action).toEqual({ type: 'end_turn' }); expect(sent[0].revision).toBe(game.revision);
  expect(sent.filter(body => body.action.type === 'end_turn')).toHaveLength(1);
});

test('a real server revision from another client expires an open end-turn review', async ({ page, context, game }) => {
  const sent = writes(page, game); await endButton(page).click(); await expect(review(page)).toBeVisible();
  await action(context.request, game, { type: 'end_turn' });
  await expect(review(page)).not.toBeVisible(); expect(sent.filter(body => body.action.type === 'end_turn')).toHaveLength(0);
});

test('lost acknowledged reply preserves and retries the identical request rather than playing twice', async ({ page, game }) => {
  const sent = writes(page, game); let intercepted = 0;
  await page.route('**/api/arena/matches/' + game.id + '/actions', async route => {
    if (++intercepted === 1) { const response = await route.fetch(); expect(response.ok()).toBeTruthy(); await route.abort('failed'); }
    else await route.continue();
  });
  await endButton(page).click(); await review(page).getByRole('button', { name: 'Confirm end turn' }).click();
  await expect(page.getByRole('button', { name: 'Retry same action' })).toBeVisible();
  await expect(status(page)).toContainText('Action result uncertain'); await expect(endButton(page)).toBeDisabled();
  const reply = page.waitForResponse(r => r.url().endsWith('/matches/' + game.id + '/actions') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Retry same action' }).click(); expect((await reply).ok()).toBeTruthy();
  await expect(page.getByRole('button', { name: 'Retry same action' })).toHaveCount(0);
  expect(sent[1]).toEqual(sent[0]);
  await expect.poll(() => page.evaluate(() => Object.keys(sessionStorage).filter(key => key.startsWith('cardshelf-arena-action:')).length)).toBe(0);
});

test('history is searchable in a scrollable dialog and does not make game writes', async ({ page, game }) => {
  const sent = writes(page, game); await tools(page); await page.getByRole('button', { name: 'History', exact: true }).click();
  const history = page.getByRole('dialog', { name: 'Match history', exact: true }); await expect(history).toBeVisible();
  await expect(history.locator('.arena-history-actor').first()).toBeVisible();
  await history.getByLabel('Search history').fill('A string absent from training events'); await expect(history.getByText('No events match these filters.')).toBeVisible();
  await history.getByLabel('Search history').fill(''); await history.getByLabel('Show events').selectOption('mine');
  await expect(history.locator('.arena-history-actor').first()).toContainText('Browser player');
  await page.keyboard.press('Escape'); await expect(history).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'History', exact: true })).toBeFocused(); expect(sent).toEqual([]);
});

test('session revocation removes the real table and any open history on the next read', async ({ page, environment, member }) => {
  await tools(page); await page.getByRole('button', { name: 'History', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Match history', exact: true })).toBeVisible();
  await environment.sql`DELETE FROM sessions WHERE user_id=${member.id}`;
  await expect(page.locator('.arena-history-view')).toHaveCount(0);
  await expect(page.locator('.arena-board-wrap')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Membership', exact: true })).toBeVisible();
});

test.describe('complete training game', () => {
  test.use({ controlledClock: true });
test('actual auto-play control reaches a server-declared training result in a bounded game', async ({ page, game }) => {
  test.setTimeout(120_000); // A complete game, not an increased budget for an individual UI assertion.
  await page.clock.pauseAt(new Date());
  await page.getByLabel('Auto play my turns', { exact: true }).check();
  let result = game;
  for (let n = 0; n < 100 && result.status !== 'finished'; n++) {
    const reply = page.waitForResponse(r => r.url().endsWith('/matches/' + game.id + '/actions') && r.request().method() === 'POST');
    await page.clock.runFor(2050); result = await json(await reply);
    // Flush the acknowledged render without advancing another 2-second turn timer.
    await page.clock.runFor(20);
  }
  expect(result.status).toBe('finished'); expect(result.table.players[1].hand).toEqual([]);
  await expect(page.locator('.arena-result')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Play again', exact: true })).toBeVisible();
  await expect(page.getByLabel('Auto play my turns', { exact: true })).toHaveCount(0);
  await expect(endButton(page)).toHaveCount(0);
});

});

test.describe('narrow signed-in match', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  test('focus, end-turn review and history keep accessible controls within the viewport', async ({ page, game }, info) => {
    const sent = writes(page, game); await page.getByRole('button', { name: 'Focus table', exact: true }).tap();
    await endButton(page).tap(); await expect(review(page)).toBeVisible();
    const button = review(page).getByRole('button', { name: 'Keep playing' });
    const box = await button.boundingBox(); expect(box.y).toBeGreaterThanOrEqual(0); expect(box.y + box.height).toBeLessThanOrEqual(844); expect(box.height).toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: info.outputPath('phase5-end-turn-mobile.png') });
    await button.tap(); await tools(page); await page.getByRole('button', { name: 'History', exact: true }).tap();
    const history = page.getByRole('dialog', { name: 'Match history', exact: true }); await expect(history).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await history.getByRole('button', { name: 'Close', exact: true }).tap(); expect(sent).toEqual([]);
  });
});
