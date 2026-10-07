import { test, expect } from '@playwright/test';
import { fixtures } from './ads-fixtures.mjs';
import { ADSTERRA_CARDSHELF_UNITS as units } from '../../shared/adsterra.mjs';
import { adsensePageKind } from '../../shared/adsense-policy.mjs';
import { adsenseCsp, nonceScriptTags } from '../../lib/adsense-logic.mjs';

async function liveFixtures(page, { deny = false, fail = false } = {}) {
  const fixture = await fixtures(page, { count: 8, provider: 'adsterra', initialMode: 'live' });
  const seen = [], nonce = 'c'.repeat(32);
  await page.route('**/api/ads/adsense**', route => {
    const path = new URL(route.request().url()).searchParams.get('path'), kind = adsensePageKind(path);
    return route.fulfill({ json: deny || !kind ? { eligible: false } : {
      eligible: true, provider: 'adsterra', adsterra_units: units, page_kind: kind, revision: 1
    } });
  });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname === 'bicea.org') {
      seen.push(url.pathname);
      if (fail) return route.abort('blockedbyclient');
      const key = url.pathname.split('/').at(-1);
      // Synthetic creatives exercise the supplied synchronous loader contract.
      const js = url.pathname.startsWith('/22/')
        ? `if(atOptions.key!=='${key}')throw Error('Unit configuration crossed frames');document.write('<div style="width:'+atOptions.width+'px;height:'+atOptions.height+'px;background:#dfecff">Banner fixture</div>')`
        : `document.getElementById('container-${key}').innerHTML='<div style="height:190px;background:#dfecff">Native fixture</div>'`;
      return route.fulfill({ contentType: 'application/javascript', body: js });
    }
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) return route.abort();
    if (route.request().resourceType() === 'document') {
      const response = await route.fetch();
      const html = nonceScriptTags(await response.text(), nonce).replace('</head>',
        '<meta name="cardshelf-adsense-revision" content="1"><meta name="cardshelf-ad-provider" content="adsterra"></head>');
      return route.fulfill({ response, body: html, headers: { ...response.headers(), 'content-security-policy': adsenseCsp(nonce) } });
    }
    return route.fallback();
  });
  return { ...fixture, seen };
}

test('Adsterra preset saves every supplied inline unit through the provider selector', async ({ page }) => {
  const { saves, requests, errors } = await fixtures(page);
  await page.goto('/admin/adsense');
  await page.getByRole('combobox', { name: 'Advertising provider' }).selectOption('adsterra');
  await page.getByRole('button', { name: "Load CardShelf's seven units" }).click();
  await expect(page.getByRole('textbox', { name: 'Mobile banner unit key' })).toHaveValue(units.banner_320x50);
  await page.screenshot({ path: `test-results/ads/adsterra-admin-${test.info().project.name}.png`, fullPage: true });
  await page.getByLabel('Reason for change').fill('Configure supplied Adsterra units');
  await page.getByLabel('Current administrator password').fill('fixture-password');
  await page.getByRole('button', { name: 'Save advertising settings' }).click();
  await expect.poll(() => saves.length).toBe(1);
  expect(saves[0].provider).toBe('adsterra'); expect(saves[0].adsterra_units).toEqual(units);
  await expect(page.getByRole('button', { name: 'Save advertising settings' })).toBeEnabled();
  expect(requests).toEqual([]); expect(errors).toEqual([]);
});
test('Adsterra previews use the active provider even when the ad endpoint is blocked', async ({ page }) => {
  const { requests, errors } = await fixtures(page, { count: 8, blocked: true, provider: 'adsterra' });
  for (const path of ['/', '/pricing', '/cards', '/marketplace']) {
    await page.goto(path);
    const preview = page.getByTestId('adsterra-preview').first();
    await expect(preview).toBeVisible();
    expect(await page.locator('iframe[srcdoc]').count()).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  expect(requests).toEqual([]); expect(errors).toEqual([]);
});
test('only the fitting banner loads under production CSP; private navigation replaces the document', async ({ page }) => {
  const { seen, errors } = await liveFixtures(page);
  await page.goto('/');
  const frame = page.locator('.adsterra-placement iframe');
  await frame.scrollIntoViewIfNeeded();
  await expect(frame).toHaveAttribute('srcdoc', /atOptions/);
  await expect(frame.contentFrame().getByText('Banner fixture')).toBeVisible();
  await page.screenshot({ path: `test-results/ads/adsterra-banner-${test.info().project.name}.png` });
  const expected = page.viewportSize().width < 768 ? units.banner_320x50 : units.banner_728x90;
  expect(seen).toEqual(['/22/' + expected]);
  expect(await page.evaluate(() => window.atOptions)).toBeUndefined();
  await page.evaluate(() => { window.__adsterraTestDocument = true; window.dispatchEvent(new Event('focus')); });
  expect(seen).toHaveLength(1);
  await page.setViewportSize({ width: 310, height: 844 });
  await expect(frame).toHaveCount(0);
  expect(seen).toHaveLength(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  // A real in-app link invokes the navigation boundary, not page.goto().
  await page.getByRole('link', { name: /sign in/i }).first().click();
  await expect(page).toHaveURL(/\/login/);
  expect(await page.evaluate(() => window.__adsterraTestDocument)).toBeUndefined();
  expect(errors).toEqual([]);
});
test('native grids resize without duplicate units when switching catalogue views', async ({ page }) => {
  const { seen, errors } = await liveFixtures(page);
  await page.goto('/cards');
  const frame = page.locator('.adsterra-placement iframe');
  await frame.scrollIntoViewIfNeeded();
  await expect(frame.contentFrame().getByText('Native fixture')).toBeVisible();
  await expect(frame).toHaveAttribute('height', '190');
  await page.screenshot({ path: `test-results/ads/adsterra-native-${test.info().project.name}.png` });
  expect(seen).toEqual(['/21/' + units.native]);
  await page.getByRole('button', { name: 'List view', exact: true }).click();
  await page.getByRole('button', { name: 'Grid view', exact: true }).click();
  expect(seen.filter(path => path === '/21/' + units.native)).toHaveLength(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});
test('ineligible pages and blocked scripts do not fall back to another provider or retry', async ({ page }) => {
  const { seen } = await liveFixtures(page, { fail: true });
  await page.goto('/');
  await page.locator('.adsterra-placement iframe').scrollIntoViewIfNeeded();
  await expect.poll(() => seen.length).toBe(1);
  await expect(page.locator('iframe[srcdoc]')).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  expect(seen).toHaveLength(1);
  await page.goto('/admin/adsense');
  await expect(page.locator('iframe[srcdoc]')).toHaveCount(0);
  expect(seen).toHaveLength(1);
});
