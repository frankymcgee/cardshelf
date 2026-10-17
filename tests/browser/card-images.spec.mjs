import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
const artwork = readFileSync(new URL('../../public/appearance-demo.svg', import.meta.url));
const printing = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', key: 'reverse', label: 'Reverse Holo', source: 'tcgdex' };
const cards = [1, 2, 3, 4].map(n => ({ id: `en:mee-00${n}`, game: 'pokemon', language: 'en', local_id: `00${n}`,
  name: ['Grass Energy', 'Fire Energy', 'Water Energy', 'Lightning Energy'][n - 1], set_name: 'Mega Evolution Energy',
  image_url: null, quantity: 0, visual_printings: [printing], printings: [printing], entries: [] }));
cards[3] = { ...cards[3], id: 'ja:mee-004', language: 'ja' };
cards.push({ ...cards[0], id: 'en:me01-001', name: 'Bulbasaur', set_name: 'Mega Evolution',
  image_url: 'https://assets.tcgdex.net/en/me/me01/001/high.webp' });
const binderId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

async function fixture(page) {
  const requests = [], errors = [], writes = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route(/^https:\/\/(?:www\.pokemon\.com\/static-assets\/|limitlesstcg\.nyc3\.cdn\.digitaloceanspaces\.com\/tpci\/|assets\.tcgdex\.net\/)/, route => {
    const url = route.request().url(); requests.push(url);
    const failed = url.includes('MEE_EN_2.png') || url.includes('MEE_EN_3.png') || url.includes('MEE_003_') || url.endsWith('/low.webp');
    return route.fulfill(failed ? { status: 404, body: '' } : { contentType: 'image/svg+xml', body: artwork });
  });
  await page.route('**/api/**', route => {
    const req = route.request(), path = decodeURIComponent(new URL(req.url()).pathname);
    if (req.method() !== 'GET') writes.push(path);
    let data;
    if (path === '/api/session') data = { user: { id: 'image-fixture', name: 'Collector', role: 'user' }, setup_required: false };
    else if (path === '/api/account/games') data = { tier: 'complimentary', games: [{ code: 'pokemon', manageable: true }] };
    else if (path === '/api/account/membership') data = { access: { tier: 'complimentary', features: [], allowed: true } };
    else if (path === '/api/catalogue') data = { items: cards, total: cards.length, page: 1, limit: 30 };
    else if (path === '/api/catalogue/facets') data = { sets: [], rarities: [] };
    else if (path === '/api/public/catalogue') data = { items: cards, total: cards.length, page: 1, limit: 30 };
    else if (path === '/api/public/catalogue/sets') data = [];
    else if (path === '/api/binders/' + binderId) data = { id: binderId, title: 'Image fallbacks', binder_type: 'collection', game: 'pokemon',
      color: '#282f49', columns: 3, rows: 3, page_count: 1, revision: 1, appearance: { effects_mode: 'subtle' },
      slots: cards.map((card, position) => ({ ...card, ...printing, card_id: card.id, printing_id: printing.id, position, owned: false })) };
    else if (path.startsWith('/api/cards/') && path.endsWith('/prices')) data = { enabled: false, game: 'pokemon', printings: [], references: [], history: [] };
    else if (path.startsWith('/api/cards/')) data = cards.find(card => path === '/api/cards/' + card.id);
    else if (path === '/api/public/affiliate-shops') data = { shops: [] };
    else if (path.startsWith('/api/ads/')) data = { eligible: false };
    else if (path === '/api/public/platform') data = {};
    else return route.fulfill({ status: 404, json: { message: 'Unexpected fixture: ' + path } });
    return route.fulfill({ json: data });
  });
  return { requests, errors, writes };
}
async function loaded(img, source) {
  await expect(img).toHaveAttribute('data-artwork-source', source);
  await expect.poll(() => img.evaluate(node => node.complete && node.naturalWidth > 0)).toBe(true);
}

test('production catalogue recovers missing images, falls through errors and respects language', async ({ page }) => {
  const state = await fixture(page), response = await page.goto('/cards');
  expect(response.headers()['content-security-policy']).toContain('https://www.pokemon.com/static-assets/content-assets/cms2/img/cards/web/');
  expect(response.headers()['content-security-policy']).toContain('https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci/');
  const tiles = page.locator('.card-tile');
  await loaded(tiles.nth(0).locator('img'), 'Pokémon');
  await loaded(tiles.nth(1).locator('img'), 'Limitless TCG');
  await expect(tiles.nth(2).locator('.artwork-fallback')).toBeVisible();
  await expect(tiles.nth(2).locator('.foil-layer')).toHaveCount(0);
  await expect(tiles.nth(3).locator('.artwork-fallback')).toBeVisible();
  await tiles.nth(4).scrollIntoViewIfNeeded();
  await loaded(tiles.nth(4).locator('img'), 'TCGdex');
  await expect(tiles.nth(4).locator('img')).toHaveAttribute('src', /\/high\.webp$/);
  expect(state.requests.filter(url => /MEE_EN_3\.png|MEE_003_/.test(url))).toHaveLength(2);
  expect(state.requests.some(url => /MEE_EN_4\.png|MEE_004_/.test(url))).toBe(false);
  expect(state.requests.some(url => /MEG|high\.png/.test(url))).toBe(false);
  expect(state.errors).toEqual([]); expect(state.writes).toEqual([]);
});

test('list thumbnails and card details use the same fallback chain', async ({ page }) => {
  const state = await fixture(page);
  await page.goto('/cards');
  await page.getByRole('button', { name: 'List view', exact: true }).click();
  const rows = page.locator('.table-card-button');
  await loaded(rows.nth(0).locator('img'), 'Pokémon');
  await loaded(rows.nth(1).locator('img'), 'Limitless TCG');
  await rows.nth(1).click();
  await loaded(page.locator('.detail-art > .card-artwork img'), 'Limitless TCG');
  await expect(page.locator('.detail-art > .card-artwork')).toHaveAttribute('data-foil', 'reverse');
  expect(state.errors).toEqual([]); expect(state.writes).toEqual([]);
});

test('previously imported binder slots recover without a write or re-import', async ({ page }) => {
  const state = await fixture(page);
  await page.goto('/binders/' + binderId);
  const pocket = n => page.locator(`.binder-stage button[data-position="${n}"] > .card-artwork`);
  await loaded(pocket(0).locator('img'), 'Pokémon');
  await loaded(pocket(1).locator('img'), 'Limitless TCG');
  await expect(pocket(2).locator('.artwork-fallback')).toBeVisible();
  await expect(pocket(3).locator('.artwork-fallback')).toBeVisible();
  expect(state.errors).toEqual([]); expect(state.writes).toEqual([]);
});

for (const view of [
  { name: 'private', path: '/cards', filters: '**/api/catalogue/facets', tile: '.card-tile', payload: { sets: [{ id: 'en:mee', name: 'Mega Evolution Energy', language: 'en', game: 'pokemon' }], rarities: [] } },
  { name: 'public', path: '/explore', filters: '**/api/public/catalogue/sets?*', tile: '.public-card-tile', payload: [{ id: 'en:mee', name: 'Mega Evolution Energy' }] }
]) {
  test(`${view.name} cards and artwork appear while set filters are still pending`, async ({ page }) => {
    const state = await fixture(page);
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    await page.route(view.filters, async route => {
      await pending;
      await route.fulfill({ json: view.payload });
    });
    try {
      await page.goto(view.path);
      await loaded(page.locator(view.tile).first().locator('img'), 'Pokémon');
      if (view.name === 'public') await expect(page.getByRole('button', { name: 'Search', exact: true })).toBeEnabled();
      release();
      await expect(page.getByLabel('Set', { exact: true }).locator('option[value="en:mee"]')).toHaveCount(1);
      expect(state.errors).toEqual([]); expect(state.writes).toEqual([]);
    } finally { release(); }
  });

  test(`${view.name} card browsing survives a failed set-filter request`, async ({ page }) => {
    const state = await fixture(page);
    await page.route(view.filters, route => route.fulfill({ status: 503, json: { message: 'Filter service unavailable' } }));
    await page.goto(view.path);
    await loaded(page.locator(view.tile).first().locator('img'), 'Pokémon');
    if (view.name === 'public') {
      await expect(page.getByRole('alert')).toContainText('You can still browse and search cards.');
      await page.route(view.filters, route => route.fulfill({ json: view.payload }));
      await page.getByRole('button', { name: 'Retry set filters', exact: true }).click();
      await expect(page.getByLabel('Set', { exact: true }).locator('option[value="en:mee"]')).toHaveCount(1);
      await expect(page.getByRole('alert')).toHaveCount(0);
    }
    expect(state.errors).toEqual([]); expect(state.writes).toEqual([]);
  });
}

test('public searches reuse the loaded set choices', async ({ page }) => {
  const state = await fixture(page);
  let setRequests = 0;
  await page.route('**/api/public/catalogue/sets?*', route => {
    setRequests++;
    return route.fulfill({ json: [{ id: 'en:mee', name: 'Mega Evolution Energy' }] });
  });
  await page.goto('/explore');
  await expect(page.getByLabel('Set', { exact: true }).locator('option[value="en:mee"]')).toHaveCount(1);
  const response = page.waitForResponse(r => new URL(r.url()).pathname === '/api/public/catalogue' && new URL(r.url()).searchParams.get('q') === 'Energy');
  await page.getByRole('searchbox', { name: 'Find a card', exact: true }).fill('Energy');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await response;
  await expect(page.getByRole('button', { name: 'Search', exact: true })).toBeEnabled();
  expect(setRequests).toBe(1);
  expect(state.errors).toEqual([]); expect(state.writes).toEqual([]);
});
