import test from 'node:test';
import assert from 'node:assert/strict';
import { snapshotValuation, valueHistoryChange } from '../lib/value-history-logic.mjs';
import { cardHistorySeries, historyCutoff, historySegments } from '../shared/value-history.mjs';
const date = '2026-09-27T12:00:00Z', now = Date.parse(date);
const fx = [{ currency: 'USD', aud_rate: '1.5', rate_date: '2026-09-27' }, { currency: 'EUR', aud_rate: '1.7', rate_date: '2026-09-27' }];
const quote = { source: 'TCGplayer', variant: 'normal', currency: 'USD', metric: 'marketPrice', amount: 10, source_updated_at: date };
const row = { printing_id: 'card-one', source: 'tcgdex', key: 'normal', quotes: [quote], fetched_at: date, quantity: 2 };
const snapshot = (rows, rates = fx, day = '2026-09-27') => ({ snapshot_date: day, ...snapshotValuation(rows, rates, now) });
const old = rows => snapshot(rows, fx, '2026-09-26');
test('snapshot retains actual quantities, unrounded AUD basis and FX date', () => {
  const result = snapshot([{ ...row, quantity: 3, quotes: [{ ...quote, amount: 0.1111 }] }]);
  assert.equal(result.valuation.aud_total, 0.5); assert.ok(Math.abs(result.holdings[0].unit_aud - 0.16665) < 1e-12);
  assert.equal(result.holdings[0].fx_rate, 1.5); assert.equal(result.holdings[0].fx_date, '2026-09-27');
});
test('adding copies and simultaneous price/FX movement are separated', () => {
  const before = old([row]), after = snapshot([{ ...row, quantity: 3, quotes: [{ ...quote, amount: 12 }] }], [{ ...fx[0], aud_rate: 1.6 }]);
  const change = valueHistoryChange(before, after);
  assert.equal(change.total_aud, 27.6); assert.equal(change.price_fx_aud, 8.4); assert.equal(change.quantity_aud, 19.2);
  assert.equal(change.coverage_aud, 0); assert.equal(change.added_quantity, 1); assert.equal(change.removed_quantity, 0);
  assert.equal(before.valuation.aud_total, 30, 'the historical basis is never recalculated');
});
test('removed copies use the earlier basis; retained copies reflect movement', () => {
  const change = valueHistoryChange(old([{ ...row, quantity: 5 }]), snapshot([{ ...row, quantity: 2, quotes: [{ ...quote, amount: 12 }] }]));
  assert.equal(change.total_aud, -39); assert.equal(change.quantity_aud, -45); assert.equal(change.price_fx_aud, 6);
  assert.equal(change.removed_quantity, 3);
});
test('new and removed printings are quantity changes even when net copy count is unchanged', () => {
  const change = valueHistoryChange(old([row]), snapshot([{ ...row, printing_id: 'other', quotes: [{ ...quote, amount: 20 }] }]));
  assert.equal(change.quantity_aud, 30); assert.equal(change.price_fx_aud, 0); assert.equal(change.added_quantity, 2); assert.equal(change.removed_quantity, 2);
});
test('provider and metric switches are coverage changes, not market gains', () => {
  const after = snapshot([{ ...row, quotes: [], reference_prices: [{ source: 'Cardmarket', variant: 'card-reference', currency: 'EUR', metric: 'trend', amount: 20, source_updated_at: date }] }]);
  const change = valueHistoryChange(old([row]), after);
  assert.equal(after.valuation.approximate_quantity, 2); assert.equal(change.coverage_aud, 38); assert.equal(change.price_fx_aud, 0);
});
test('lost price coverage changes a partial estimate without masquerading as a price drop', () => {
  const before = old([row, { ...row, printing_id: 'other' }]);
  const after = snapshot([row, { ...row, printing_id: 'other', quotes: [] }]);
  const change = valueHistoryChange(before, after);
  assert.equal(after.valuation.unpriced_quantity, 2); assert.equal(change.total_aud, -30); assert.equal(change.coverage_aud, -30); assert.equal(change.price_fx_aud, 0);
});
test('empty, unpriced, failed matched and missing FX snapshots never invent zero prices', () => {
  for (const rows of [[], [{ ...row, quotes: [] }], [{ ...row, last_error: 'Unavailable' }]]) assert.equal(snapshot(rows).valuation.aud_total, null);
  const missing = snapshot([row], []); assert.equal(missing.valuation.aud_total, null); assert.equal(missing.holdings[0].unit_aud, null);
  assert.equal(missing.valuation.fx_missing_quantity, 2);
  assert.equal(valueHistoryChange(old([row]), missing).total_aud, null);
});
test('included stale/failed approximations keep their coverage flags in each snapshot', () => {
  const value = snapshot([{ ...row, quotes: [], last_error: 'Unavailable', reference_prices: [{ source: 'Cardmarket', variant: 'card-reference', currency: 'EUR', metric: 'trend', amount: 5, source_updated_at: '2026-08-01T00:00:00Z' }] }]).valuation;
  assert.equal(value.aud_total, 17); assert.equal(value.approximate_quantity, 2); assert.equal(value.stale_reference_quantity, 2); assert.equal(value.failed_reference_quantity, 2);
});
test('one day is not a trend and no percentage is invented from a missing baseline', () => {
  const current = snapshot([row]); assert.equal(valueHistoryChange(current, current), null); assert.equal(valueHistoryChange(undefined, current), null);
  assert.equal(valueHistoryChange(old([{ ...row, quotes: [] }]), current).percent, null);
});
test('rounded change parts reconcile over realistic quantity, price and currency changes', () => {
  for (let i = 1; i <= 80; i++) {
    const before = old([{ ...row, quantity: i % 7 + 1, quotes: [{ ...quote, amount: i / 13 }] }]);
    const after = snapshot([{ ...row, quantity: i % 5 + 1, quotes: [{ ...quote, amount: i / 11 }] }], [{ ...fx[0], aud_rate: 1.51234567 }]);
    const change = valueHistoryChange(before, after);
    assert.equal(Math.round((change.price_fx_aud + change.quantity_aud + change.coverage_aud) * 100), Math.round(change.total_aud * 100));
  }
});
test('chart range is inclusive in UTC across year and leap-day boundaries', () => {
  assert.equal(historyCutoff('2026-01-01', 7), '2025-12-26'); assert.equal(historyCutoff('2024-03-01', 7), '2024-02-24');
});
test('chart lines break at missing days and null prices but preserve real zero observations', () => {
  const points = [1, 2, 4, 5, 6, 7].map((n, i) => ({ date: `2026-09-0${n}`, value: i === 3 ? null : i }));
  assert.deepEqual(historySegments(points), [[0, 1], [2], [4, 5]]);
});
test('card history never merges sources, currencies, finishes or metrics and keeps latest daily observations', () => {
  const observations = [quote, { ...quote, amount: 13, source_updated_at: '2026-09-27T22:00:00Z' }, { ...quote, variant: 'holo' }, { ...quote, currency: 'EUR' }, { ...quote, source: 'Cardmarket' }, { ...quote, metric: 'avg7' }, { ...quote, amount: NaN }, { ...quote, source_updated_at: null }];
  const series = cardHistorySeries(observations);
  assert.equal(series.length, 5); assert.equal(series.find(s => s.label === 'TCGplayer · Normal · Market price · USD').points[0].value, 13);
  assert.ok(series.every(s => s.points.length === 1));
});
