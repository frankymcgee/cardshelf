import { test, expect } from './arena-fixtures.mjs';
const widths = [320, 390, 768, 1024, 1440];
for(const width of [320,1440])for(const seat of [0,1])test(`rulebook HUD ${width}px seat ${seat}: shared powers and public Lost Zone stay inspectable`,async({page},info)=>{
  await page.setViewportSize({width,height:1100});await page.goto('/?rules&seat='+seat);
  const resources=page.getByLabel((seat===0?'North':'South')+' player game resources');
  await expect(resources).toContainText(seat===0?'GX: Used':'GX: Available');await expect(resources).toContainText(seat===0?'VSTAR: Available':'VSTAR: Used');
  const geometry=await resources.evaluate(element=>{
    const piles=element.parentElement.querySelector('.arena-table-reserve').getBoundingClientRect(),row=element.getBoundingClientRect();
    return {separateRow:row.top>=piles.bottom-1,labelsFit:[...element.querySelectorAll('small')].every(label=>label.scrollWidth<=label.clientWidth+1&&getComputedStyle(label).whiteSpace==='nowrap')};
  });expect(geometry).toEqual({separateRow:true,labelsFit:true});
  const lost=resources.getByRole('button',{name:'Lost Zone · 1',exact:true});await lost.click();
  const dialog=page.getByRole('dialog',{name:(seat===0?'North':'South')+' player · Public Lost Zone',exact:true});await expect(dialog).toBeVisible();await expect(dialog).toContainText('cannot be recovered');await expect(page.locator('body')).not.toContainText('SECRET');
  await dialog.getByRole('button',{name:'Public Prism-'+seat+', 100 of 100 HP',exact:true}).click();await expect(dialog).not.toBeVisible();
  await expect.poll(()=>page.evaluate(()=>window.arenaFixture.events.at(-1))).toEqual(['select','Public Prism-'+seat]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  if(seat===0)await page.screenshot({path:info.outputPath('rulebook-hud-'+width+'.png'),fullPage:true});
});
test('rulebook TAG TEAM cost rejects a partial payment and retains the exact private choice IDs',async({page})=>{
  await page.goto('/');await page.evaluate(()=>window.arenaFixture.setPrompt({kind:'tag_team_cost',title:'Optional TAG TEAM bonus',min:0,max:2,allowed_counts:[0,2],options:[{id:'one',label:'Private card one'},{id:'two',label:'Private card two'}]}));
  const decision=page.getByRole('region',{name:'Required game decision'});await expect(decision.getByRole('button',{name:'Confirm no selection',exact:true})).toBeEnabled();
  await decision.getByRole('button',{name:'Private card one',exact:true}).click();await expect(decision.getByRole('button',{name:'Confirm selection',exact:true})).toBeDisabled();
  await decision.getByRole('button',{name:'Private card two',exact:true}).click();await decision.getByRole('button',{name:'Confirm selection',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.arenaFixture.events.at(-1))).toEqual(['choose',['one','two']]);
});
test('rulebook Retreat decision uses provided Energy units rather than card count',async({page})=>{
  await page.goto('/');await page.evaluate(()=>window.arenaFixture.setPrompt({kind:'retreat_discard',title:'Retreat Energy',min:1,max:2,retreat_cost:2,options:[{id:'double',label:'Double Energy',energy_value:2},{id:'single',label:'Single Energy',energy_value:1}]}));
  const decision=page.getByRole('region',{name:'Required game decision'}),confirm=decision.getByRole('button',{name:'Confirm selection',exact:true});
  await decision.getByRole('button',{name:/Single Energy/}).click();await expect(confirm).toBeDisabled();await decision.getByRole('button',{name:/Double Energy/}).click();await expect(confirm).toBeDisabled();
  await decision.getByRole('button',{name:/Single Energy/}).click();await expect(confirm).toBeEnabled();await confirm.click();
  await expect.poll(()=>page.evaluate(()=>window.arenaFixture.events.at(-1))).toEqual(['choose',['double']]);
});
test('rulebook private viewed cards and Checkup ordering render as distinct server decisions',async({page})=>{
  await page.goto('/');await page.evaluate(()=>window.arenaFixture.setPrompt({kind:'fossil_search',title:'Private bottom seven',min:0,max:0,options:[],looked_at:[{id:'viewed',card:{name:'Privately viewed fossil',kind:'pokemon'}}]}));
  const decision=page.getByRole('region',{name:'Required game decision'});await decision.getByText('Cards you looked at — private to you',{exact:true}).click();await expect(decision).toContainText('Privately viewed fossil');await decision.getByRole('button',{name:'Confirm no selection',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.arenaFixture.events.at(-1))).toEqual(['choose',[]]);
  await page.evaluate(()=>window.arenaFixture.setPrompt({kind:'checkup_order',title:'Choose next Checkup step',min:1,max:1,options:[{id:'conditions',label:'All Special Conditions together'},{id:'ability:0',label:'Healing trigger'}]}));
  await decision.getByRole('button',{name:'All Special Conditions together',exact:true}).click();await decision.getByRole('button',{name:'Confirm selection',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.arenaFixture.events.at(-1))).toEqual(['choose',['conditions']]);
});
for (const seat of [0, 1]) test(`perspective seat ${seat}: nearer cards enlarge, projected targets remain clickable, hand and actions stay flat`, async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1500 });
  await page.goto('/?seat=' + seat);
  await expect(page.locator('[data-view="first-person"]')).toBeVisible();
  const geometry = await page.evaluate(() => {
    const plane = document.querySelector('.arena-table-plane');
    const near = document.querySelector('[data-side="self"] .arena-active-spot');
    const far = document.querySelector('[data-side="opponent"] .arena-active-spot');
    const targets = [...document.querySelectorAll('.arena-table-plane .arena-card:not(:disabled)')];
    return { transform: getComputedStyle(plane).transform, near: near.getBoundingClientRect().width, far: far.getBoundingClientRect().width,
      handFlat: !document.querySelector('.arena-hand-area').closest('.arena-table-plane'),
      actionsFlat: !document.querySelector('.arena-table-actions').closest('.arena-table-plane'),
      targetsHit: targets.every(target => { const r = target.getBoundingClientRect(); return target.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)); }) };
  });
  expect(geometry.transform).not.toBe('none');
  expect(geometry.near).toBeGreaterThan(geometry.far);
  expect(geometry.handFlat).toBe(true); expect(geometry.actionsFlat).toBe(true); expect(geometry.targetsHit).toBe(true);
  await page.locator('[data-side="opponent"] .arena-bench-spot .arena-card').first().click();
  await expect.poll(() => page.evaluate(() => window.arenaFixture.events.at(-1))).toEqual(['select', `Bench-${1 - seat}-0`]);
  await expect(page.getByRole('region', { name: 'Selected card actions', exact: true })).toBeVisible();
  expect(await page.locator('.arena-action-tray').evaluate(e => !e.closest('.arena-table-plane'))).toBe(true);
});
test('reduced motion and narrow containers keep a flat field; public discard artwork remains inspectable', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1500 }); await page.goto('/');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(() => page.locator('.arena-table-plane').evaluate(e => getComputedStyle(e).transform)).toBe('none');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.locator('.arena-board-wrap').evaluate(e => { e.style.maxWidth = '700px'; });
  await expect.poll(() => page.locator('.arena-table-plane').evaluate(e => getComputedStyle(e).transform)).toBe('none');
  await page.route('**/fixture-discard-card.svg', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="63" height="88"><rect width="63" height="88" fill="teal"/></svg>' }));
  await page.evaluate(() => { window.arenaFixture.props.table.players[0].discard[0].card.image_url = '/fixture-discard-card.svg'; });
  const pile = page.locator('[data-side="self"] .arena-table-discard');
  await expect(pile.locator('img')).toBeVisible();
  await expect.poll(() => pile.locator('img').evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
  await pile.click();
  await expect(page.getByRole('dialog', { name: 'Discard pile', exact: true })).toBeVisible();
  await page.getByRole('dialog', { name: 'Discard pile', exact: true }).getByRole('button', { name: 'Close', exact: true }).click();
  await page.evaluate(() => { window.arenaFixture.props.table.players[0].discard = []; });
  await expect(pile.locator('img')).toHaveCount(0); await expect(pile).toHaveAttribute('aria-label', 'Inspect North player discard: 0 cards');
});
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
  await page.locator('.arena-board').getByRole('button', { name: `Active-${seat}, 100 of 100 HP`, exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.arenaFixture.events.at(-1))).toEqual(['select', 'Active-' + seat]);
  const discard = page.getByRole('button', { name: `Inspect ${seat === 0 ? 'North' : 'South'} player discard: 1 cards` });
  await discard.focus(); await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => window.arenaFixture.events.at(-1))).toEqual(['discard', seat]);
  await page.getByRole('dialog', { name: 'Discard pile', exact: true }).getByRole('button', { name: 'Close', exact: true }).click();
  const hand = page.getByRole('region', { name: 'Your hand cards; scroll horizontally for more' });
  await hand.focus(); await page.keyboard.press('End');
  await expect(hand.locator('[data-hand-index="29"]')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => window.arenaFixture.events.at(-1))).toEqual(['select', 'Hand-29']);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
  if (seat === 0 && [390, 1440].includes(width)) {
    await page.evaluate(() => { window.arenaFixture.clearSelection(); document.querySelector('.arena-hand-fan').scrollLeft = 0; });
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
test('reduced motion removes new depth, fan transforms and inherited card animation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto('/');
  await expect(page.locator('.arena-table')).toBeVisible();
  const styles = await page.evaluate(() => ({ surface: getComputedStyle(document.querySelector('.arena-table'), '::before').transform,
    animation: getComputedStyle(document.querySelector('.arena-card')).animationName,
    transition: getComputedStyle(document.querySelector('.arena-card')).transitionDuration,
    fan: getComputedStyle(document.querySelector('[data-hand-index="0"]')).transform }));
  expect(styles).toEqual({ surface: 'none', animation: 'none', transition: '0s', fan: 'none' });
});
test('hover and keyboard navigation lift cards without submitting a move', async ({ page }) => {
  await page.goto('/');
  const hand = page.locator('.arena-hand-interactive'), card = hand.locator('[data-hand-index="0"]');
  await card.hover(); await expect(card).not.toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => window.arenaFixture.events)).toEqual([]);
  await hand.focus(); await page.keyboard.press('End');
  await expect(hand.locator('[data-hand-index="6"]')).toBeFocused();
  expect(await page.evaluate(() => window.arenaFixture.events)).toEqual([]);
  await page.keyboard.press('Home'); await page.keyboard.press('Enter');
  await expect(card).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => window.arenaFixture.events)).toEqual([['select', 'Hand-0']]);
});
test('action tray permits explicit legal actions, pauses safely and still allows inspection', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-hand-index="0"]').click();
  const tray = page.getByRole('region', { name: 'Selected card actions', exact: true });
  await tray.getByRole('button', { name: 'Play Hand-0', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.arenaFixture.events.at(-1))).toEqual(['action', { type: 'bench', card: 'Hand-0' }]);
  await page.evaluate(() => { window.arenaFixture.props.locked = true; });
  await expect(tray.getByRole('button', { name: 'Play Hand-0', exact: true })).toBeDisabled();
  await tray.getByRole('button', { name: 'Inspect', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Card preview', exact: true })).toBeVisible();
});
test('preview traps focus, closes with Escape and restores the initiating control', async ({ page }) => {
  await page.goto('/'); await page.locator('[data-hand-index="0"]').click();
  const inspect = page.getByRole('region', { name: 'Selected card actions', exact: true }).getByRole('button', { name: 'Inspect', exact: true });
  await inspect.click();
  const dialog = page.getByRole('dialog', { name: 'Card preview', exact: true });
  await expect(dialog).toBeVisible();
  for (let i = 0; i < 8; i++) { await page.keyboard.press('Tab'); expect(await page.evaluate(() => !!document.activeElement?.closest('dialog[open]') || document.activeElement === document.body)).toBe(true); }
  await page.keyboard.press('Escape'); await expect(dialog).not.toBeVisible(); await expect(inspect).toBeFocused();
});
test('prompt minimization keeps selections; polling preserves them; a new decision revision resets them', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => window.arenaFixture.setPrompt({ kind: 'prize', title: 'Choose two Prizes', min: 2, max: 2, options: [0,1,2].map(i => ({ id: String(i), label: 'Prize ' + (i + 1), hidden: true, card: { card: { image_url: '/SECRET.png' } } })) }));
  const dialog = page.getByRole('dialog', { name: 'Required game decision', exact: true });
  await expect(dialog).toBeVisible(); await expect(dialog.locator('img')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Prize 1', exact: true }).click();
  await dialog.getByRole('button', { name: 'Back to table', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(await page.evaluate(() => window.arenaFixture.events)).toEqual([]);
  await page.getByRole('button', { name: 'Resume decision', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Prize 1', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(() => { window.arenaFixture.props.table.prompt = JSON.parse(JSON.stringify(window.arenaFixture.props.table.prompt)); });
  await expect(dialog.getByRole('button', { name: 'Prize 1', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(dialog.getByRole('button', { name: 'Take 1 Prize card', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Prize 2', exact: true }).click();
  await dialog.getByRole('button', { name: 'Take 2 Prize cards', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.arenaFixture.events.at(-1))).toEqual(['choose', ['0', '1']]);
  await page.evaluate(() => window.arenaFixture.setPrompt(JSON.parse(JSON.stringify(window.arenaFixture.props.table.prompt))));
  await expect(dialog.getByRole('button', { name: 'Take 0 Prize cards', exact: true })).toBeDisabled();
});
test('long search prompts scroll inside the modal with an accessible close control and valid zero-choice path', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 }); await page.goto('/');
  await page.evaluate(() => window.arenaFixture.setPrompt({ kind: 'search', title: 'Search your deck', min: 0, max: 1, options: Array.from({ length: 60 }, (_, i) => ({ id: String(i), label: 'Choice ' + i })) }));
  const dialog = page.getByRole('dialog', { name: 'Required game decision', exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Choice 59', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Back to table', exact: true })).toBeInViewport();
  await dialog.getByRole('button', { name: 'Choice 59', exact: true }).click();
  await dialog.getByRole('button', { name: 'Confirm no selection', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.arenaFixture.events.at(-1))).toEqual(['choose', []]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('mobile touch selects without jumping, uses a visible dock, and allows native page/hand scrolling', async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
  try {
    const page = await context.newPage(); await page.goto('http://127.0.0.1:4179/?longHand');
    const hand = page.locator('.arena-hand-interactive'); await hand.scrollIntoViewIfNeeded();
    const y = await page.evaluate(() => scrollY);
    await hand.locator('[data-hand-index="0"]').tap();
    await expect(page.getByRole('region', { name: 'Selected card actions', exact: true })).toBeInViewport();
    expect(Math.abs((await page.evaluate(() => scrollY)) - y)).toBeLessThanOrEqual(4);
    expect(await page.evaluate(() => window.arenaFixture.events)).toEqual([['select', 'Hand-0']]);
    const dimensions = await hand.evaluate(element => ({ width: element.clientWidth, scroll: element.scrollWidth, touch: getComputedStyle(element).touchAction }));
    expect(dimensions.scroll).toBeGreaterThan(dimensions.width); expect(dimensions.touch).toBe('auto');
    // Native scroll container remains scrollable; browser tap emulation is not a physical swipe test.
    await hand.evaluate(element => { element.scrollLeft = element.scrollWidth; });
    expect(await hand.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
    await page.getByRole('button', { name: 'Inspect', exact: true }).tap();
    await expect(page.getByRole('dialog', { name: 'Card preview', exact: true })).toBeVisible();
    await page.getByRole('dialog', { name: 'Card preview', exact: true }).getByRole('button', { name: 'Close', exact: true }).tap();
    await page.getByRole('button', { name: 'Clear card selection', exact: true }).tap();
    await expect(page.getByRole('region', { name: 'Selected card actions', exact: true })).toHaveCount(0);
  } finally { await context.close(); }
});
test('shrinking a focused hand retains a usable focus target instead of losing keyboard access', async ({ page }) => {
  await page.goto('/?longHand');
  const hand = page.locator('.arena-hand-interactive'); await hand.focus(); await page.keyboard.press('End');
  await expect(hand.locator('[data-hand-index="29"]')).toBeFocused();
  await page.evaluate(() => { const p = window.arenaFixture.props.table.players[0]; p.hand = p.hand.slice(0, 2); p.hand_count = 2; });
  await expect(hand.locator('[data-hand-index="1"]')).toBeFocused();
  await page.evaluate(() => { const p = window.arenaFixture.props.table.players[0]; p.hand = []; p.hand_count = 0; });
  await expect(hand).toBeFocused(); await expect(page.getByText('Your hand is empty.')).toBeVisible();
});
test('discard dialog selects only public cards and opens their preview', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Inspect South player discard: 1 cards' }).click();
  await page.getByRole('dialog', { name: 'Discard pile', exact: true }).getByRole('button', { name: 'Discard-1, 100 of 100 HP', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Card preview', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Card preview', exact: true }).getByRole('heading', { name: 'Discard-1', exact: true })).toBeVisible();
  await expect(page.locator('body')).not.toContainText('SECRET');
});
