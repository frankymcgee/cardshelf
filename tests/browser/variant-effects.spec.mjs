import { test, expect } from '@playwright/test';
import sharp from 'sharp';
const binderId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const cardId = 'en:foil-preview';
const printings = ['normal', 'holo', 'reverse', 'unspecified'].map((key, i) => ({
  id: `bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb${i}`, key,
  label: ['Normal', 'Holo', 'Reverse Holo', 'Unspecified printing'][i], source: 'tcgdex'
}));
const card = { id: cardId, game: 'pokemon', name: 'Example ex', local_id: '001', language: 'en',
  set_name: 'Demonstration set', image_url: '/appearance-demo.svg', entries: [], printings };
const slots = [
  ['Holo preview', 1], ['Reverse preview', 2], ['Example ex', 1], ['Example-EX', 1],
  ['Normal EX', 0], ['Unknown EX', 3], ['Broken artwork', 1, '/foil-missing.webp'],
  ['Missing artwork', 1, null], ['Example VMAX', 1]
].map(([name, index, image = '/appearance-demo.svg'], position) => ({
  ...card, ...printings[index], name, position, card_id: cardId, printing_id: printings[index].id,
  image_url: image, owned: false
}));
async function fixtures(page, { mode = 'subtle', theme = 'light' } = {}) {
  const errors = [], writes = [];
  let appearance = { effects_mode: mode };
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(value => localStorage.setItem('cardshelf.theme', value), theme);
  await page.route('**/foil-missing.webp', route => route.fulfill({ status: 404, body: '' }));
  await page.route('**/api/**', async route => {
    const req = route.request(), path = decodeURIComponent(new URL(req.url()).pathname);
    let data;
    if (req.method() !== 'GET') writes.push({ path, body: req.postDataJSON() });
    if (path === '/api/session') data = { user: { id: 'foil-fixture', name: 'Collector', role: 'user' }, setup_required: false };
    else if (path === '/api/account/games') data = { tier: 'complimentary', games: [{ code: 'pokemon', manageable: true }] };
    else if (path === '/api/account/membership') data = { access: { tier: 'complimentary', features: [], allowed: true } };
    else if (path === `/api/binders/${binderId}/appearance` && req.method() === 'PATCH') {
      appearance = req.postDataJSON().appearance; data = { id: binderId, appearance, revision: 2 };
    }
    else if (path === '/api/binders/' + binderId) data = { id: binderId, title: 'Card finishes', description: 'Demonstration artwork',
      binder_type: 'collection', game: 'pokemon', color: '#282f49', columns: 3, rows: 3, page_count: 1, revision: 1, slots, appearance };
    else if (path === '/api/cards/' + cardId) data = card;
    else if (path === '/api/cards/' + cardId + '/prices') data = { enabled: false, game: 'pokemon', printings: [], references: [], history: [] };
    else if (path === '/api/prices/summary') data = { enabled: false, rates: [], valuation: { aud_total: null, quantity: 0, priced_quantity: 0, unpriced_quantity: 0, stale_quantity: 0, fx_missing_quantity: 0 } };
    else if (path === '/api/public/affiliate-shops') data = { shops: [] };
    else if (path.startsWith('/api/ads/')) data = { eligible: false };
    else if (path === '/api/public/platform') data = {};
    else return route.fulfill({ status: 404, json: { message: 'Unexpected fixture: ' + path } });
    return route.fulfill({ json: data });
  });
  return { errors, writes };
}
const artwork = (page, n) => page.locator(`.binder-stage button[data-position="${n}"] > .card-artwork`);
async function openBinder(page, options) {
  const fixture = await fixtures(page, options);
  await page.goto('/binders/' + binderId);
  await expect(artwork(page, 0).locator('img')).toBeVisible();
  await expect.poll(() => artwork(page, 0).locator('img').evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
  return fixture;
}
async function pixelCoverage(art) {
  await art.scrollIntoViewIfNeeded();
  await expect.poll(() => art.locator('img').evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
  const layers = art.locator('.foil-layer');
  await expect(layers).toHaveCount(3);
  // Keep the baseline state in place until Chromium has painted it. A temporary
  // screenshot style can race the compositor and capture the foiled image twice.
  const painted = () => art.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(layers.first()).toHaveCSS('visibility', 'visible');
  await painted();
  const onImage = await art.screenshot();
  const styles = await layers.evaluateAll(nodes => nodes.map(node => node.getAttribute('style')));
  let offImage;
  try {
    await layers.evaluateAll(nodes => nodes.forEach(node => node.style.setProperty('visibility', 'hidden', 'important')));
    for (const layer of await layers.all()) await expect(layer).toHaveCSS('visibility', 'hidden');
    await painted();
    offImage = await art.screenshot();
  } finally {
    await layers.evaluateAll((nodes, previous) => nodes.forEach((node, i) => previous[i] == null ? node.removeAttribute('style') : node.setAttribute('style', previous[i])), styles);
    await painted();
  }
  const on = await sharp(onImage).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const off = await sharp(offImage).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  expect(off.info).toEqual(on.info);
  const { width, height, channels } = on.info;
  function difference([x0, y0, x1, y1]) {
    let sum = 0, pixels = 0, changed = 0;
    for (let y = Math.ceil(y0 * height); y < Math.floor(y1 * height); y++) {
      for (let x = Math.ceil(x0 * width); x < Math.floor(x1 * width); x++) {
        const i = (y * width + x) * channels;
        const delta = (Math.abs(on.data[i] - off.data[i]) + Math.abs(on.data[i + 1] - off.data[i + 1]) + Math.abs(on.data[i + 2] - off.data[i + 2])) / 3;
        sum += delta; pixels++; if (delta > 3) changed++;
      }
    }
    return { mean: sum / pixels, coverage: changed / pixels };
  }
  return { art: difference([.2, .25, .8, .5]), stock: difference([.2, .65, .8, .8]) };
}
for (const theme of ['light', 'dark']) {
  test(theme + ' foil visibly covers the correct image areas, including both EX spellings', async ({ page }, info) => {
    const fixture = await openBinder(page, { theme });
    const measurements = [];
    for (const n of [0, 1, 2, 3]) measurements.push(await pixelCoverage(artwork(page, n)));
    for (const [n, region] of [[0, 'art'], [1, 'stock'], [2, 'art'], [2, 'stock'], [3, 'art'], [3, 'stock']]) {
      expect(measurements[n][region].mean, `card ${n} ${region} is visibly foiled`).toBeGreaterThan(3);
      expect(measurements[n][region].coverage, `card ${n} ${region} has surface coverage`).toBeGreaterThan(.35);
    }
    expect(measurements[0].stock.mean, 'standard Holo leaves the text panel clear').toBeLessThan(.3);
    expect(measurements[1].art.mean, 'Reverse Holo leaves the artwork clear').toBeLessThan(.3);
    for (const n of [4, 5, 6, 7]) await expect(artwork(page, n).locator('.foil-layer')).toHaveCount(0);
    await expect(artwork(page, 6).locator('.artwork-fallback')).toBeVisible();
    await expect(artwork(page, 7).locator('.artwork-fallback')).toBeVisible();
    await expect(artwork(page, 8)).toHaveAttribute('data-foil', 'full');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await info.attach('rendered-foil-coverage', { body: JSON.stringify(measurements, null, 2), contentType: 'application/json' });
    await page.locator('.binder-stage').screenshot({ path: info.outputPath(theme + '-foil-binder.png') });
    expect(fixture.errors).toEqual([]); expect(fixture.writes).toEqual([]);
  });
}
test('Shimmer activates one hovered/focused card; touch and reduced motion stay static', async ({ page }, info) => {
  const fixture = await openBinder(page, { mode: 'animated' });
  const allAnimations = () => page.locator('.binder-stage .foil-layer').evaluateAll(nodes => nodes.filter(node => getComputedStyle(node).animationName !== 'none').length);
  const first = artwork(page, 0), pocket = page.locator('button[data-position="0"]');
  await page.mouse.move(0, 0); expect(await allAnimations()).toBe(0);
  await first.hover();
  if (info.project.name === 'desktop') {
    expect(await allAnimations()).toBe(2);
    await expect(artwork(page, 1).locator('.foil-spectrum')).toHaveCSS('animation-name', 'none');
    await page.mouse.move(0, 0);
    // Keyboard modality matters: mouse focus must not animate unrelated cards.
    await page.keyboard.press('Tab'); await pocket.focus();
    await expect(first.locator('.foil-spectrum')).toHaveCSS('animation-name', 'cardshelf-foil');
    expect(await allAnimations()).toBe(2);
  } else expect(await allAnimations()).toBe(0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await allAnimations()).toBe(0);
  await expect(first.locator('.foil-spectrum')).toBeVisible();
  await page.emulateMedia({ forcedColors: 'active' });
  await expect(first.locator('.foil-spectrum')).toBeHidden();
  await page.emulateMedia({ forcedColors: 'none', media: 'print' });
  await expect(first.locator('.foil-spectrum')).toBeHidden();
  expect(fixture.errors).toEqual([]);
});
test('changing the selected printing updates foil without writing collection data', async ({ page }) => {
  const fixture = await openBinder(page);
  await page.locator('button[data-position="2"]').click();
  await page.getByRole('button', { name: 'View card & ownership' }).click();
  const art = page.locator('.detail-art > .card-artwork');
  await expect(art).toHaveAttribute('data-foil', 'ex');
  await page.getByLabel('Visualise printing').selectOption(printings[0].id);
  await expect(art.locator('.foil-layer')).toHaveCount(0);
  await expect(art.locator('.class-ex')).toBeVisible();
  await page.getByLabel('Visualise printing').selectOption(printings[2].id);
  await expect(art).toHaveAttribute('data-foil', 'reverse');
  const coverage = await pixelCoverage(art);
  expect(coverage.art.mean).toBeLessThan(.3);
  expect(coverage.stock.mean).toBeGreaterThan(3);
  await page.getByLabel('Visualise printing').selectOption(printings[3].id);
  await expect(art.locator('.foil-layer')).toHaveCount(0);
  expect(fixture.writes).toEqual([]); expect(fixture.errors).toEqual([]);
});
test('Off and Subtle preview immediately and save the selected binder mode', async ({ page }) => {
  const fixture = await openBinder(page, { mode: 'animated' });
  await page.getByRole('button', { name: 'Appearance', exact: true }).click();
  const preview = page.locator('.appearance-preview');
  await page.getByLabel('Variant effects').selectOption('off');
  await expect(preview.locator('.foil-layer')).toHaveCount(0);
  await expect(preview.locator('.variant-badge')).toHaveCount(4);
  await page.getByLabel('Variant effects').selectOption('subtle');
  await expect(preview.locator('.foil-layer')).toHaveCount(9);
  await preview.locator('.card-artwork').first().hover();
  await expect(preview.locator('.foil-spectrum').first()).toHaveCSS('animation-name', 'none');
  await page.getByLabel('Variant effects').selectOption('off');
  await page.getByRole('button', { name: 'Save appearance', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.binder-stage .foil-layer')).toHaveCount(0);
  expect(fixture.writes).toHaveLength(1);
  expect(fixture.writes[0].path).toBe(`/api/binders/${binderId}/appearance`);
  expect(fixture.writes[0].body.appearance.effects_mode).toBe('off');
  expect(fixture.errors).toEqual([]);
});
