import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';
import * as Vue from 'vue';
import { renderToString } from 'vue/server-renderer';
import { parse, compileScript } from '@vue/compiler-sfc';
import * as contract from '../shared/arena.mjs';
import { useCardImage } from '../app/composables/useCardImage.mjs';
import * as artwork from '../shared/arena-art.mjs';
import { tableFixture } from './helpers/arena-table-fixtures.mjs';
const require = createRequire(import.meta.url), cache = new Map();
function component(file) {
  if (cache.has(file)) return cache.get(file);
  const { descriptor, errors } = parse(fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8'), { filename: file });
  assert.deepEqual(errors, []);
  const compiled = compileScript(descriptor, { id: file, inlineTemplate: true });
  const js = ts.transpileModule(compiled.content, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const output = { exports: {} };
  const localRequire = name => name.endsWith('.vue') ? { default: component(path.posix.normalize(path.posix.join(path.posix.dirname(file), name))) } : name.endsWith('/arena.mjs') ? contract : name.endsWith('/arena-art.mjs') ? artwork : name.endsWith('/useCardImage.mjs') ? { useCardImage } : require(name);
  vm.runInNewContext(js, { ...Vue, exports: output.exports, module: output, require: localRequire, console }, { filename: file });
  cache.set(file, output.exports.default); return output.exports.default;
}
const render = props => renderToString(Vue.createSSRApp(component('app/components/arena/ArenaBoard.vue'), props));
test('illustrations belong only to disclosed original cards; catalogue images keep priority', async () => {
  const card = { id: 'training:ember-cub', name: 'Ember Cub', kind: 'pokemon', type: 'Fire', hp: 80 };
  const face = props => renderToString(Vue.createSSRApp(component('app/components/arena/ArenaCard.vue'), props));
  assert.match(await face({ card }), /training-art\.webp/);
  assert.doesNotMatch(await face({ unit: { hidden: true, card } }), /training-art\.webp|Ember Cub/);
  const catalogue = await face({ card: { ...card, image_url: '/catalogue-card.webp' } });
  assert.match(catalogue, /src="\/catalogue-card.webp"/);
  assert.doesNotMatch(catalogue, /training-art\.webp/);
  assert.doesNotMatch(await face({ card: { ...card, id: 'catalogue:unavailable' } }), /training-art\.webp/);
});
test('discard tops use disclosed artwork, with no faces from a hidden top or an empty pile', async () => {
  const props = tableFixture();
  props.table.players[0].discard[0].card.image_url = '/disclosed-discard.png';
  props.table.players[1].discard[0] = { hidden: true, card: { name: 'SECRET', image_url: '/SECRET.png' } };
  const html = await render(props);
  assert.match(html, /src="\/disclosed-discard.png"/);
  assert.doesNotMatch(html, /SECRET/);
  props.table.players[0].discard = [];
  assert.doesNotMatch(await render(props), /disclosed-discard.png/);
});
for (const seat of [0, 1]) for (const legacy of [false, true]) test(`rendered seat ${seat}, ${legacy ? 'Core' : 'Expanded'}: table order and private zones`, async () => {
  const html = await render(tableFixture({ seat, legacy }));
  const top = html.indexOf('data-side="opponent"'), middle = html.indexOf('aria-label="Battlefield"'), bottom = html.indexOf('data-side="self"'), hand = html.indexOf('aria-label="Your private hand"');
  assert.ok(top < middle && middle < bottom && bottom < hand);
  const opponent = html.slice(top, middle), self = html.slice(bottom, hand);
  assert.ok(opponent.indexOf('data-field-zone="bench"') < opponent.indexOf('data-field-zone="active"'));
  assert.ok(self.indexOf('data-field-zone="active"') < self.indexOf('data-field-zone="bench"'));
  assert.doesNotMatch(html, /SECRET/);
  assert.equal((html.match(/aria-label="Shared Stadium"/g) || []).length, legacy ? 0 : 1);
  assert.equal((html.match(/class="arena-bench-spot"/g) || []).length, 10);
  assert.equal((html.match(/class="arena-opponent-back"/g) || []).length, 7);
  assert.match(html, /Inspect North player discard: 1 cards/);
  assert.match(html, /Inspect South player discard: 1 cards/);
});
test('setup keeps opponent faces, identities, artwork and attachments out of rendered HTML', async () => {
  const html = await render(tableFixture({ setup: true }));
  assert.doesNotMatch(html, /SECRET|\/SECRET.png/);
  assert.match(html, /Face-down card/);
  assert.match(html, /Opening setup/);
});
test('Stadium is inspectable in the centre and its server move respects the lock', async () => {
  const html = await render(tableFixture({ locked: true }));
  assert.match(html, /aria-label="Inspect Stadium: Training Park"/);
  assert.match(html, /Played by South player/);
  assert.match(html, /disabled[^>]*>Use Stadium: Training Park/);
});
test('empty and exhausted zones retain labels without fake stacks or card faces', async () => {
  const html = await render(tableFixture({ empty: true }));
  assert.match(html, /Your hand is empty/);
  assert.match(html, /No cards in hand/);
  assert.match(html, /No Prize cards/);
  assert.match(html, /No Stadium in play/);
  assert.match(html, /arena-deck-stack is-empty/);
  assert.doesNotMatch(html, /class="arena-opponent-back"/);
});
test('large opponent hands have bounded decorative backs and an accurate public count', async () => {
  const props = tableFixture(); props.table.players[1].hand_count = 60;
  const html = await render(props);
  assert.equal((html.match(/class="arena-opponent-back"/g) || []).length, 12);
  assert.match(html, /South player hand: 60 face-down cards/);
  assert.match(html, />\+48</);
});
test('long aliases are escaped and all private-hand cards remain in the scroll region', async () => {
  const props = tableFixture({ longHand: true }); props.aliases[0] = '<script>not-executable</script>';
  const html = await render(props);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /Hand-29/);
});
for (const seat of [0, 1]) test(`seat ${seat}: missing aliases retain labelled fields, piles and turn captions`, async () => {
  const props = tableFixture({ seat }); props.aliases = []; props.table.turn = 1 - seat;
  const html = await render(props);
  for (const index of [0, 1]) {
    assert.ok(html.includes(`aria-label="Player ${index + 1} play area"`));
    assert.ok(html.includes(`Inspect Player ${index + 1} discard: 1 cards`));
  }
  assert.ok(html.includes(`Player ${2 - seat} is playing`));
  assert.ok(html.includes(`Played by Player ${2 - seat}`));
  assert.doesNotMatch(html, /undefined (?:play area|is playing)|SECRET/);
});
