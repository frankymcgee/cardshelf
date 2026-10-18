import {test, expect} from '@playwright/test';
const binderId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const normal = {id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', label: 'Normal', key: 'normal', source: 'tcgdex'};
const holo = {id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', label: 'Holo', key: 'holo', source: 'tcgdex'};
const card = {id: 'en:fixture-001', game: 'pokemon', name: 'Pikachu', local_id: '001', language: 'en',
  set_name: 'Fixture set', rarity: 'Rare', image_url: null, faces: [], rules_text: '', entries: [], printings: [normal, holo]};
const today = new Date().toISOString().slice(0, 10);
const yesterday = new Date(Date.parse(today) - 86400000).toISOString().slice(0, 10);
const valuation = {aud_total: 180, quantity: 12, priced_quantity: 10, unpriced_quantity: 2, stale_quantity: 0,
  fx_missing_quantity: 0, approximate_quantity: 2, approximate_aud_total: 20, matched_aud_total: 160,
  stale_reference_quantity: 1, failed_reference_quantity: 0};
const summary = {enabled: true, refresh_hours: 6, rates: [], valuation,
  history: {today, enabled: true, points: [yesterday, today].map((date, i) => ({snapshot_date: date, valuation: {...valuation, aud_total: 170 + i * 10}})),
    changes: {30: {from: yesterday, to: today, total_aud: 10, percent: 5.88, price_fx_aud: 10,
      quantity_aud: 0, coverage_aud: 0, added_quantity: 0, removed_quantity: 0}}}};
const binders = ['Fire favourites', 'Water collection', 'Dragon checklist', 'Grass collection', 'Trading cards'].map((title, i) =>
  ({id: i ? binderId.slice(0, -1) + i : binderId, title, game: 'pokemon', binder_type: i === 2 ? 'tracking' : 'collection',
    color: '#5546d8', columns: 3, rows: 3, page_count: 2, filled: 3, collected: 1}));
async function fixtures(page, theme = 'light', mode = 'collection', pageCount = 2) {
  const errors = [], calls = [], writes = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(value => localStorage.setItem('cardshelf.theme', value), theme);
  await page.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = decodeURIComponent(url.pathname);
    calls.push({path, query: Object.fromEntries(url.searchParams)});
    if (request.method() !== 'GET') writes.push(path);
    let data;
    if (path === '/api/session') data = {user: {id: 'ui-fixture', name: 'Sean Collector', role: 'user'}, setup_required: false};
    else if (path === '/api/account/games') data = {tier: 'complimentary', games: [{code: 'pokemon', manageable: true}]};
    else if (path === '/api/account/membership') data = {access: {tier: 'complimentary', features: mode === 'quick' ? ['collection', 'binders', 'prices'].map(code => ({code})) : [], allowed: true}};
    else if (path === '/api/dashboard') data = {counts: {copies: 12, owned_printings: 8, wishlist: 4, binders: 5, catalogue_cards: 20}, binders,
      progress: [{id: 'en:fixture', name: 'Fixture set', language: 'en', imported: 20, card_count: 20, owned: 8}]};
    else if (path === '/api/prices/summary') data = summary;
    else if (path === '/api/binders') data = binders;
    else if (path === '/api/binders/' + binderId || path === '/api/shared/' + 's'.repeat(64)) data = {...binders[0], binder_type: mode === 'tracking' ? 'tracking' : 'collection', quick_tracking: mode === 'quick', page_count: pageCount,
      revision: 1, description: 'My favourite cards in one place.',
      slots: [{...card, ...normal, card_id: card.id, printing_id: normal.id, position: 0, owned: false, is_collected: false}],
      appearance: {effects_mode: 'off'}};
    else if (path === '/api/catalogue') data = {items: [card], total: 1, limit: 30};
    else if (path === '/api/catalogue/facets') data = {sets: [{id: 'en:fixture', name: 'Fixture set', game: 'pokemon', language: 'en'}], rarities: ['Rare']};
    else if (path === '/api/cards/' + card.id) data = card;
    else if (path === '/api/cards/' + card.id + '/prices') data = {enabled: true, fetched_at: today, attempted_at: null, last_error: '',
      game: 'pokemon', printings: [], references: [], history: [yesterday, today].map((date, i) =>
        ({source: 'TCGplayer', variant: 'normal', metric: 'marketPrice', currency: 'USD', amount: 10 + i, source_updated_at: date + 'T00:00:00Z'}))};
    else if (path === '/api/public/affiliate-shops') data = {shops: []};
    else if (path.startsWith('/api/ads/')) data = {eligible: false};
    else if (path === '/api/public/platform') data = {};
    else return route.fulfill({status: 404, json: {message: 'Unexpected fixture: ' + path}});
    return route.fulfill({json: data});
  });
  return {errors, calls, writes};
}
async function fits(page) {expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);}
for (const theme of ['light', 'dark']) {
  test(theme + ' overview shows useful totals and binders before optional charts', async ({page}, info) => {
    const state = await fixtures(page, theme); await page.goto('/app');
    const details = page.locator('.value-details');
    await expect(page.locator('.price-total')).toHaveText('$180.00');
    await expect(details).not.toHaveAttribute('open');
    await expect(page.getByRole('region', {name: 'Collection value history', exact: true})).not.toBeVisible();
    await expect(page.locator('.compact-price-warning')).toBeVisible();
    const first = page.locator('.dashboard-binders .binder-card').first(); await expect(first).toBeVisible();
    expect((await first.boundingBox()).y).toBeLessThan(page.viewportSize().height);
    await fits(page); await page.screenshot({path: info.outputPath(theme + '-overview.png'), fullPage: true});
    await details.locator('summary').first().focus(); await page.keyboard.press('Enter');
    await expect(page.getByRole('region', {name: 'Collection value history', exact: true})).toBeVisible();
    await page.getByText('What changed', {exact: true}).click(); await expect(page.locator('.history-breakdown')).toBeVisible();
    await page.getByRole('link', {name: 'Wishlist', exact: true}).first().click();
    await expect(page.locator('.catalogue-tabs button.active')).toHaveText('Wishlist');
    expect(state.errors).toEqual([]); expect(state.writes).toEqual([]);
  });
  test(theme + ' binder opens on cards and reveals value and secondary tools on demand', async ({page}, info) => {
    const state = await fixtures(page, theme); await page.goto('/binders/' + binderId);
    await expect(page.locator('.pocket').first()).toBeVisible();
    expect((await page.locator('.pocket').first().boundingBox()).y).toBeLessThan(page.viewportSize().height);
    expect(state.calls.some(call => call.path === '/api/prices/summary')).toBe(false);
    await expect(page.getByRole('button', {name: 'Cards', exact: true})).toHaveAttribute('aria-pressed', 'true');
    await fits(page); await page.screenshot({path: info.outputPath(theme + '-binder.png'), fullPage: true});
    await page.getByRole('button', {name: 'Value & history', exact: true}).click();
    await expect(page.getByRole('region', {name: 'Planned binder value history', exact: true})).toBeVisible();
    await page.getByRole('button', {name: 'Cards', exact: true}).click(); await expect(page.locator('.pocket').first()).toBeVisible();
    await page.locator('.binder-tools > summary').click(); await page.getByRole('button', {name: 'Share', exact: true}).click();
    await expect(page.getByRole('dialog', {name: 'Read-only sharing'})).toBeVisible();
    await page.getByRole('button', {name: 'Close dialog'}).click(); await fits(page);
    expect(state.errors).toEqual([]); expect(state.writes).toEqual([]);
  });
}
test('advanced catalogue filters remain usable, counted and clearable while collapsed', async ({page}, info) => {
  const state = await fixtures(page); await page.goto('/cards');
  await expect(page.locator('.card-tile')).toBeVisible(); await expect(page.getByRole('combobox', {name: 'Set', exact: true})).toBeVisible();
  const details = page.locator('.catalogue-more-filters'); await expect(details).not.toHaveAttribute('open');
  await expect(page.getByRole('combobox', {name: 'Language', exact: true})).not.toBeVisible();
  await details.locator('summary').focus(); await page.keyboard.press('Enter');
  await page.getByRole('combobox', {name: 'Language', exact: true}).selectOption('en');
  await expect.poll(() => state.calls.filter(call => call.path === '/api/catalogue').at(-1)?.query.language).toBe('en');
  await details.locator('summary').click(); await expect(details.locator('summary')).toContainText('1 active');
  await page.getByRole('button', {name: 'Clear filters', exact: true}).click();
  await expect(details.locator('summary')).not.toContainText('active'); await fits(page);
  await page.screenshot({path: info.outputPath('compact-catalogue.png'), fullPage: true});
  expect(state.errors).toEqual([]); expect(state.writes).toEqual([]);
});
test('binder search and clear filters do not hide access to the full collection', async ({page}) => {
  const state = await fixtures(page); await page.goto('/binders'); await expect(page.locator('.binder-card')).toHaveCount(5);
  await page.getByRole('searchbox', {name: 'Search binders'}).fill('Water'); await expect(page.locator('.binder-card')).toHaveCount(1);
  await page.getByRole('button', {name: 'Tracking', exact: true}).click(); await expect(page.getByText('No binders match your filters.')).toBeVisible();
  await page.getByRole('button', {name: 'Clear filters', exact: true}).first().click(); await expect(page.locator('.binder-card')).toHaveCount(5);
  await fits(page); expect(state.errors).toEqual([]); expect(state.writes).toEqual([]);
});
test('card prices and printing editors collapse without losing unsaved ownership changes', async ({page}) => {
  const state = await fixtures(page); await page.goto('/cards?ads=off&card=' + encodeURIComponent(card.id));
  const dialog = page.getByRole('dialog'), panels = dialog.locator('.printing-panel');
  await expect(panels).toHaveCount(2); await expect(panels.first()).toHaveAttribute('open');
  await panels.first().getByLabel('Quantity', {exact: true}).fill('3');
  await panels.first().locator(':scope > summary').click(); await panels.nth(1).locator(':scope > summary').click();
  await expect(panels.nth(1).getByLabel('Quantity', {exact: true})).toBeVisible();
  await panels.first().locator(':scope > summary').click(); await expect(panels.first().getByLabel('Quantity', {exact: true})).toHaveValue('3');
  const prices = dialog.locator('.card-value-details'); await expect(prices).not.toHaveAttribute('open');
  await prices.locator('summary').first().click(); await expect(dialog.getByRole('heading', {name: 'Card price history', exact: true})).toBeVisible();
  await fits(page); expect(state.errors).toEqual([]); expect(state.writes).toEqual([]);
});

for (const mode of ['collection', 'tracking', 'quick']) {
  test(mode + ' book has matching two-page spreads, boundaries, keyboard controls and a single-page option', async ({page}, info) => {
    const state = await fixtures(page, 'light', mode, 5); await page.goto('/binders/' + binderId);
    const book = page.locator('.binder-book'), range = book.locator('.book-range');
    await expect(range).toHaveText('Pages 1–2 of 5');
    const leaves = book.locator(mode === 'tracking' ? '.tracking-page' : mode === 'quick' ? '.quick-page' : '.binder-page');
    await expect(leaves).toHaveCount(2);
    const left = await leaves.nth(0).boundingBox(), right = await leaves.nth(1).boundingBox();
    expect(Math.abs(left.y - right.y)).toBeLessThan(2); expect(right.x).toBeGreaterThan(left.x + left.width);
    // A visible pocket must receive taps; Chromium 143 can paint the themed
    // pages while incorrectly hitting the stage behind them.
    const pocket = book.locator(mode === 'tracking' ? '.tracking-card:not(.empty)' : mode === 'quick' ? '.quick-card:not(.empty)' : '.pocket.filled').first();
    await pocket.evaluate(node => node.scrollIntoView({block: 'center', behavior: 'instant'}));
    expect(await pocket.evaluate(node => {
      const box = node.getBoundingClientRect();
      return node.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
    })).toBe(true);
    await book.getByRole('button', {name: 'Next', exact: true}).click(); await expect(range).toHaveText('Pages 3–4 of 5');
    if (mode !== 'tracking') {
      await page.getByRole('button', {name: 'Value & history', exact: true}).click();
      await expect(page.locator('.price-total')).toBeVisible();
      await page.getByRole('button', {name: 'Cards', exact: true}).click();
      await expect(range).toHaveText('Pages 3–4 of 5');
    }
    await book.getByRole('button', {name: 'Next', exact: true}).click(); await expect(range).toHaveText('Page 5 of 5');
    await expect(book.getByRole('button', {name: 'Next', exact: true})).toBeDisabled();
    await book.getByRole('button', {name: 'Previous', exact: true}).click(); await expect(range).toHaveText('Pages 3–4 of 5');
    await expect(book).not.toHaveClass(/turning/); await book.locator('.book-viewport').focus(); await page.keyboard.press('ArrowLeft');
    await expect(range).toHaveText('Pages 1–2 of 5');
    await book.getByRole('button', {name: 'Single page', exact: true}).click(); await expect(range).toHaveText('Page 1 of 5');
    await book.getByRole('button', {name: 'Next', exact: true}).click(); await expect(range).toHaveText('Page 2 of 5');
    await book.getByRole('button', {name: 'Two pages', exact: true}).click(); await expect(range).toHaveText('Pages 1–2 of 5');
    await fits(page); await page.screenshot({path: info.outputPath(mode + '-book-spread.png'), fullPage: true});
    expect(state.errors).toEqual([]); expect(state.writes).toEqual([]);
  });
  test(mode + ' touch swipes turn the book without editing a pocket or intercepting vertical scrolling', async ({page}, info) => {
    test.skip(info.project.name !== 'phone', 'Native touch gestures are exercised in the phone context.');
    const state = await fixtures(page, 'light', mode, 5); await page.goto('/binders/' + binderId);
    const book = page.locator('.binder-book'), viewport = book.locator('.book-viewport');
    await expect(book.locator('.book-range')).toHaveText('Pages 1–2 of 5');
    await book.locator(mode === 'tracking' ? '.tracking-card:not(.empty)' : mode === 'quick' ? '.quick-card:not(.empty)' : '.pocket.filled').first().tap();
    await expect(page.locator('dialog[open]')).toHaveCount(1);
    await page.getByRole('button', {name: 'Close dialog'}).click();
    const cdp = await page.context().newCDPSession(page);
    async function swipe(dx, dy) {
      await expect(book).not.toHaveClass(/turning/); await viewport.scrollIntoViewIfNeeded();
      const box = await viewport.boundingBox();
      const x = box.x + box.width * (dx < 0 ? .8 : .2), y = box.y + Math.min(box.height * .5, 160);
      await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x, y}]});
      for (let i = 1; i <= 6; i++) {
        await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{x: x + dx * i / 6, y: y + dy * i / 6}]});
        await page.waitForTimeout(16);
      }
      await page.waitForTimeout(80);
      await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
    }
    await swipe(160, 5); await expect(book.locator('.book-range')).toHaveText('Pages 1–2 of 5');
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    await swipe(-160, 5); await expect(book.locator('.book-range')).toHaveText('Pages 3–4 of 5');
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    await swipe(5, -90); await expect(book.locator('.book-range')).toHaveText('Pages 3–4 of 5');
    await expect.poll(() => page.evaluate(async () => {const y = scrollY; await new Promise(resolve => setTimeout(resolve, 100)); return Math.abs(scrollY - y) < 1;})).toBe(true);
    await swipe(160, 5); await expect(book.locator('.book-range')).toHaveText('Pages 1–2 of 5');
    await expect(page.locator('dialog[open]')).toHaveCount(0); await fits(page);
    await expect(book).not.toHaveClass(/turning/);
    // Keep the post-swipe gesture in the same native input session.
    const target = book.locator(mode === 'tracking' ? '.tracking-card:not(.empty)' : mode === 'quick' ? '.quick-card:not(.empty)' : '.pocket.filled').first();
    await target.evaluate(node => node.scrollIntoView({block: 'center', behavior: 'instant'}));
    const box = await target.boundingBox();
    await cdp.send('Input.synthesizeTapGesture', {x: box.x + box.width / 2, y: box.y + box.height / 2, gestureSourceType: 'touch', duration: 50});
    await expect(page.locator('dialog[open]')).toHaveCount(1);
    await page.getByRole('button', {name: 'Close dialog'}).click();
    expect(state.errors).toEqual([]); expect(state.writes).toEqual([]);
  });
}

test('book page turns respect reduced-motion preferences', async ({page}) => {
  await fixtures(page, 'dark', 'tracking', 4); await page.emulateMedia({reducedMotion: 'reduce'}); await page.goto('/binders/' + binderId);
  const book = page.locator('.binder-book'); await book.getByRole('button', {name: 'Next', exact: true}).click();
  await expect(book.locator('.book-range')).toHaveText('Pages 3–4 of 4');
  await expect(book.locator('.book-content')).toHaveCSS('animation-name', 'none');
});

test('portrait binder tools stay visible when all primary actions wrap', async ({page}, info) => {
  test.skip(info.project.name === 'desktop', 'Portrait phone layout.');
  const state = await fixtures(page, 'light', 'quick', 5);
  for (const width of [320, 390, 430]) {
    await page.setViewportSize({width, height: 844}); await page.goto('/binders/' + binderId);
    await expect(page.getByRole('link', {name: 'Scan a card', exact: true})).toBeVisible();
    await page.locator('.binder-tools > summary').click();
    const actions = page.locator('.binder-tools-actions');
    for (const button of await actions.locator('button, a').all()) {
      await button.scrollIntoViewIfNeeded();
      const box = await button.boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(16); expect(box.x + box.width).toBeLessThanOrEqual(width - 16);
      expect(box.y).toBeGreaterThanOrEqual(65); expect(box.y + box.height).toBeLessThan(770);
    }
    await fits(page);
    await page.getByRole('button', {name: 'Binder settings', exact: true}).click();
    await expect(page.getByRole('dialog', {name: 'Binder settings', exact: true})).toBeVisible();
    await page.getByRole('button', {name: 'Close dialog'}).click();
    await expect(page.locator('.binder-tools')).not.toHaveAttribute('open');
  }
  expect(state.errors).toEqual([]); expect(state.writes).toEqual([]);
});

for (const mode of ['collection', 'tracking', 'quick']) test(mode + ' touch stream survives pointer cancellation and preserves vertical scroll and pinch', async ({page}, info) => {
  test.skip(info.project.name === 'desktop', 'Touch-only event stream used by mobile browsers.');
  const state = await fixtures(page, 'light', mode, 5); await page.goto('/binders/' + binderId);
  const book = page.locator('.binder-book'); await expect(book.locator('.book-range')).toHaveText('Pages 1–2 of 5');
  async function gesture(dx, dy, pinch = false) {
    await expect(book).not.toHaveClass(/turning/);
    return book.locator('.book-viewport').evaluate((node, {dx, dy, pinch}) => {
      const target = node.querySelector('button'), box = target.getBoundingClientRect();
      const touch = (id, x, y) => ({identifier: id, target, clientX: x, clientY: y});
      const first = touch(1, box.x + box.width / 2, box.y + box.height / 2);
      function send(type, touches, changedTouches) {
        const event = new Event(type, {bubbles: true, cancelable: true});
        Object.defineProperties(event, {touches: {value: touches}, changedTouches: {value: changedTouches}});
        target.dispatchEvent(event); return event.defaultPrevented;
      }
      send('touchstart', [first], [first]);
      target.dispatchEvent(new PointerEvent('pointercancel', {bubbles: true, pointerType: 'touch', pointerId: 1}));
      if (pinch) send('touchstart', [first, touch(2, first.clientX + 10, first.clientY)], [first]);
      const last = touch(1, first.clientX + dx, first.clientY + dy);
      const prevented = send('touchmove', pinch ? [last, touch(2, last.clientX + 20, last.clientY)] : [last], [last]);
      send('touchend', [], [last]); return prevented;
    }, {dx, dy, pinch});
  }
  expect(await gesture(-100, 4)).toBe(true); await expect(book.locator('.book-range')).toHaveText('Pages 3–4 of 5');
  expect(await gesture(5, -90)).toBe(false); await expect(book.locator('.book-range')).toHaveText('Pages 3–4 of 5');
  expect(await gesture(-100, 0, true)).toBe(false); await expect(book.locator('.book-range')).toHaveText('Pages 3–4 of 5');
  expect(await gesture(100, 4)).toBe(true); await expect(book.locator('.book-range')).toHaveText('Pages 1–2 of 5');
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await expect(book).not.toHaveClass(/turning/);
  await book.locator(mode === 'tracking' ? '.tracking-card:not(.empty)' : mode === 'quick' ? '.quick-card:not(.empty)' : '.pocket.filled').first().tap();
  await expect(page.locator('dialog[open]')).toHaveCount(1);
  await page.getByRole('button', {name: 'Close dialog'}).click();
  expect(state.writes).toEqual([]); expect(state.errors).toEqual([]);
});

for (const mode of ['tracking', 'collection']) test('shared ' + mode + ' binders use the same read-only book navigation', async ({page}) => {
  const state = await fixtures(page, 'light', mode, 4); await page.goto('/shared/' + 's'.repeat(64));
  const book = page.locator('.binder-book'); await expect(book.locator('.book-range')).toHaveText('Pages 1–2 of 4');
  await book.getByRole('button', {name: 'Next', exact: true}).click(); await expect(book.locator('.book-range')).toHaveText('Pages 3–4 of 4');
  await expect(page.locator('dialog[open]')).toHaveCount(0); await fits(page);
  expect(state.errors).toEqual([]); expect(state.writes).toEqual([]);
});
