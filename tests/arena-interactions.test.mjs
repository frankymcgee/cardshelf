import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as contract from '../shared/arena.mjs';
import { tableFixture, tableUnit } from './helpers/arena-table-fixtures.mjs';
const plain = value => JSON.parse(JSON.stringify(value));
function state(file, props = {}, api = async () => {}) {
  const text = fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
  const script = text.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1].replace(/^import .*$/mg, '');
  const ast = ts.createSourceFile(file, script, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS), names = [];
  for (const node of ast.statements) {
    if (ts.isVariableStatement(node)) for (const declaration of node.declarationList.declarations) if (ts.isIdentifier(declaration.name)) names.push(declaration.name.text);
    if (ts.isFunctionDeclaration(node) && node.name) names.push(node.name.text);
  }
  const js = ts.transpileModule(script, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  const events = [], watches = [], unmounts = [], timers = [], writes = [];
  const scope = { ...contract, console, ref: value => ({ value }), computed: fn => ({ get value() { return fn(); } }),
    watch: (get, run) => watches.push({ get, run }), nextTick: fn => Promise.resolve().then(fn), onMounted() {}, onBeforeUnmount: fn => unmounts.push(fn),
    defineProps: () => props, defineEmits: () => (...args) => events.push(args), definePageMeta() {}, useSeoMeta() {},
    useApi: () => api, useAuth: () => ({ state: { value: { user: { id: 'test-user' } } } }), useRoute: () => ({ params: { id: 'match' } }),
    errorMessage: e => e.message, document: { hidden: false, addEventListener() {}, removeEventListener() {} },
    window: { matchMedia: () => ({ matches: true }), addEventListener() {}, removeEventListener() {} },
    sessionStorage: { setItem: (...args) => writes.push(args), removeItem: key => writes.push(key) },
    setTimeout: fn => timers.push(fn), clearTimeout() {}, clearInterval() {} };
  const values = vm.runInNewContext('(function(){' + js + ';return {' + names.join(',') + '};})()', scope);
  return { ...values, events, watches, unmounts, timers, writes, props, scope, text };
}
const component = name => 'app/components/arena/' + name + '.vue';
const matchPage = 'app/pages/arena/matches/[id].vue';
const frame = (revision = 1, seat = 0) => ({ id: 'match', revision, seat, status: 'active', mode: 'pvp', ...tableFixture({ seat }) });
for (const count of [0, 1, 7, 12, 30, 60]) test(`hand fan ${count}: bounded geometry and immutable input`, () => {
  const props = { cards: Array.from({ length: count }, (_, i) => tableUnit('Hand-' + i)) }, before = JSON.stringify(props);
  const h = state(component('ArenaHandFan'), props);
  for (let i = 0; i < count; i++) {
    const style = h.fanStyle(i);
    assert.ok(Math.abs(parseFloat(style['--fan-tilt'])) <= 6);
    assert.ok(parseFloat(style['--fan-drop']) <= 12);
    if (count > 12) assert.deepEqual(plain(style), { '--fan-tilt': '0deg', '--fan-drop': '0px' });
  }
  assert.equal(JSON.stringify(props), before);
});
test('hand selection emits the actual own card only, never a game action or an injected hidden unit', () => {
  const card = tableUnit('own'), hidden = { hidden: true, id: 'hidden', card: { name: 'SECRET' } };
  const h = state(component('ArenaHandFan'), { cards: [card, hidden] });
  h.selectCard(card); h.selectCard(hidden); h.selectCard(tableUnit('foreign')); h.selectCard(null);
  assert.equal(h.events.length, 1); assert.equal(h.events[0][0], 'select'); assert.equal(h.events[0][1], card);
});
test('arrow/Home/End navigation is bounded, focuses cards and never selects or submits', () => {
  const h = state(component('ArenaHandFan'), { cards: [tableUnit('a'), tableUnit('b')] }), focused = [], scrolls = [];
  h.scroller.value = { querySelector: selector => ({ focus: () => focused.push(selector), scrollIntoView: options => scrolls.push(options) }) };
  const press = key => { let prevented = false; h.onKey({ key, preventDefault() { prevented = true; } }); return prevented; };
  assert.equal(press('ArrowLeft'), true); assert.equal(h.focusedIndex.value, 0);
  press('End'); assert.equal(h.focusedIndex.value, 1); press('ArrowRight'); assert.equal(h.focusedIndex.value, 1);
  press('Home'); assert.equal(h.focusedIndex.value, 0); assert.equal(press('ArrowDown'), false);
  assert.equal(h.events.length, 0); assert.equal(focused.length, 4); assert.equal(scrolls.length, 4);
});
test('action tray forwards an unchanged legal payload only after explicit activation', () => {
  const action = { type: 'energy', card: 'e', target: 'active' }, move = { label: 'Attach Energy', action };
  const props = { unit: tableUnit('e'), moves: [move], locked: false }, h = state(component('ArenaActionTray'), props);
  h.choose({ ...move }); assert.equal(h.events.length, 0);
  h.choose(move); assert.equal(h.events.length, 1); assert.equal(h.events[0][1], action);
  props.locked = true; h.choose(move); props.locked = false; props.moves = []; h.choose(move);
  props.moves = [move]; props.unit = { hidden: true, card: { name: 'SECRET' } }; h.choose(move);
  assert.equal(h.events.length, 1);
});
for (const seat of [0, 1]) test(`seat ${seat}: selected card/preview exclude poisoned opponent hands and hidden descendants`, () => {
  const f = frame(1, seat), h = state(matchPage);
  f.table.players[1 - seat].active = { id: 'hidden-active', hidden: true, card: { name: 'SECRET-ACTIVE' }, tools: [tableUnit('SECRET-TOOL')] };
  h.accept(f);
  assert.ok(!JSON.stringify(h.cards.value).includes('SECRET'));
  const ownCard = f.table.players[seat].hand[0]; h.select(ownCard);
  assert.equal(h.current.value, ownCard); h.select(tableUnit('SECRET-HAND'));
  assert.equal(h.current.value, ownCard); assert.equal(h.writes.length, 0); assert.equal(h.timers.length, 0);
});
test('mobile selection no longer scrolls to an inspector or makes a network/storage request', () => {
  let requests = 0; const f = frame(), h = state(matchPage, {}, async () => { requests++; });
  h.accept(f); h.select(f.table.players[0].hand[0]);
  assert.equal(requests, 0); assert.equal(h.timers.length, 0); assert.equal(h.writes.length, 0);
  assert.equal(h.previewOpen.value, false); assert.doesNotMatch(h.text, /focusControls|scrollIntoView/);
});
test('latest acknowledged snapshot removes unavailable selection; stale snapshots cannot close a valid preview', () => {
  const f = frame(4), h = state(matchPage); h.accept(f); h.select(f.table.players[0].hand[0]); h.previewOpen.value = true;
  const stale = frame(3); stale.table.players[0].hand = []; h.accept(stale);
  assert.equal(h.previewOpen.value, true); assert.equal(h.selected.value, 'Hand-0');
  const next = frame(5); next.table.players[0].hand = []; h.accept(next);
  assert.equal(h.previewOpen.value, false); assert.equal(h.selected.value, '');
});
test('new decisions close incidental previews, but repeated polling does not disturb them', () => {
  const f = frame(), h = state(matchPage); h.accept(f); h.select(f.table.players[0].hand[0]); h.previewOpen.value = true;
  h.accept(frame()); assert.equal(h.previewOpen.value, true);
  const next = frame(2); next.table.prompt = { kind: 'prize', options: [], min: 0, max: 0 };
  h.accept(next); assert.equal(h.previewOpen.value, false);
  h.previewOpen.value = true; h.accept(next); assert.equal(h.previewOpen.value, true);
});
test('discard inspection validates seats and cleanly switches to an available card preview', () => {
  const f = frame(), h = state(matchPage); h.accept(f); h.openDiscard(8); assert.equal(h.discardSeat.value, null);
  h.openDiscard(1); assert.equal(h.discardSeat.value, 1);
  h.inspectDiscard(f.table.players[1].discard[0]); assert.equal(h.discardSeat.value, null); assert.equal(h.previewOpen.value, true);
  h.clearSelection(); assert.equal(h.previewOpen.value, false); assert.equal(h.selected.value, '');
});
test('prompt identity survives identical polling and changes for consecutive same-shaped acknowledged decisions', () => {
  const props = { revision: 1, prompt: { kind: 'search', title: 'Choose', min: 0, max: 1, options: [{ id: 'a' }] } };
  const h = state(component('ArenaPromptModal'), props), first = h.signature.value;
  props.prompt = structuredClone(props.prompt); assert.equal(h.signature.value, first);
  props.revision = 2; assert.notEqual(h.signature.value, first);
  h.minimized.value = true; h.watches[0].run(); assert.equal(h.minimized.value, false);
  assert.equal(h.events.length, 0);
});
test('the real match page wires tray actions and typed decisions to the existing guarded writer', () => {
  const h = state(matchPage);
  assert.match(h.text, /<ArenaActionTray[^>]*@action="act"/);
  assert.match(h.text, /<ArenaPromptModal[^>]*@choose="act\(\{ type: 'choose', choices: \$event \}\)"/);
  assert.match(h.text, /if \(locked.value \|\| !data.value\) return/);
  assert.match(h.text, /request_id: crypto.randomUUID\(\)/);
  assert.match(h.text, /epoch/);
});
