import test from 'node:test';
import assert from 'node:assert/strict';
import { effectScope, ref } from 'vue';
import { cardImageSources, CARD_ARTWORK_CSP_SOURCES } from '../shared/card-images.mjs';
import { useCardImage } from '../app/composables/useCardImage.mjs';

const card = (id = 'en:mee-001', extra = {}) => ({ id, game: 'pokemon', language: 'en', image_url: null, ...extra });
const official = n => `https://www.pokemon.com/static-assets/content-assets/cms2/img/cards/web/MEE/MEE_EN_${n}.png`;
const limitless = n => `https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci/MEE/MEE_${String(n).padStart(3, '0')}_R_EN.png`;

test('all eight MEE energies resolve to their exact official and Limitless images without a saved URL', () => {
  for (let n = 1; n <= 8; n++) assert.deepEqual(cardImageSources(card(`en:mee-${String(n).padStart(3, '0')}`)), [
    { url: official(n), source: 'Pokémon' }, { url: limitless(n), source: 'Limitless TCG' }
  ]);
});

test('existing binder and marketplace rows use card_id, not their printing identifier', () => {
  assert.equal(cardImageSources({ card_id: 'en:mee-001', id: 'printing-uuid', local_id: '001', language: 'en' })[0].url, official(1));
  assert.equal(cardImageSources(card('en:mee-1', { local_id: '001', set_id: 'en:mee' }))[0].url, official(1));
});

test('thumbnail failure can recover full-size WebP or PNG before using another site', () => {
  const base = 'https://assets.tcgdex.net/en/me/me01/001';
  const c = card('en:me01-001', { image_url: `${base}/high.webp` });
  const sources = cardImageSources(c);
  assert.deepEqual(sources.slice(0, 3).map(x => x.url), [`${base}/low.webp`, `${base}/high.webp`, `${base}/high.png`]);
  assert.equal(sources.length, 5);
  assert.match(sources[3].url, /\/MEG\/MEG_EN_1\.png$/);
  assert.match(sources[4].url, /\/MEG\/MEG_001_R_EN\.png$/);
  assert.equal(cardImageSources(c, { low: false })[0].url, `${base}/high.webp`);
  assert.equal(cardImageSources(c, { low: false }).length, 4);
});

test('SVE artwork uses exact collector numbers, including later Energy designs', () => {
  assert.match(cardImageSources(card('en:sve-024'))[0].url, /\/SVE\/SVE_EN_24\.png$/);
  assert.match(cardImageSources(card('en:sve-009'))[1].url, /\/SVE\/SVE_009_R_EN\.png$/);
});

test('unknown sets, unsupported numbers, mismatched metadata and other languages never borrow English artwork', () => {
  for (const c of [card('ja:mee-001', { language: 'ja' }), card('en:mee-001', { language: 'ja' }),
    card('en:mee-001', { game: 'mtg' }), card('en:mee-001', { local_id: '002' }),
    card('en:mee-001', { set_id: 'en:me01' }), card('en:mee-001', { number: '1a' }),
    card('en:mee-000'), card('en:mee-009'), card('en:sve-025'), card('en:me01-189'),
    card('en:constructor-001'), card('en:unknown-001'), card('training:grass'), { name: 'Grass Energy', set_name: 'Mega Evolution Energy' }]) {
    assert.deepEqual(cardImageSources(c), [], JSON.stringify(c));
  }
});

test('local artwork and Japanese TCGdex images keep their existing identities', () => {
  const local = '/api/public/catalogue/artwork/' + 'a'.repeat(64);
  assert.deepEqual(cardImageSources({ game: 'mtg', image_url: local }), [{ url: local, source: 'Catalogue' }]);
  const source = 'https://assets.tcgdex.net/ja/sm/SM1+/001/high.webp';
  assert.ok(cardImageSources({ id: 'ja:SM1+-001', language: 'ja', image_url: source }).every(x => x.url.startsWith('https://assets.tcgdex.net/ja/')));
});

test('image targets are bounded and cannot introduce arbitrary hosts or URL schemes', () => {
  for (const image_url of ['javascript:alert(1)', 'data:image/svg+xml,x', '//evil.test/x', '/\\evil.test/x',
    'http://assets.tcgdex.net/x', 'https://assets.tcgdex.net.evil.test/x', 'https://user@assets.tcgdex.net/x',
    'https://assets.tcgdex.net:8443/x', 'https://assets.tcgdex.net/x?redirect=evil',
    'https://www.pokemon.com/other-path/image.png', 'https://127.0.0.1/image.png']) {
    assert.deepEqual(cardImageSources({ image_url }), [], image_url);
  }
  for (const source of cardImageSources(card())) assert.ok(CARD_ARTWORK_CSP_SOURCES.split(' ').some(prefix => source.url.startsWith(prefix)));
  assert.equal(CARD_ARTWORK_CSP_SOURCES.includes('*'), false);
});

test('hidden cards never have candidates and duplicate candidates are not retried', () => {
  assert.deepEqual(cardImageSources(card('en:mee-001', { hidden: true, image_url: official(1) })), []);
  assert.equal(cardImageSources(card('en:mee-001', { image_url: official(1) })).length, 2);
});

test('image state exhausts once, resets for recycled cards and ignores stale errors', () => {
  const scope = effectScope();
  try {
    scope.run(() => {
      const c = ref(card()), low = ref(true), state = useCardImage(c, low);
      const fail = url => state.imageFailed({ target: { getAttribute: () => url } });
      assert.equal(state.image.value, official(1));
      fail(official(1)); assert.equal(state.image.value, limitless(1));
      fail(limitless(1)); assert.equal(state.image.value, undefined);
      fail(limitless(1)); assert.equal(state.image.value, undefined);
      c.value = card('en:mee-002'); assert.equal(state.image.value, official(2));
      fail(official(1)); assert.equal(state.image.value, official(2));
      c.value = card('en:mee-002', { image_url: 'https://assets.tcgdex.net/en/me/mee/002/high.webp' });
      assert.match(state.image.value, /low\.webp$/);
      low.value = false; assert.match(state.image.value, /high\.webp$/);
    });
  } finally { scope.stop(); }
});
