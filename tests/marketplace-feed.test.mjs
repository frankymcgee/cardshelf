import test from 'node:test';
import assert from 'node:assert/strict';
import { marketplaceAffiliateRows } from '../shared/marketplace-feed.mjs';
import { marketplaceAdRows } from '../shared/adsense-policy.mjs';
const links = Array.from({ length: 12 }, (_, i) => ({ id: String(i), href: 'https://shop.example.com/' + i + '?ref=unchanged%2Bcode' }));
for (const length of [0, 1, 6, 24]) test('affiliate mixing preserves every listing, its order and the ad: ' + length, () => {
  const base = marketplaceAdRows(Array.from({ length }, (_, i) => ({ id: i, price_minor: i * 100 }))), before = structuredClone(base);
  const rows = marketplaceAffiliateRows(base, links, 987654);
  assert.deepEqual(rows.filter(row => row.kind !== 'affiliate'), base);
  assert.deepEqual(rows.filter(row => row.kind === 'affiliate').map(row => row.item).sort((a, b) => Number(a.id) - Number(b.id)), links);
  assert.equal(new Set(rows.map(row => row.key)).size, rows.length);
  assert.equal(rows.filter(row => row.kind === 'ad').length, 1);
  assert.deepEqual(base, before);
  assert.deepEqual(rows, marketplaceAffiliateRows(base, structuredClone(links), 987654));
});
test('different visits vary placement while a fixed visit never reshuffles on a URL change', () => {
  const base = marketplaceAdRows(Array.from({ length: 24 }, (_, i) => ({ id: i })));
  const order = (seed, items = links) => marketplaceAffiliateRows(base, items, seed).map(row => row.key);
  assert.notDeepEqual(order(1), order(2));
  assert.deepEqual(order(1), order(1, links.map(item => ({ ...item, href: item.href + '&q=binder' }))));
  const rows = marketplaceAffiliateRows(base, links, 1);
  // With enough listings, separate affiliate tiles with at least one existing row.
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i - 1].kind !== 'affiliate' || rows[i].kind !== 'affiliate');
});
test('affiliate-only and empty feeds need no fabricated listing or count', () => {
  assert.deepEqual(marketplaceAffiliateRows(undefined, undefined), []);
  assert.equal(marketplaceAffiliateRows([], links, 1).length, links.length);
  const base = [{ key: 'sale:1', kind: 'sale', item: { id: 1 } }];
  assert.deepEqual(marketplaceAffiliateRows(base, []), base);
  assert.notEqual(marketplaceAffiliateRows(base, []), base);
});
