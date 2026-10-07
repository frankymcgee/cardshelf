import test from 'node:test';
import assert from 'node:assert/strict';
import { adsenseInput, adsenseReady } from '../lib/adsense-logic.mjs';
import { adsensePagePlan, enterPrivateCard } from '../shared/adsense-policy.mjs';
import { ADSTERRA_CARDSHELF_UNITS as units, adsterraUnit, selectAdsterraUnit, adsterraFrameDocument } from '../shared/adsterra.mjs';
import { startAdsterra } from '../shared/adsterra-browser.mjs';
const nonce = 'e'.repeat(32);
const settings = { provider: 'adsterra', adsterra_units: units, enabled: true, verification_enabled: false, revision: 1,
  password: 'Synthetic password', reason: 'Enable reviewed Adsterra placements', confirm_approval: true, confirm_consent: true, confirm_scope: true };

test('Adsterra can activate without Google IDs and keeps Google settings for switching back', () => {
  const saved = adsenseInput(settings);
  assert.equal(adsenseReady(saved), true); assert.equal(saved.publisher_id, '');
  for (const path of ['/', '/features', '/pricing', '/cards', '/explore', '/marketplace']) {
    const plan = adsensePagePlan(saved, path);
    assert.equal(plan.provider, 'adsterra'); assert.equal(plan.auto_ads, false); assert.equal(plan.slot_id, '');
    assert.deepEqual(plan.adsterra_units, units);
  }
  for (const path of ['/admin/adsense', '/account', '/membership', '/cards?card=en:private', '/marketplace?mine=1', '/arena', '/binders', '/explore?ads=off'])
    assert.equal(adsensePagePlan(saved, path), null, path);
  const google = { publisher_id: 'ca-pub-1234567890123456', slot_id: '1234567890', auto_ads_enabled: true };
  assert.equal(adsenseInput({ ...settings, ...google }).slot_id, google.slot_id);
  const switched = adsenseInput({ ...settings, ...google, provider: 'adsense', confirm_auto_ads: true });
  assert.deepEqual(switched.adsterra_units, units); assert.equal(adsensePagePlan(switched, '/').auto_ads, true);
});
test('activation and unit settings reject incomplete, duplicated and executable input', () => {
  for (const input of [{ adsterra_units: {} }, { adsterra_units: { script: 'alert(1)' } }, { provider: 'other' },
    { adsterra_units: { native: '<script>alert(1)</script>' } }, { adsterra_units: { native: units.native, banner_728x90: units.native } },
    { confirm_approval: false }, { confirm_consent: false }, { confirm_scope: false }])
    assert.throws(() => adsenseInput({ ...settings, ...input }), e => e.status === 400);
  const paused = adsenseInput({ ...settings, enabled: false, adsterra_units: { native: '' }, confirm_approval: false, confirm_consent: false, confirm_scope: false });
  assert.equal(adsenseReady(paused), false); assert.deepEqual(paused.adsterra_units, {});
});
test('sizes fit the actual container before any request; small grids use responsive native ads', () => {
  for (const [width, format] of [[1000, 'banner_728x90'], [600, 'banner_468x60'], [390, 'banner_320x50'], [310, 'banner_300x250']])
    assert.equal(selectAdsterraUnit(units, 'banner', width).format, format);
  assert.equal(selectAdsterraUnit(units, 'banner', 0), null);
  assert.equal(selectAdsterraUnit(units, 'grid', 145).format, 'native');
  assert.equal(selectAdsterraUnit({ banner_300x250: units.banner_300x250 }, 'grid', 240), null);
  assert.equal(selectAdsterraUnit(units, 'rail', 160, 650).format, 'banner_160x600');
  assert.equal(selectAdsterraUnit(units, 'rail', 160, 450).format, 'banner_160x300');
  assert.equal(selectAdsterraUnit(units, 'rail', 160, 200), null);
});
test('banner documents retain the supplied atOptions and native scripts use the matching container', () => {
  for (const [format, key] of Object.entries(units)) {
    const unit = adsterraUnit(format, key), html = adsterraFrameDocument(unit, nonce);
    assert.ok(html.includes(unit.src));
    assert.ok(!html.includes('afders.org')); assert.ok(!html.includes('arwf.org')); assert.ok(!html.includes('/14/'));
    if (format === 'native') assert.ok(html.includes(`id="container-${key}"`));
    else {
      const options = JSON.parse(html.match(/var atOptions=(\{.*?\});/)[1]);
      assert.deepEqual(options, { key, format: 'iframe', height: unit.height, width: unit.width, params: {} });
    }
    assert.ok([...html.matchAll(/<script([^>]*)>/g)].every(match => match[1].includes(`nonce="${nonce}"`)));
  }
  assert.equal(adsterraFrameDocument(adsterraUnit('native', units.native), 'bad'), '');
  assert.equal(adsterraFrameDocument({ format: 'native', key: '<script>' }, nonce), '');
});
test('one request per key survives component remounts and marks the private-screen document boundary', () => {
  const win = { location: { assign(path) { win.destination = path; } } }, doc = { visibilityState: 'visible' };
  const frame = () => ({ isConnected: true, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, getBoundingClientRect: () => ({ width: 728 }) });
  const first = frame(), second = frame(), unit = adsterraUnit('banner_728x90', units.banner_728x90);
  assert.equal(startAdsterra(win, doc, first, unit, nonce, () => true), true);
  assert.ok(!first.attrs.sandbox.includes('allow-same-origin'));
  assert.equal(startAdsterra(win, doc, second, unit, nonce, () => true), false);
  assert.equal(second.srcdoc, undefined);
  assert.equal(enterPrivateCard(win, 'en:demo-1'), true); assert.equal(win.destination, '/cards?ads=off&card=en%3Ademo-1');
  assert.equal(startAdsterra(win, doc, second, adsterraUnit('native', units.native), nonce, () => true), false);
});
test('hidden, disconnected, undersized, ineligible and invalid-nonce frames never request ads', () => {
  const unit = adsterraUnit('banner_728x90', units.banner_728x90);
  for (const change of ['hidden', 'disconnected', 'undersized', 'ineligible', 'nonce']) {
    const win = {}, frame = { isConnected: change !== 'disconnected', setAttribute() {}, getBoundingClientRect: () => ({ width: change === 'undersized' ? 300 : 728 }) };
    const doc = { visibilityState: change === 'hidden' ? 'hidden' : 'visible' };
    assert.equal(startAdsterra(win, doc, frame, unit, change === 'nonce' ? '' : nonce, () => change !== 'ineligible'), false, change);
    assert.equal(frame.srcdoc, undefined); assert.equal(win.__cardshelfAdSenseLoaded, undefined);
  }
});
