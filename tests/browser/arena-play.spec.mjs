import { test, expect } from './arena-fixtures.mjs';
async function prepare(page, seat = 0, { legacy = false, kind = 'bench' } = {}) {
  await page.goto('/?seat=' + seat + (legacy ? '&legacy' : ''));
  await page.waitForFunction(() => !!window.arenaFixture);
  await page.evaluate(({ seat, legacy, kind }) => {
    const f = window.arenaFixture, t = f.props.table, own = t.players[seat];
    t.version = legacy ? 'pokemon-core-v1' : 'pokemon-expanded-v2';
    own.bench = own.bench.slice(0, 1);
    const unit = own.hand[0];
    if (kind === 'stadium') unit.card.program = { kind: 'stadium' };
    if (kind === 'energy') unit.card = { id: 'training:grass-energy', name: 'Training Grass Energy', kind: 'energy', type: 'Grass', basic_energy: true };
    const action = kind === 'bench' ? { type: 'bench', card: unit.id }
      : kind === 'energy' ? { type: 'energy', card: unit.id, target: own.active.id }
      : { type: 'trainer', card: unit.id };
    t.legal = [{ card: unit.id, label: 'Test ' + kind + ' play', action }];
    f.props.selected = '';
  }, { seat, legacy, kind });
  await expect(page.locator('.is-arena-playable')).toHaveCount(1);
}
const actions = page => page.evaluate(() => window.arenaFixture.events.filter(event => event[0] === 'action'));
async function drag(page, target) {
  const source = page.locator('[data-hand-index="0"]');
  await source.scrollIntoViewIfNeeded(); await source.hover();
  const box = await source.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 12, box.y + box.height / 2, { steps: 3 });
  await expect(page.locator('.arena-drag-ghost')).toBeVisible();
  const destination = await target.boundingBox();
  await page.mouse.move(destination.x + destination.width / 2, destination.y + destination.height / 2, { steps: 8 });
  await page.mouse.up();
}
for (const seat of [0, 1]) for (const legacy of [false, true]) test(`seat ${seat}, ${legacy ? 'Core' : 'Expanded'}: drag to Bench reviews without playing, then confirms once`, async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1600 }); await prepare(page, seat, { legacy });
  const before = await page.evaluate(() => JSON.stringify(window.arenaFixture.props.table));
  await drag(page, page.locator(`[data-arena-drop="zone:${seat}:bench"]`));
  const review = page.getByRole('dialog', { name: 'Confirm card play' }); await expect(review).toBeVisible();
  expect(await actions(page)).toEqual([]);
  expect(await page.evaluate(() => JSON.stringify(window.arenaFixture.props.table))).toBe(before);
  await review.getByRole('button', { name: /Confirm: Test bench play/ }).click();
  expect(await actions(page)).toEqual([['action', { type: 'bench', card: 'Hand-0' }]]);
  await expect(review).not.toBeVisible();
});
test('Energy highlights only the eligible public target and preserves its exact action', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1600 }); await prepare(page, 0, { kind: 'energy' });
  await page.locator('[data-hand-index="0"]').click();
  await expect(page.locator('[data-arena-drop="card:Active-0"]')).toHaveClass(/is-arena-target/);
  await expect(page.locator('[data-arena-drop="card:Active-1"]')).not.toHaveClass(/is-arena-target/);
  await drag(page, page.locator('[data-arena-drop="card:Active-0"]'));
  const review = page.getByRole('dialog', { name: 'Confirm card play' }); await expect(review).toBeVisible();
  expect(await actions(page)).toEqual([]); await review.getByRole('button', { name: /Confirm:/ }).click();
  expect(await actions(page)).toEqual([['action', { type: 'energy', card: 'Hand-0', target: 'Active-0' }]]);
});
for (const kind of ['trainer', 'stadium']) test(`${kind}: non-drag target selection and Escape preserve all cards`, async ({ page }) => {
  await prepare(page, 0, { kind }); await page.locator('[data-hand-index="0"]').click();
  await expect(page.locator(`[data-arena-drop="${kind}"]`)).toHaveClass(/is-arena-target/);
  await page.getByRole('button', { name: 'Choose target', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Confirm card play' })).toBeVisible();
  await page.keyboard.press('Escape'); expect(await actions(page)).toEqual([]);
  await expect(page.getByRole('button', { name: 'Choose target', exact: true })).toBeFocused();
});
test('invalid destination, cancelled drag and stale review never submit actions', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1600 }); await prepare(page);
  await drag(page, page.locator('[data-arena-drop="zone:1:bench"]'));
  await expect(page.getByRole('dialog', { name: 'Confirm card play' })).not.toBeVisible(); expect(await actions(page)).toEqual([]);
  await page.getByRole('button', { name: 'Choose target', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Confirm card play' })).toBeVisible();
  await page.evaluate(() => { window.arenaFixture.props.table.legal = []; });
  await expect(page.getByRole('dialog', { name: 'Confirm card play' })).not.toBeVisible();
  await expect(page.locator('.is-arena-playable')).toHaveCount(0); expect(await actions(page)).toEqual([]);
});
test('identical polling retains review; a lock removes it and every target', async ({ page }) => {
  await prepare(page); await page.locator('[data-hand-index="0"]').click();
  await page.getByRole('button', { name: 'Choose target', exact: true }).click();
  await page.evaluate(() => { const f = window.arenaFixture; f.props.table = JSON.parse(JSON.stringify(f.props.table)); });
  await expect(page.getByRole('dialog', { name: 'Confirm card play' })).toBeVisible();
  await page.evaluate(() => { window.arenaFixture.props.locked = true; });
  await expect(page.getByRole('dialog', { name: 'Confirm card play' })).not.toBeVisible();
  await expect(page.locator('.is-arena-target')).toHaveCount(0); expect(await actions(page)).toEqual([]);
});
test('Escape stops a live drag, removes its ghost and leaves all actions untouched', async ({ page }) => {
  await prepare(page); const source = page.locator('[data-hand-index="0"]'); await source.scrollIntoViewIfNeeded(); await source.hover();
  const box = await source.boundingBox(); await page.mouse.move(box.x + 15, box.y + 15); await page.mouse.down();
  await page.mouse.move(box.x + 30, box.y + 15, { steps: 3 }); await expect(page.locator('.arena-drag-ghost')).toBeVisible();
  await page.keyboard.press('Escape'); await page.mouse.up(); await expect(page.locator('.arena-drag-ghost')).toHaveCount(0);
  expect(await actions(page)).toEqual([]);
});
test('public count replacements stay singular, with no initial replay and no reduced-motion effect', async ({ page }) => {
  await prepare(page);
  const counter = page.locator('[data-side="self"] .arena-deck-stack b');
  await expect(counter).not.toHaveClass(/arena-count-enter/);
  const transitions = await page.evaluate(async () => {
    const seen = [];
    for (const count of [40, 39, 38, 39]) {
      window.arenaFixture.props.table.players[0].deck_count = count;
      await Promise.resolve();
      seen.push([...document.querySelectorAll('[data-side="self"] .arena-deck-stack b')].map(n => n.textContent));
    }
    return seen;
  });
  expect(transitions).toEqual([['40'], ['39'], ['38'], ['39']]);
  await expect(page.getByRole('img', { name: 'North player deck: 39 face-down cards', exact: true })).toBeVisible();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => { window.arenaFixture.props.table.players[0].deck_count = 38; });
  expect(await page.locator('[data-side="self"] .arena-deck-stack b').evaluate(node => getComputedStyle(node).animationName)).toBe('none');
  await expect(page.locator('body')).not.toContainText('SECRET');
});
test.describe('touch and narrow screens', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });
  test('ordinary touch selects only, while the accessible target button opens confirmation', async ({ page }) => {
    await prepare(page); const card = page.locator('[data-hand-index="0"]'); await card.tap();
    await expect(page.locator('.arena-drag-ghost')).toHaveCount(0); expect(await actions(page)).toEqual([]);
    const choose = page.getByRole('button', { name: 'Choose target', exact: true });
    await choose.evaluate(node => node.scrollIntoView({ block: 'center' })); await choose.tap();
    await expect(page.getByRole('dialog', { name: 'Confirm card play' })).toBeVisible(); expect(await actions(page)).toEqual([]);
    expect(await page.locator('.arena-drag-handle').evaluate(node => getComputedStyle(node).touchAction)).toBe('none');
    expect(await card.evaluate(node => getComputedStyle(node).touchAction)).not.toBe('none');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: 'test-results/arena-table/phase3-mobile-confirmation.png', fullPage: false });
  });
});
test('desktop playable-target evidence', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 }); await prepare(page, 0, { kind: 'energy' });
  await page.locator('[data-hand-index="0"]').click();
  await page.screenshot({ path: 'test-results/arena-table/phase3-desktop-targets.png', fullPage: true });
  expect(await actions(page)).toEqual([]);
});
