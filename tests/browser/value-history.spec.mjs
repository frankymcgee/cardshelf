import { test, expect } from '@playwright/test';
const binderId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', printingId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const today = new Date().toISOString().slice(0, 10), day = age => new Date(Date.parse(today) - age * 86400000).toISOString().slice(0, 10);
const card = { id: 'en:fixture-001', game: 'pokemon', name: 'History Pikachu', local_id: '001', language: 'en', set_name: 'Fixture set', rarity: 'Rare', faces: [], rules_text: '', image_url: null, entries: [],
  printings: [{ id: printingId, key: 'normal', label: 'Normal', source: 'tcgdex', entries: [] }] };
const valuation = amount => ({ aud_total: amount, quantity: 12, priced_quantity: amount == null ? 0 : 10, unpriced_quantity: amount == null ? 12 : 2, stale_quantity: 0, fx_missing_quantity: 0, approximate_quantity: amount == null ? 0 : 2, approximate_aud_total: amount == null ? 0 : 20, matched_aud_total: amount == null ? 0 : amount - 20, stale_reference_quantity: amount == null ? 0 : 1, failed_reference_quantity: 0 });
function summary(mode = 'normal') {
  let points = [[80, 40], [20, 100], [6, 120], [5, 130], [4, null], [2, 170], [1, 175], [0, 180]].map(([age, amount]) => ({ snapshot_date: day(age), recorded_at: day(age) + 'T12:00:00Z', valuation: valuation(amount) }));
  if (mode === 'first') points = points.slice(-1);
  if (mode === 'empty') points = [];
  if (mode === 'unpriced') points = points.map(point => ({ ...point, valuation: valuation(null) }));
  const changes = Object.fromEntries([7, 30, 90].map(days => {
    const visible = points.filter(point => point.snapshot_date >= day(days - 1)), first = visible[0], last = visible.at(-1);
    const total = first && last && first.valuation.aud_total != null && last.valuation.aud_total != null ? last.valuation.aud_total - first.valuation.aud_total : null;
    return [days, visible.length < 2 ? null : { from: first.snapshot_date, to: last.snapshot_date, total_aud: total, percent: total == null ? null : total / first.valuation.aud_total * 100, price_fx_aud: total == null ? 0 : total - 40, quantity_aud: 30, coverage_aud: 10, added_quantity: 2, removed_quantity: 0 }];
  }));
  return { enabled: mode !== 'paused', refresh_hours: 6, rates: [], valuation: valuation(mode === 'unpriced' ? null : 180), owned_reference: { ...valuation(90), quantity: 6, priced_quantity: 5 }, history: { today, enabled: mode !== 'paused', points, changes } };
}
function cardPrices() {
  return { enabled: true, game: 'pokemon', fetched_at: new Date().toISOString(), attempted_at: null, last_error: '', printings: [], references: [], history: [
    ...[[6, 10], [5, 12], [2, 14], [1, 16], [0, 17]].map(([age, amount]) => ({ source: 'TCGplayer', variant: 'normal', metric: 'marketPrice', currency: 'USD', amount, source_updated_at: day(age) + 'T00:00:00Z' })),
    ...[[6, 8], [5, 9], [0, 10]].map(([age, amount]) => ({ source: 'Cardmarket', variant: 'card-reference', metric: 'trend', currency: 'EUR', amount, source_updated_at: day(age) + 'T00:00:00Z' })),
    ...[[5, 45], [0, 48]].map(([age, amount]) => ({ source: 'TCGplayer', variant: 'holo', metric: 'marketPrice', currency: 'USD', amount, source_updated_at: day(age) + 'T00:00:00Z' }))
  ] };
}
async function fixtures(page, { theme = 'light', mode = 'normal', tracking = false } = {}) {
  const errors = [], calls = []; let currentMode = mode;
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(value => localStorage.setItem('cardshelf.theme', value), theme);
  await page.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = decodeURIComponent(url.pathname); calls.push(path);
    let data;
    if (path === '/api/session') data = { user: { id: 'history-fixture', name: 'Collector', role: 'user' }, setup_required: false };
    else if (path === '/api/account/games') data = { tier: 'complimentary', games: [{ code: 'pokemon', manageable: true }] };
    else if (path === '/api/account/membership') data = { access: { tier: 'complimentary', features: [], allowed: true } };
    else if (path === '/api/dashboard') data = { counts: { copies: 12, binders: 1, catalogue_cards: 1 }, binders: [], progress: [] };
    else if (path === '/api/prices/summary') {
      if (currentMode === 'error') return route.fulfill({ status: 503, json: { message: 'Temporary history outage' } });
      data = summary(currentMode);
    }
    else if (path === '/api/binders/' + binderId) data = { id: binderId, title: 'My planned binder', description: '', binder_type: tracking ? 'tracking' : 'collection', game: 'pokemon', color: '#5546d8', columns: 3, rows: 3, page_count: 1, revision: 1, slots: [], progress: { total: 0, collected: 0, missing: 0, percent: 0 } };
    else if (path === '/api/public/catalogue/cards/' + card.id || path === '/api/cards/' + card.id) data = card;
    else if (path === '/api/public/catalogue/cards/' + card.id + '/prices' || path === '/api/cards/' + card.id + '/prices') data = cardPrices();
    else if (path === '/api/catalogue') data = { items: [card], total: 1, limit: 30 };
    else if (path === '/api/catalogue/facets') data = { sets: [], rarities: [] };
    else if (path === '/api/public/affiliate-shops') data = { shops: [] };
    else if (path.startsWith('/api/ads/')) data = { eligible: false };
    else if (path === '/api/public/platform') data = {};
    else return route.fulfill({ status: 404, json: { message: 'Unexpected fixture: ' + path } });
    return route.fulfill({ json: data });
  });
  return { errors, calls, setMode(value) { currentMode = value; } };
}
async function fits(page) { expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true); }
async function readableLine(chart) {
  const contrast = await chart.locator('.history-line').first().evaluate(el => {
    const rgba = value => { const parts = value.match(/[\d.]+/g)?.map(Number) || []; return [parts[0] || 0, parts[1] || 0, parts[2] || 0, parts[3] ?? 1]; };
    const blend = (top, bottom) => top.slice(0, 3).map((value, i) => value * top[3] + bottom[i] * (1 - top[3]));
    const layers = []; for (let node = el; node; node = node.parentElement) layers.push(rgba(getComputedStyle(node).backgroundColor));
    let background = [255, 255, 255]; for (const layer of layers.reverse()) background = blend(layer, background);
    const foreground = blend(rgba(getComputedStyle(el).stroke), background);
    const luminance = values => values.map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
    const a = luminance(foreground), b = luminance(background); return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
  });
  expect(contrast, 'drawn chart line has at least 3:1 contrast against its painted surface').toBeGreaterThanOrEqual(3);
}
for (const theme of ['light', 'dark']) {
  test(theme + ' collection graph shows daily gaps, keyboard inspection and range changes', async ({ page }, info) => {
    const { errors } = await fixtures(page, { theme }); await page.goto('/app');
    const chart = page.getByRole('region', { name: 'Collection value history', exact: true });
    await expect(chart.getByRole('img')).toBeVisible(); await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect(chart.locator('.history-line')).toHaveCount(2); await readableLine(chart);
    await chart.getByRole('button', { name: '7 days', exact: true }).click(); await expect(chart.getByRole('button', { name: '7 days', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(chart.locator('.chart-observation')).toContainText('$180.00');
    await chart.getByRole('slider', { name: 'Inspect observation' }).focus(); await page.keyboard.press('ArrowLeft');
    await expect(chart.locator('.chart-observation')).toContainText('$175.00');
    await chart.getByText('View history data (6 days)', { exact: true }).click(); await expect(chart.getByRole('table')).toContainText('Unpriced');
    await expect(page.locator('.history-breakdown')).toContainText('Prices & currency rates'); await expect(page.locator('.history-breakdown')).toContainText('Cards added / removed');
    await chart.getByText('View history data (6 days)', { exact: true }).click(); await fits(page);
    await page.locator('.collection-history').screenshot({ path: info.outputPath(theme + '-collection-history.png') }); expect(errors).toEqual([]);
    await chart.getByRole('button', { name: '90 days', exact: true }).click(); await expect(chart.getByText('View history data (8 days)', { exact: true })).toBeVisible();
  });
  test(theme + ' public card graph separates source, currency and printing with exact values', async ({ page }, info) => {
    const { errors } = await fixtures(page, { theme }); await page.goto('/explore/' + encodeURIComponent(card.id));
    const chart = page.getByRole('region', { name: 'Card price history', exact: true }), select = page.getByRole('combobox', { name: 'Price series' });
    await select.selectOption({ label: 'TCGplayer · Normal · Market price · USD' }); await expect(chart.locator('.chart-observation')).toContainText('USD'); await expect(chart.locator('.chart-observation')).toContainText('17.00');
    await select.selectOption({ label: 'Cardmarket · Card-level reference · Trend price · EUR' }); await expect(chart.locator('.chart-observation')).toContainText('EUR'); await expect(chart.locator('.chart-observation')).toContainText('€10.00');
    await expect(page.locator('.selected-series')).toHaveText('Cardmarket · Card-level reference · Trend price · EUR');
    await expect(chart.locator('.history-dot')).toHaveCount(3); await readableLine(chart); await fits(page);
    await page.locator('.card-history').screenshot({ path: info.outputPath(theme + '-card-history.png') }); expect(errors).toEqual([]);
  });
}
test('Collection binder history is explicitly planned; Tracking binders do not request prices', async ({ page }) => {
  const fixture = await fixtures(page); await page.goto('/binders/' + binderId);
  const chart = page.getByRole('region', { name: 'Planned binder value history', exact: true }); await expect(chart).toBeVisible();
  await expect(chart.locator('.chart-observation')).toContainText('planned pockets'); await expect(page.locator('.history-breakdown')).toContainText('Pockets added / removed'); await fits(page); expect(fixture.errors).toEqual([]);
  await page.unroute('**/api/**'); const tracking = await fixtures(page, { tracking: true }); await page.reload();
  await expect(page.getByRole('heading', { name: 'My planned binder', exact: true })).toBeVisible(); await expect(page.locator('.value-chart')).toHaveCount(0);
  expect(tracking.calls).not.toContain('/api/prices/summary'); expect(tracking.errors).toEqual([]);
});
test('signed-in card dialog includes the same source-separated price graph', async ({ page }) => {
  const { errors } = await fixtures(page); await page.goto('/cards?ads=off&card=' + encodeURIComponent(card.id));
  const dialog = page.getByRole('dialog'); await expect(dialog.getByRole('heading', { name: 'Card price history', exact: true })).toBeVisible();
  await expect(dialog.getByRole('combobox', { name: 'Price series' })).toBeVisible(); await fits(page); expect(errors).toEqual([]);
});
test('first observation, unpriced, paused and empty history do not imply a gain', async ({ page }) => {
  const fixture = await fixtures(page, { mode: 'first' }); await page.goto('/app');
  await expect(page.getByText('First observation saved. A trend appears after another day is recorded.')).toBeVisible(); await expect(page.locator('.history-change')).toHaveCount(0);
  for (const [mode, message] of [['unpriced', 'No priced observations in this period.'], ['empty', 'No history recorded in this period yet.'], ['paused', 'History recording is paused while automatic pricing is disabled. Previously recorded observations remain available.']]) {
    fixture.setMode(mode); await page.locator('.price-summary').getByRole('button', { name: 'Refresh', exact: true }).click(); await expect(page.getByText(message, { exact: true })).toBeVisible();
  }
  await fits(page); expect(fixture.errors).toEqual([]);
});
test('a failed refresh hides outdated history and recovers on retry', async ({ page }) => {
  const fixture = await fixtures(page); await page.goto('/app'); await expect(page.locator('.history-plot')).toBeVisible(); fixture.setMode('error');
  await page.locator('.price-summary').getByRole('button', { name: 'Refresh', exact: true }).click(); await expect(page.getByText('Prices are unavailable: Temporary history outage')).toBeVisible(); await expect(page.locator('.value-chart')).toHaveCount(0);
  fixture.setMode('normal'); await page.locator('.price-summary').getByRole('button', { name: 'Refresh', exact: true }).click(); await expect(page.locator('.history-plot')).toBeVisible(); expect(fixture.errors).toEqual([]);
});
