import test from 'node:test';
import assert from 'node:assert/strict';
import { completionPrices } from '../lib/binder-completion-prices.mjs';
const now = Date.parse('2026-11-06T12:00:00Z'), date = new Date(now).toISOString();
const rates = [{ currency: 'USD', aud_rate: 1.5, rate_date: '2026-11-06' }, { currency: 'EUR', aud_rate: 1.7, rate_date: '2026-11-06' }];
const item = (id, quantity = 0) => ({ printing_id: id, owned_quantity: quantity, positions: [0, 1, 2] });
const row = (id, amount) => ({ printing_id: id, key: 'normal', source: 'tcgdex', fetched_at: date,
  quotes: [{ source: 'TCGplayer', variant: 'normal', currency: 'USD', metric: 'marketPrice', amount, source_updated_at: date }] });
test('completion estimates one copy per missing printing and excludes owned unchecked targets', () => {
  const result = completionPrices([item('a'), item('b', 1), item('c')], [row('a', 10), row('b', 100), row('c', 2)], rates, now);
  assert.equal(result.summary.aud_total, 18); assert.equal(result.summary.quantity, 2);
  assert.equal(result.summary.needed_printings, 2); assert.equal(result.summary.already_owned_printings, 1);
  assert.equal(result.estimates[0].estimate.aud, 15); assert.equal(result.estimates[1].estimate, null);
});
test('partial coverage stays partial; entirely unpriced and absent FX are never zero costs', () => {
  const partial = completionPrices([item('a'), item('b')], [row('a', 10)], rates, now);
  assert.equal(partial.summary.aud_total, 15); assert.equal(partial.summary.unpriced_quantity, 1);
  const missing = completionPrices([item('b')], [], rates, now); assert.equal(missing.summary.aud_total, null);
  const fx = completionPrices([item('a')], [row('a', 10)], [], now); assert.equal(fx.summary.aud_total, null); assert.equal(fx.summary.fx_missing_quantity, 1); assert.equal(fx.estimates[0].estimate, null);
});
test('no purchases needed is a real zero, including an already-owned Tracking checklist', () => {
  for (const items of [[], [item('a', 2)]]) assert.equal(completionPrices(items, [], rates, now).summary.aud_total, 0);
});
test('stale matched quotes are excluded; stale guide estimates retain their warnings', () => {
  const stale = { ...row('a', 10), fetched_at: '2026-10-01T00:00:00Z' };
  const result = completionPrices([item('a')], [stale], rates, now);
  assert.equal(result.summary.aud_total, null); assert.equal(result.summary.stale_quantity, 1); assert.equal(result.estimates[0].estimate, null);
  const guide = { ...stale, last_error: 'failed', quotes: [], reference_prices: [{ source: 'Cardmarket', variant: 'card-reference',
    metric: 'trend', currency: 'EUR', amount: 4, source_updated_at: '2026-10-01T00:00:00Z' }] };
  const priced = completionPrices([item('a')], [guide], rates, now);
  assert.equal(priced.summary.aud_total, 6.8); assert.equal(priced.summary.approximate_quantity, 1);
  assert.equal(priced.summary.stale_reference_quantity, 1); assert.equal(priced.summary.failed_reference_quantity, 1);
  assert.equal(priced.estimates[0].estimate.approximate, true); assert.equal(priced.estimates[0].estimate.stale, true);
});
test('small raw values use the existing unrounded aggregation and rounding policy', () => {
  const result = completionPrices([item('a'), item('b'), item('c')], ['a', 'b', 'c'].map(id => row(id, .1111)), rates, now);
  assert.equal(result.summary.aud_total, .5); assert.equal(result.estimates[0].estimate.aud, .17);
});
