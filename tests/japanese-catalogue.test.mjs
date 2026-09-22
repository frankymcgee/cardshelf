import test from 'node:test';
import assert from 'node:assert/strict';
import { remoteSets, fetchProvider } from '../lib/provider.mjs';
import { providerId, cardId } from '../lib/validate.mjs';
import { gameFromCardId } from '../shared/games.mjs';

// TCGdex uses a literal plus in Japanese expansion IDs (for example SM1+).
// Fixture responses keep these tests deterministic and independent of the API.
const japaneseSets = [
  { id: 'SV1S', name: 'スカーレットex', cardCount: { total: 108 } },
  { id: 'SM1+', name: 'サン＆ムーン', cardCount: { total: 51 } },
  { id: 'SM2+', name: '新たなる試練の向こう', cardCount: { total: 49 } },
  { id: 'SM3+', name: 'ひかる伝説', cardCount: { total: 82 } },
  { id: 'SM5+', name: 'ウルトラフォース', cardCount: { total: 78 } }
];
const badRequest = error => error?.status === 400;
function mockJson(t, value) {
  return t.mock.method(globalThis, 'fetch', async () => Response.json(value));
}

test('Japanese set index retains plus-ID expansions instead of rejecting the whole list', async t => {
  const request = mockJson(t, japaneseSets);
  assert.deepEqual(await remoteSets('ja'), japaneseSets.map(set => ({
    id: set.id, name: set.name, card_count: set.cardCount.total
  })));
  assert.equal(request.mock.calls.length, 1);
  assert.equal(request.mock.calls[0].arguments[0], 'https://api.tcgdex.net/v2/ja/sets');
});

test('TCGdex set and card IDs preserve literal plus signs and case', () => {
  for (const id of ['SM1+', 'SM2+', 'SM3+', 'SM5+', 'SM1+-001', 'SM3+-082']) {
    assert.equal(providerId(id), id);
  }
  assert.equal(providerId(' SM1+ '), 'SM1+');
});

test('Japanese plus-ID cards pass card lookup and game-access identity checks', () => {
  for (const id of ['ja:SM1+-001', 'ja:SM2+-001', 'ja:SM3+-082', 'ja:SM5+-001']) {
    assert.equal(cardId(id), id);
    assert.equal(gameFromCardId(id), 'pokemon');
  }
});

test('existing English and Japanese card IDs remain valid', () => {
  for (const id of ['en:base1-1', 'en:swsh12.5-160', 'ja:SV1S-001', 'ja:S-P-001']) {
    assert.equal(cardId(id), id);
    assert.equal(gameFromCardId(id), 'pokemon');
  }
});

test('plus support does not relax other games or introduce new language prefixes', () => {
  assert.equal(gameFromCardId('yugioh:en:12345'), 'yugioh');
  assert.equal(gameFromCardId('mtg:en:abc-123'), 'mtg');
  for (const id of ['yugioh:en:123+45', 'mtg:en:abc+123', 'fr:SM1+-001', 'pokemon:ja:SM1+-001']) {
    assert.equal(gameFromCardId(id), null);
    assert.throws(() => cardId(id), badRequest);
  }
});

test('Japanese set detail requests encode plus exactly once', async t => {
  const response = { id: 'SM1+', cards: [{ id: 'SM1+-001' }] };
  const request = mockJson(t, response);
  assert.deepEqual(await fetchProvider('ja', 'sets/SM1+'), response);
  const url = new URL(request.mock.calls[0].arguments[0]);
  assert.equal(url.href, 'https://api.tcgdex.net/v2/ja/sets/SM1%2B');
  assert.equal(decodeURIComponent(url.pathname.split('/').at(-1)), 'SM1+');
  assert.equal(url.search, '');
  assert.equal(url.hash, '');
});

test('Japanese card detail requests preserve the provider identity', async t => {
  const response = { id: 'SM1+-001', set: { id: 'SM1+' }, name: 'モクロー' };
  const request = mockJson(t, response);
  const raw = await fetchProvider('ja', 'cards/SM1+-001');
  assert.equal(request.mock.calls[0].arguments[0], 'https://api.tcgdex.net/v2/ja/cards/SM1%2B-001');
  assert.equal(raw.id, providerId('SM1+-001'));
  assert.equal(raw.set.id, providerId('SM1+'));
  assert.equal(cardId('ja:' + raw.id), 'ja:SM1+-001');
});

test('English set index behavior is unchanged', async t => {
  mockJson(t, [{ id: 'base1', name: 'Base Set', cardCount: { total: 102 } }]);
  assert.deepEqual(await remoteSets('en'), [{ id: 'base1', name: 'Base Set', card_count: 102 }]);
});

test('existing provider endpoints keep their original URLs', async t => {
  const request = mockJson(t, {});
  for (const path of ['sets', 'cards', 'sets/base1', 'cards/swsh12.5-160']) {
    await fetchProvider('en', path);
    assert.equal(request.mock.calls.at(-1).arguments[0], 'https://api.tcgdex.net/v2/en/' + path);
  }
});

test('catalogue ID validation still rejects URL syntax, encoded input and path traversal', () => {
  for (const id of ['../SM1+', 'SM1+/001', 'SM1+\\001', 'SM1+?x=1', 'SM1+#fragment',
    'SM1%2B', 'SM1%252B', 'SM1%2F001', 'SM1+&x=1', 'SM1+@example.com', 'SM1+ 001',
    'SM1+\u0000', 'SM1+\n001', '+SM1', 'https://example.com', '', null, 42, {}]) {
    assert.throws(() => providerId(id), badRequest, String(id));
  }
});

test('provider and local Pokemon identity length limits still apply', () => {
  const max = 'S' + '+'.repeat(99);
  assert.equal(providerId(max), max);
  assert.equal(cardId('ja:' + max), 'ja:' + max);
  assert.throws(() => providerId(max + '+'), badRequest);
  assert.throws(() => cardId('ja:' + max + '+'), badRequest);
});

test('unsafe provider paths fail before any network request', async t => {
  const request = mockJson(t, {});
  for (const path of ['sets/../cards', 'sets/SM1+/001', 'sets/SM1+\\001', 'sets/SM1+?x=1',
    'sets/SM1+#fragment', 'sets/SM1%2B', 'sets/SM1%252B', 'sets/%2e%2e',
    'https://example.com/sets/SM1+', '//example.com', 'sets//SM1+', 'series/SM1+',
    'sets/', 'sets/+SM1', 'sets/SM1+\n001', null, 42, {}]) {
    await assert.rejects(fetchProvider('ja', path), badRequest, String(path));
  }
  assert.equal(request.mock.calls.length, 0);
});

test('unsupported provider languages fail before any network request', async t => {
  const request = mockJson(t, {});
  for (const lang of ['jp', 'fr', '../ja', 'ja?x=1', null]) {
    await assert.rejects(fetchProvider(lang, 'sets'), badRequest);
  }
  assert.equal(request.mock.calls.length, 0);
});

test('set index continues to ignore incomplete rows without losing valid Japanese sets', async t => {
  mockJson(t, [null, {}, { id: 123, name: 'Invalid' }, { id: 'SV1S' }, japaneseSets[1]]);
  assert.deepEqual(await remoteSets('ja'), [{ id: 'SM1+', name: 'サン＆ムーン', card_count: 51 }]);
});

test('set index still rejects unsafe provider IDs rather than returning selectable bad data', async t => {
  mockJson(t, [{ id: 'SM1+/../cards', name: 'Unsafe' }]);
  await assert.rejects(remoteSets('ja'), badRequest);
});

test('invalid upstream index shape is still reported as a provider error', async t => {
  mockJson(t, { error: 'upstream failure' });
  await assert.rejects(remoteSets('ja'), error => error?.status === 502);
});
