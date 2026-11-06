import test from 'node:test';
import assert from 'node:assert/strict';
import { portfolioAllocation, portfolioMovers } from '../lib/portfolio-logic.mjs';
const now = Date.parse('2026-11-06T12:00:00Z');
const rates = [{ currency: 'USD', aud_rate: 1.5, rate_date: '2026-11-06' }];
const row = (printing_id, game, amount, quantity = 1) => ({ printing_id, game, quantity, source: 'tcgdex', key: 'normal',
  fetched_at: new Date(now).toISOString(), quotes: amount == null ? [] : [{ source: 'TCGplayer', variant: 'normal',
    currency: 'USD', metric: 'marketPrice', amount, source_updated_at: new Date(now).toISOString() }] });
const holding = (printing_id, quantity, unit_aud, basis = 'same') => ({ printing_id, quantity, unit_aud, basis });
const point = (day, holdings) => ({ snapshot_date: `2026-11-0${day}`, holdings });
const cards = ['a', 'b', 'new', 'removed'].map(id => ({ printing_id: id, card_id: `en:${id}`, name: id,
  label: 'Normal', game: 'pokemon', language: 'en', set_name: 'Fixture', local_id: id, notes: 'private' }));
test('allocation uses owned quantities and keeps entirely unpriced games unknown', () => {
  const result = portfolioAllocation([row('a', 'pokemon', 10, 2), row('b', 'pokemon', null, 3), row('c', 'mtg', 4), row('d', 'yugioh', null)], rates, now);
  assert.deepEqual(result.map(r => [r.game, r.aud_total, r.quantity, r.priced_quantity]), [['pokemon', 30, 5, 2], ['mtg', 6, 1, 1], ['yugioh', null, 1, 0]]);
  assert.deepEqual(portfolioAllocation([], rates, now), []);
});
test('movers rank retained copy changes without counting new purchases or removed cards', () => {
  const before = point(4, [holding('a', 2, 10), holding('b', 4, 20), holding('removed', 9, 50)]);
  const after = point(6, [holding('a', 6, 15), holding('b', 2, 16), holding('new', 50, 100)]);
  const result = portfolioMovers(before, after, cards);
  assert.equal(result.comparable_printings, 2);
  assert.deepEqual(result.gainers.map(r => [r.printing_id, r.quantity, r.change_aud, r.percent]), [['a', 2, 10, 50]]);
  assert.deepEqual(result.decliners.map(r => [r.printing_id, r.quantity, r.change_aud, r.percent]), [['b', 2, -8, -20]]);
  assert.ok(!JSON.stringify(result).includes('private'));
});
test('price coverage, provider changes, zero and invalid prices cannot become movers', () => {
  for (const [old, current] of [[null, 10], [10, null], [0, 10], [10, Infinity], [10, NaN]]) {
    const result = portfolioMovers(point(4, [holding('a', 2, old)]), point(6, [holding('a', 2, current)]), cards);
    assert.equal(result.comparable_printings, 0); assert.deepEqual(result.gainers, []); assert.deepEqual(result.decliners, []);
  }
  assert.equal(portfolioMovers(point(4, [holding('a', 1, 5)]), point(6, [holding('a', 1, 10, 'different source')]), cards).comparable_printings, 0);
});
test('no history and unchanged prices have distinct empty states', () => {
  assert.equal(portfolioMovers(null, point(6, []), cards), null);
  assert.equal(portfolioMovers(point(6, []), point(6, []), cards), null);
  const result = portfolioMovers(point(4, [holding('a', 1, 5)]), point(6, [holding('a', 1, 5)]), cards);
  assert.equal(result.comparable_printings, 1); assert.deepEqual(result.gainers, []);
});
test('movers are bounded and ordered by AUD impact with deterministic ties', () => {
  const metadata = Array.from({ length: 8 }, (_, i) => ({ printing_id: String(i) }));
  const old = metadata.map(r => holding(r.printing_id, 1, 1));
  const current = metadata.map((r, i) => holding(r.printing_id, 1, i + 2));
  assert.deepEqual(portfolioMovers(point(4, old), point(6, current), metadata).gainers.map(r => r.printing_id), ['7', '6', '5']);
});
