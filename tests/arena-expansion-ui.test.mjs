import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import ts from 'typescript';
import * as Vue from 'vue';
import { renderToString } from 'vue/server-renderer';
import { parse, compileScript } from '@vue/compiler-sfc';
import * as contract from '../shared/arena.mjs';
const require = createRequire(import.meta.url);
const source = file => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
// Execute each actual SFC script, preserving its computed values and request construction.
function state(file, api = async () => ({}), props = {}) {
  const script = source(file).match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1].replace(/^import .*$/mg, '');
  const ast = ts.createSourceFile(file, script, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS), names = [];
  const add = node => { if (ts.isIdentifier(node)) names.push(node.text); else if (ts.isObjectBindingPattern(node) || ts.isArrayBindingPattern(node)) for (const entry of node.elements) if (ts.isBindingElement(entry)) add(entry.name); };
  for (const node of ast.statements) { if (ts.isVariableStatement(node)) for (const declaration of node.declarationList.declarations) add(declaration.name); if (ts.isFunctionDeclaration(node) && node.name) names.push(node.name.text); }
  const js = ts.transpileModule(script, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  const scope = { ...contract, ref: value => ({ value }), computed: fn => ({ get value() { return fn(); } }), watch() {}, onMounted() {}, onBeforeUnmount() {}, defineProps: () => props, defineEmits: () => () => {}, useApi: () => api, useAuth: () => ({ state: { value: { user: { id: 'user' } } } }), useRoute: () => ({ params: { id: 'table' } }), definePageMeta() {}, useSeoMeta() {}, errorMessage: error => error.message, navigateTo: async () => {}, crypto: { randomUUID }, sessionStorage: { getItem() {}, setItem() {}, removeItem() {} }, setTimeout() {}, clearTimeout() {}, clearInterval() {}, window: {}, document: { hidden: false }, console };
  return vm.runInNewContext('(function(){' + js + '; return {' + names.join(',') + '};})()', scope);
}
// Compile and render the real components, including their templates and child imports.
const cache = new Map();
function component(file) {
  if (cache.has(file)) return cache.get(file);
  const { descriptor } = parse(source(file), { filename: file });
  const compiled = compileScript(descriptor, { id: file, inlineTemplate: true });
  const js = ts.transpileModule(compiled.content, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const output = { exports: {} };
  const localRequire = name => name.endsWith('.vue') ? { default: component(path.posix.normalize(path.posix.join(path.posix.dirname(file), name))) } : name.endsWith('/arena.mjs') ? contract : require(name);
  vm.runInNewContext(js, { ...Vue, exports: output.exports, module: output, require: localRequire, console }, { filename: file });
  cache.set(file, output.exports.default); return output.exports.default;
}
const render = (name, props) => renderToString(Vue.createSSRApp(component('app/components/arena/' + name + '.vue'), props));
const unit = (id, card = {}, extra = {}) => ({ id, card: { id: 'en:' + id, name: id, kind: 'pokemon', hp: 100, retreat: 2, stage: 'Basic', attacks: [], ...card }, energy: [], under: [], damage: 0, conditions: {}, ...extra });
const player = () => ({ hand: [], hand_count: 0, deck_count: 40, prize_count: 6, active: null, bench: [], discard: [], resolving: [] });
const frame = extra => ({ id: 'table', revision: 1, status: 'active', seat: 0, mode: 'practice', table: { seat: 0, phase: 'playing', turn: 0, turn_number: 2, players: [player(), player()], events: [], legal: [], prompt: null, waiting_for: null, ...extra } });
const home = 'app/pages/arena/index.vue', match = 'app/pages/arena/matches/[id].vue';
for (const mode of ['matched', 'mirror', 'saved']) test('saved-deck practice sends ' + mode + ' with immutable revisions and no training fallback', async () => {
  let sent; const h = state(home, async (url, options) => { sent = plain(options.body); return { id: 'table' }; });
  h.decks.value = [{ id: 'mine', revision: 8, total: 60 }, { id: 'cpu', revision: 12, total: 60 }]; h.deck.value = 'mine'; h.opponent.value = mode; h.opponentDeck.value = 'cpu';
  await h.start('practice');
  assert.equal(sent.opponent, mode); assert.equal(sent.deck_id, 'mine'); assert.equal(sent.deck_revision, 8); assert.equal(sent.training, undefined);
  assert.equal(sent.opponent_deck_id, mode === 'saved' ? 'cpu' : undefined); assert.equal(sent.opponent_deck_revision, mode === 'saved' ? 12 : undefined);
});
test('missing explicitly chosen opponent is caught before match creation', async () => { let calls = 0; const h = state(home, async () => { calls++; }); h.decks.value = [{ id: 'mine', revision: 1, total: 60 }]; h.deck.value = 'mine'; h.opponent.value = 'saved'; await h.start('practice'); assert.equal(calls, 0); assert.match(h.error.value, /Choose a saved opponent/); });
test('training selection and tutorial do not send saved-opponent fields', async () => { const bodies = [], h = state(home, async (url, options) => { bodies.push(options.body); return { id: 'table' }; }); h.opponent.value = 'saved'; await h.start('practice'); h.decks.value = [{ id: 'mine', revision: 2 }]; h.deck.value = 'mine'; await h.start('tutorial'); for (const body of bodies) { assert.equal(body.training, true); assert.equal(body.opponent, undefined); assert.equal(body.opponent_deck_id, undefined); assert.equal(body.deck_id, undefined); } });
test('table inspector includes disclosed nested cards and Stadium but excludes all hidden descendants', () => {
  const tool = unit('tool'), energy = unit('energy'), prior = unit('previous');
  const h = state(match), f = frame({ stadium: { seat: 1, unit: unit('stadium') } });
  f.table.players[0].active = unit('active', {}, { tools: [tool], energy: [energy], under: [prior] }); f.table.players[1].active = { hidden: true, card: { name: 'SECRET' }, tools: [unit('secret-tool')] };
  h.accept(f); assert.deepEqual(plain(h.cards.value.map(card => card.id)), ['active', 'tool', 'energy', 'previous', 'stadium']);
  h.selected.value = 'tool'; assert.equal(h.current.value.id, 'tool'); assert.equal(h.attachmentParent.value.id, 'active');
});
test('ability and Stadium buttons come only from legal server actions', () => {
  const h = state(match); const legal = [{ card: 'active', label: 'Use Ability: Draw', action: { type: 'ability', card: 'active', index: 0 } }, { label: 'Use Stadium: Park', action: { type: 'stadium' } }, { action: { type: 'end_turn' } }];
  h.accept(frame({ legal, stadium: { seat: 0, unit: unit('park') } })); h.selected.value = 'active'; assert.deepEqual(plain(h.moves.value), [legal[0]]); h.selected.value = 'park'; assert.deepEqual(plain(h.moves.value), [legal[1]]); assert.deepEqual(plain(h.stadiumMoves.value), [legal[1]]); assert.deepEqual(plain(h.globalMoves.value), [legal[2]]);
  h.accept({ ...frame({ legal: [], stadium: { seat: 0, unit: unit('park') } }), revision: 2 }); assert.equal(h.stadiumMoves.value.length, 0); assert.equal(h.moves.value.length, 0);
});
test('effective HP replaces printed HP while old snapshots retain the printed fallback', () => { const props = { unit: unit('Pokemon', { hp: 100 }, { damage: 30, effective_hp: 150 }) }, h = state('app/components/arena/ArenaCard.vue', undefined, props); assert.equal(h.hp.value, 120); assert.equal(h.name.value, 'Pokemon, 120 of 150 HP'); delete props.unit.effective_hp; assert.equal(h.hp.value, 70); });
test('multi-prize decision requires exactly the server count and rejects unknown choices', () => { const props = { prompt: { kind: 'prize', min: 2, max: 2, options: [{ id: '0', hidden: true }, { id: '1', hidden: true }, { id: '2', hidden: true }] } }, h = state('app/components/arena/ArenaDecision.vue', undefined, props); h.toggle('invented'); assert.equal(h.selected.value.length, 0); h.toggle('0'); assert.equal(h.valid.value, false); h.toggle('1'); assert.equal(h.valid.value, true); h.toggle('2'); assert.deepEqual(plain(h.selected.value), ['0', '1']); props.locked = true; h.toggle('0'); assert.equal(h.selected.value.length, 2); });
test('rendered hidden card never includes card identity, artwork or attachments', async () => { const html = await render('ArenaCard', { unit: { hidden: true, card: { name: 'Secret card', type: 'Fire', image_url: '/secret-image.png', rule_box: 'EX' }, tools: [unit('Secret Tool')] } }); assert.match(html, /Face-down card/); assert.doesNotMatch(html, /Secret card|Secret Tool|secret-image|Rule box|energy-fire/); });
test('real catalogue artwork fallback is not described as an original training card', async () => { const real = await render('ArenaCard', { unit: unit('Real card') }), training = await render('ArenaCard', { unit: unit('Demo', { id: 'training:demo' }) }); assert.match(real, /Catalogue artwork unavailable/); assert.doesNotMatch(real, /Original training card/); assert.match(training, /Original training card/); });
test('rendered facts preserve EX versus ex, effective stats and Ability text', async () => {
  const html = await render('ArenaCardFacts', { unit: unit('Mega Example', { rule_box: 'EX', stage: 'MegaEvolution', prizes: 2, abilities: [{ name: 'Read Ahead', text: 'Draw a card.', limit: 'turn' }] }, { effective_hp: 130, effective_retreat: 0, damage: 10 }) });
  assert.match(html, /Mega Evolution/); assert.match(html, /Rule box: EX/); assert.match(html, /2 Prize cards on Knock Out/); assert.match(html, /120 \/ 130/); assert.match(html, /Effective retreat/); assert.match(html, />Free</); assert.match(html, /Read Ahead/); assert.match(html, /Draw a card\./);
  const modern = await render('ArenaCardFacts', { card: unit('Modern', { rule_box: 'ex' }).card }); assert.match(modern, /Rule box: ex/); assert.doesNotMatch(modern, /Rule box: EX/);
});
test('rendered attachments provide inspectable names without hidden descendants', async () => { const html = await render('ArenaAttachments', { unit: unit('Active', {}, { tools: [unit('Tool card')], energy: [unit('Energy card')], under: [unit('Earlier stage'), { hidden: true, card: { name: 'SECRET' } }] }) }); assert.match(html, /Attached Tools/); assert.match(html, /Inspect Tool card/); assert.match(html, /Attached Energy/); assert.match(html, /Evolution stack/); assert.match(html, /Earlier stage/); assert.doesNotMatch(html, /SECRET/); });
test('board renders one shared Stadium and server-provided activation, plus v1 without a Stadium', async () => { const f = frame({ stadium: { seat: 1, unit: unit('Public Park', { kind: 'trainer', hp: undefined }) } }); const html = await render('ArenaBoard', { table: f.table, aliases: ['You', 'CPU'], stadiumMoves: [{ label: 'Use Stadium: Public Park', action: { type: 'stadium' } }] }); assert.equal((html.match(/aria-label="Shared Stadium"/g) || []).length, 1); assert.match(html, /Played by CPU/); assert.match(html, /Use Stadium: Public Park/); const old = await render('ArenaBoard', { table: frame().table, aliases: ['You', 'CPU'] }); assert.doesNotMatch(old, /Shared Stadium/); assert.match(old, /Your private hand/); });
test('rendered multi-prize choices stay face down and confirmation waits for all choices', async () => { const html = await render('ArenaDecision', { prompt: { kind: 'prize', title: 'Choose 3 Prize cards', min: 3, max: 3, options: [{ id: '0', label: 'Prize 1', hidden: true, card: { card: { image_url: '/secret.png' } } }] } }); assert.match(html, /Choose 3 face-down Prize cards/); assert.match(html, /RESOLVE BEFORE CONTINUING/); assert.doesNotMatch(html, /secret.png/); assert.match(html, /disabled[^>]*>Take 0 Prize cards/); });
