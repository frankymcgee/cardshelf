// CDP supplies real browser touch input; this is Chromium emulation, not physical-device acceptance.
import { test, expect } from './arena-fixtures.mjs';
test.use({ hasTouch: true, viewport: { width: 390, height: 1000 } });
test('touch handle transfers implicit capture, reviews a Bench drop and confirms only after a new tap', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => !!window.arenaFixture);
  await page.evaluate(() => {
    const f = window.arenaFixture, t = f.props.table;
    t.version = 'pokemon-expanded-v2'; t.players[0].bench = t.players[0].bench.slice(0, 1);
    t.legal = [{ card: 'Hand-0', label: 'Touch Bench play', action: { type: 'bench', card: 'Hand-0' } }];
  });
  await page.locator('[data-hand-index="0"]').tap();
  const handle = page.getByRole('button', { name: 'Drag selected card', exact: true });
  await handle.evaluate(node => node.scrollIntoView({ block: 'center', behavior: 'instant' }));
  const origin = await handle.boundingBox();
  const destination = await page.locator('[data-arena-drop="zone:0:bench"]').boundingBox();
  expect(origin).not.toBeNull(); expect(destination).not.toBeNull();
  const x = origin.x + origin.width / 2, y = origin.y + origin.height / 2;
  const dx = destination.x + destination.width / 2, dy = destination.y + destination.height / 2;
  // A stationary drop must not enter the 56px auto-scroll edge band.
  expect(dy).toBeGreaterThan(56); expect(dy).toBeLessThan(944);
  const client = await page.context().newCDPSession(page);
  const touch = (type, x, y) => client.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1, radiusX: 1, radiusY: 1, force: 1 }] });
  let touching = false;
  try {
    await touch('touchStart', x, y); touching = true;
    await touch('touchMove', x + 14, y);
    await touch('touchMove', x + 20, y - 10);
    await expect(page.locator('.arena-drag-ghost')).toBeVisible();
    await touch('touchMove', dx, dy);
    await expect(page.locator('[data-arena-drop="zone:0:bench"]')).toHaveClass(/is-arena-over/);
    await touch('touchEnd'); touching = false;
    const dialog = page.getByRole('dialog', { name: 'Confirm card play' });
    await expect(dialog).toBeVisible();
    expect(await page.evaluate(() => window.arenaFixture.events.filter(e => e[0] === 'action'))).toEqual([]);
    await dialog.getByRole('button', { name: /Confirm: Touch Bench play/ }).tap();
    expect(await page.evaluate(() => window.arenaFixture.events.filter(e => e[0] === 'action'))).toEqual([['action', { type: 'bench', card: 'Hand-0' }]]);
    await expect(dialog).not.toBeVisible();
  } finally { if (touching) await touch('touchEnd'); await client.detach(); }
});
