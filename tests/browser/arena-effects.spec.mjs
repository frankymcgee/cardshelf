import { test, expect } from './arena-fixtures.mjs';
const failures = new WeakMap();
test.beforeEach(async ({ page }) => { const errors = []; failures.set(page, errors); page.on('pageerror', error => errors.push(error.message)); });
test.afterEach(async ({ page }) => { expect(failures.get(page)).toEqual([]); });
const start = async (page, query = '') => { await page.goto('/' + query); await expect(page.getByRole('button', { name: 'Battle effects: On' })).toBeVisible(); await page.waitForFunction(() => !!window.effectsFixture); };
const advance = (page, kind) => page.evaluate(kind => window.effectsFixture.advance(kind), kind);
const noActions = async page => expect(await page.evaluate(() => window.effectsFixture.actions)).toEqual([]);
for (const seat of [0, 1]) for (const legacy of [false, true]) test(`seat ${seat}, ${legacy ? 'Core' : 'Expanded'}: confirmed play travels without replaying initial state or submitting actions`, async ({ page }) => {
  await start(page, '?' + (seat ? 'seat1&' : '') + (legacy ? 'legacy' : ''));
  await expect(page.locator('.arena-motion-layer')).toHaveCount(0);
  await advance(page, 'play');
  await expect(page.locator('[data-flight-kind="card"]')).toHaveCount(1);
  await expect(page.locator('[data-side="self"] .arena-bench-spot .arena-card')).toHaveCount(2);
  await expect(page.locator('.arena-motion-layer')).toHaveAttribute('aria-hidden', 'true');
  await expect(page.locator('.arena-motion-layer')).toHaveAttribute('inert', '');
  expect(await page.locator('.arena-motion-layer').evaluate(node => getComputedStyle(node).pointerEvents)).toBe('none');
  await noActions(page);
  await expect(page.locator('.arena-effect-flight')).toHaveCount(0);
  await page.evaluate(() => window.effectsFixture.poll());
  await expect(page.locator('.arena-motion-layer')).toHaveCount(0);
});
test('server attack amount and impact are visible while real cards remain selectable', async ({ page }, info) => {
  await start(page); await advance(page, 'attack');
  await expect(page.locator('[data-impact="attack"]')).toHaveText('30 damage');
  await expect(page.getByRole('status', { name: 'Battle activity' })).toContainText('Training Strike · 30 damage');
  await page.locator('[data-side="self"] .arena-active-spot .arena-card').click();
  expect(await page.evaluate(() => window.effectsFixture.selections.at(-1))).toBe('Active-0');
  await noActions(page);
  await page.screenshot({ path: info.outputPath('phase4-attack-desktop.png'), fullPage: true });
});

test('a confirmed attack has a disclosed card lunge, a type-coloured burst and the exact damage number', async ({ page }, info) => {
  await start(page); await advance(page, 'attack');
  await expect(page.locator('.arena-effect-strike')).toHaveCount(1);
  await expect(page.locator('[data-burst="attack"]')).toHaveCount(1);
  await expect(page.locator('.arena-impact-amount')).toHaveText('30');
  await expect(page.locator('.arena-effect-strike .arena-card')).toHaveAttribute('disabled', '');
  expect(await page.locator('.arena-effect-strike').getAttribute('data-tone')).toBe(await page.evaluate(() => window.effectsFixture.state.table.players[window.effectsFixture.state.table.seat].active.card.type.toLowerCase()));
  // Hold the CSS pose for a useful screenshot; effect expiry still follows the real bounded timer.
  await page.locator('.arena-motion-layer').evaluate(layer => {
    for (const animation of layer.getAnimations({ subtree: true })) { animation.pause(); animation.currentTime = 300; }
  });
  await page.screenshot({ path: info.outputPath('cardshelf-attack-animation.png'), fullPage: true });
  await expect(page.locator('.arena-effect-strike')).toHaveCount(0); await noActions(page);
});

test('hover and card selection lift the hand card and create feedback without playing it', async ({ page }) => {
  await start(page);
  const card = page.locator('[data-hand-id="Hand-0"]'), initial = await card.boundingBox();
  await card.hover();
  await expect.poll(async () => (await card.boundingBox()).y).toBeLessThan(initial.y - 8);
  await card.click();
  await expect(card).toHaveAttribute('aria-pressed', 'true');
  await expect(card.locator('.arena-card-selection-wave')).toHaveCSS('animation-name', 'arena-selection-wave');
  expect(await page.evaluate(() => window.effectsFixture.selections.at(-1))).toBe('Hand-0');
  await noActions(page);
});

test('opponent plays and evolution pulse only at the new disclosed field card', async ({ page }) => {
  await start(page); await advance(page, 'opponent-play');
  await expect(page.locator('[data-burst="arrival"]')).toHaveCount(1);
  await expect(page.locator('.arena-effect-flight')).toHaveCount(0);
  await expect(page.locator('[data-side="opponent"] .arena-bench-spot .arena-card')).toHaveCount(2);
  await advance(page, 'evolve');
  await expect(page.locator('[data-burst="evolve"]')).toHaveCount(1);
  await expect(page.locator('[data-cue="evolve"]')).toContainText('Pokémon evolved'); await noActions(page);
});

test('manual reduced motion disables selection travel and combat decoration but keeps exact text feedback', async ({ page }) => {
  await start(page); await page.getByRole('button', { name: 'Motion: Full', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Motion: Reduced', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const card = page.locator('[data-hand-id="Hand-0"]'); await card.click();
  await expect(card).toHaveCSS('transform', 'none');
  await expect(card.locator('.arena-card-selection-wave')).toBeHidden();
  // Bring the controls into view, then acknowledge a fresh baseline after the scroll interruption.
  await page.getByRole('button', { name: 'Motion: Reduced', exact: true }).scrollIntoViewIfNeeded();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.evaluate(() => window.effectsFixture.poll()); await advance(page, 'attack');
  await expect(page.locator('.arena-motion-layer')).toHaveCount(0);
  await expect(page.locator('[data-cue="attack"]')).toContainText('30 damage');
  await page.getByRole('button', { name: 'Motion: Reduced', exact: true }).click();
  await expect(page.locator('.arena-motion-layer')).toHaveCount(0); await noActions(page);
});
test('duplicate event polling never repeats an attack or a coin', async ({ page }) => {
  await start(page); await advance(page, 'coin');
  await expect(page.locator('[data-impact="coin"]')).toHaveText('HEADS');
  await expect(page.locator('.arena-motion-layer')).toHaveCount(0);
  await page.evaluate(() => { window.effectsFixture.poll(); window.effectsFixture.state.revision++; });
  await expect(page.locator('.arena-motion-layer')).toHaveCount(0);
  await expect(page.getByRole('status', { name: 'Battle activity' })).toBeEmpty();
});
test('Energy and swaps follow disclosed IDs, not selected-card guesses', async ({ page }) => {
  await start(page); await advance(page, 'attach');
  await expect(page.locator('[data-flight-kind="card"]')).toHaveCount(1);
  await expect(page.locator('.arena-effect-flight')).toContainText('Training Energy');
  await expect(page.locator('.arena-effect-flight')).toHaveCount(0);
  await advance(page, 'swap'); await expect(page.locator('[data-flight-kind="card"]')).toHaveCount(2);
  await noActions(page);
});
test('private draws and Prizes use backs without new private card faces in the effect layer', async ({ page }) => {
  await start(page); await advance(page, 'draw');
  await expect(page.locator('[data-flight-kind="back"]')).toHaveCount(1);
  await expect(page.locator('.arena-motion-layer')).not.toContainText('NEW-PRIVATE');
  await expect(page.locator('.arena-motion-layer img')).toHaveCount(0);
  await expect(page.locator('.arena-effect-flight')).toHaveCount(0);
  await advance(page, 'prize'); await expect(page.locator('[data-flight-kind="back"]')).toHaveCount(1);
  await expect(page.locator('.arena-motion-layer')).not.toContainText('NEW-PRIVATE'); await noActions(page);
});
test('turn and Stadium changes show confirmed cues without duplicating the old flash overlay', async ({ page }) => {
  await start(page); await advance(page, 'stadium');
  await expect(page.locator('[data-cue="stadium"]')).toHaveText('New Stadium in play');
  await expect(page.locator('[data-impact="stadium"]')).toBeVisible();
  await advance(page, 'turn'); await expect(page.locator('[data-cue="turn"]')).toContainText('Opponent turn · Turn 4');
  await expect(page.locator('.arena-event-flash')).toHaveCount(0); await noActions(page);
});
test('conditions, healing, Knock Outs and results do not attach old damage to replacement cards', async ({ page }) => {
  await start(page); await advance(page, 'status');
  await expect(page.locator('[data-impact="status"]')).toContainText('Poisoned · Asleep');
  await advance(page, 'heal'); await expect(page.locator('[data-impact="heal"]')).toHaveText('Damage removed');
  await advance(page, 'knockout'); await expect(page.locator('[data-cue="knockout"]')).toContainText('Active-1 knocked out');
  await expect(page.locator('[data-impact="attack"]')).toHaveCount(0);
  await advance(page, 'result'); await expect(page.locator('[data-cue="result"]')).toHaveText('Victory'); await noActions(page);
});
test('OS reduced motion uses textual feedback only, including a preference change during effects', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await start(page); await advance(page, 'attack');
  await expect(page.locator('.arena-motion-layer')).toHaveCount(0);
  await expect(page.locator('[data-cue="attack"]')).toContainText('30 damage');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(page.locator('.arena-effects-preference')).toHaveCount(0);
  await advance(page, 'coin');
  await expect(page.locator('[data-impact="coin"]')).toBeVisible();
  await page.emulateMedia({ reducedMotion: 'reduce' }); await expect(page.locator('.arena-motion-layer')).toHaveCount(0);
});
test('effects toggle stops decoration and does not replay events when reenabled', async ({ page }) => {
  await start(page); await advance(page, 'attack'); await page.getByRole('button', { name: 'Battle effects: On' }).click();
  await expect(page.locator('.arena-motion-layer')).toHaveCount(0);
  await advance(page, 'coin'); await expect(page.getByRole('status', { name: 'Battle activity' })).toBeEmpty();
  await page.getByRole('button', { name: 'Battle effects: Off' }).click();
  await expect(page.locator('.arena-motion-layer')).toHaveCount(0); await noActions(page);
});
test('reconnection, scroll and replacement snapshots cancel old effects without a backlog', async ({ page }) => {
  await start(page); await advance(page, 'attack');
  await page.evaluate(() => { window.effectsFixture.state.available = false; });
  await expect(page.locator('.arena-motion-layer')).toHaveCount(0); await advance(page, 'coin');
  await page.evaluate(() => { window.effectsFixture.state.available = true; });
  await expect(page.locator('.arena-motion-layer')).toHaveCount(0);
  await advance(page, 'attack'); await expect(page.locator('[data-impact="attack"]')).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event('scroll'))); await expect(page.locator('.arena-motion-layer')).toHaveCount(0);
  await advance(page, 'burst'); await expect(page.locator('.arena-motion-layer')).toHaveCount(0); await noActions(page);
});
test('unmount clears timers and listeners; remount does not replay history', async ({ page }) => {
  await start(page); await advance(page, 'coin');
  await page.evaluate(() => { window.effectsFixture.state.show = false; });
  await expect(page.locator('.arena-motion-layer')).toHaveCount(0);
  await advance(page, 'attack');
  await page.evaluate(() => { window.effectsFixture.state.show = true; });
  await expect(page.locator('.arena-motion-layer')).toHaveCount(0); await noActions(page);
});
test('large bursts are summarized rather than queued', async ({ page }) => {
  await start(page); await advance(page, 'burst');
  await expect(page.getByRole('status', { name: 'Battle activity' })).toContainText('see History');
  await expect(page.locator('.arena-motion-layer')).toHaveCount(0);
});
test.describe('mobile effects', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });
  test('narrow touch viewport keeps controls accessible and adds no horizontal overflow', async ({ page }, info) => {
    await start(page);
    await page.locator('.arena-table-centre').scrollIntoViewIfNeeded();
    // Scrolling may dispatch its event on the next rendering frame. Establish
    // the acknowledged baseline only after the browser has processed that input.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.evaluate(() => window.effectsFixture.poll());
    await advance(page, 'coin');
    await expect(page.locator('[data-impact="coin"]')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: info.outputPath('phase4-coin-mobile.png'), fullPage: false });
    await expect(page.locator('.arena-motion-layer')).toHaveCount(0);
    await page.getByRole('button', { name: 'Battle effects: On' }).tap();
    await expect(page.getByRole('button', { name: 'Battle effects: Off' })).toHaveAttribute('aria-pressed', 'false');
    await noActions(page);
  });
});
