import { test, expect } from '@playwright/test';
const widths = [320, 390, 768, 1024, 1440];
for (const width of widths) for (const seat of [0, 1]) test(`${width}px, seat ${seat}: opposite table, usable zones and no page overflow`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 1000 });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/?seat=' + seat + '&longHand');
  await expect(page.locator('[data-layout="opposite-table"]')).toBeVisible();
  await expect(page.locator('.arena-bench-spot')).toHaveCount(10);
  const boxes = await page.evaluate(() => {
    const box = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
    return { page: document.documentElement.scrollWidth, viewport: innerWidth,
      opponent: box('[data-side="opponent"]'), centre: box('.arena-table-centre'), self: box('[data-side="self"]'), hand: box('.arena-hand-area'),
      bench: box('[data-side="self"] .arena-bench-spot'), discard: box('[data-side="self"] .arena-table-discard'),
      opponentBench: box('[data-side="opponent"] .arena-table-bench'), opponentActive: box('[data-side="opponent"] .arena-table-active'),
      selfBench: box('[data-side="self"] .arena-table-bench'), selfActive: box('[data-side="self"] .arena-table-active') };
  });
  expect(boxes.page).toBeLessThanOrEqual(boxes.viewport + 1);
  expect(boxes.opponent.bottom).toBeLessThanOrEqual(boxes.centre.top);
  expect(boxes.centre.bottom).toBeLessThanOrEqual(boxes.self.top);
  expect(boxes.self.bottom).toBeLessThanOrEqual(boxes.hand.top);
  expect(boxes.opponentBench.bottom).toBeLessThanOrEqual(boxes.opponentActive.top);
  expect(boxes.selfActive.bottom).toBeLessThanOrEqual(boxes.selfBench.top);
  expect(boxes.bench.width).toBeGreaterThanOrEqual(44);
  expect(boxes.discard.width).toBeGreaterThanOrEqual(44);
  expect(boxes.discard.height).toBeGreaterThanOrEqual(44);
  await expect(page.locator('body')).not.toContainText('SECRET');
  await page.getByRole('button', { name: `Active-${seat}, 100 of 100 HP`, exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.arenaFixture.events.at(-1))).toEqual(['select', 'Active-' + seat]);
  const discard = page.getByRole('button', { name: `Inspect ${seat === 0 ? 'North' : 'South'} player discard: 1 cards` });
  await discard.focus(); await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => window.arenaFixture.events.at(-1))).toEqual(['discard', seat]);
  const hand = page.getByRole('region', { name: 'Your hand cards; scroll horizontally for more' });
  await hand.focus(); await page.keyboard.press('End');
  await page.getByRole('button', { name: 'Hand-29, 100 of 100 HP', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => window.arenaFixture.events.at(-1))).toEqual(['select', 'Hand-29']);
  expect(errors).toEqual([]);
  if (seat === 0 && [390, 1440].includes(width)) {
    await page.evaluate(() => { window.arenaFixture.props.selected = ''; document.querySelector('.arena-hand-fan').scrollLeft = 0; });
    await page.screenshot({ path: info.outputPath(`table-${width}px.png`), fullPage: true });
  }
});
test('Stadium actions preserve the server payload and locked tables cannot activate them', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Use Stadium: Training Park', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.arenaFixture.events.at(-1))).toEqual(['action', { type: 'stadium' }]);
  await page.goto('/?locked');
  await expect(page.getByRole('button', { name: 'Use Stadium: Training Park', exact: true })).toBeDisabled();
});
test('Core snapshots, setup and exhausted piles retain safe readable layouts', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?legacy&setup');
  await expect(page.getByRole('region', { name: 'Shared Stadium', exact: true })).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('SECRET');
  await expect(page.getByRole('button', { name: 'Face-down card' }).first()).toBeDisabled();
  await page.goto('/?empty');
  await expect(page.getByText('Your hand is empty.')).toBeVisible();
  await expect(page.locator('.arena-deck-stack.is-empty')).toHaveCount(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('reduced motion removes new depth and inherited card animation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto('/');
  await expect(page.locator('.arena-table')).toBeVisible();
  const styles = await page.evaluate(() => ({ surface: getComputedStyle(document.querySelector('.arena-table'), '::before').transform,
    animation: getComputedStyle(document.querySelector('.arena-card')).animationName,
    transition: getComputedStyle(document.querySelector('.arena-card')).transitionDuration }));
  expect(styles).toEqual({ surface: 'none', animation: 'none', transition: '0s' });
});
