// Execute actual component/page scripts; native signed-in browser tests cover rendering.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { randomUUID } from 'node:crypto';
import * as ui from '../shared/arena-match-ui.mjs';
const source = name => fs.readFileSync(new URL('../' + name, import.meta.url), 'utf8');
function harness(file, props = {}, api = async () => {}) {
  const script = source(file).match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1].replace(/^import .*$/mg, '');
  const ast = ts.createSourceFile(file, script, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS), names = [];
  function collect(n) { if (ts.isIdentifier(n)) names.push(n.text); else if (ts.isObjectBindingPattern(n) || ts.isArrayBindingPattern(n)) for (const part of n.elements) if (ts.isBindingElement(part)) collect(part.name); }
  for (const n of ast.statements) {
    if (ts.isVariableStatement(n)) for (const d of n.declarationList.declarations) collect(d.name);
    if (ts.isFunctionDeclaration(n) && n.name) names.push(n.name.text);
  }
  const mounts = [], unmounts = [], watchers = [], emitted = [], listeners = new Map(), storage = new Map();
  const events = { addEventListener: (event, fn) => listeners.set(event, fn), removeEventListener: event => listeners.delete(event) };
  const scope = { ...ui, structuredClone, console, Date, JSON, Math, Number, String, Promise,
    ref: value => ({ value }), computed: fn => ({ get value() { return fn(); } }), watch: (_, fn) => watchers.push(fn),
    onMounted: fn => mounts.push(fn), onBeforeUnmount: fn => unmounts.push(fn), defineProps: () => props,
    defineEmits: () => (...values) => emitted.push(values), document: { hidden: false, ...events }, window: { ...events },
    useApi: () => api, useRoute: () => ({ params: { id: 'match' } }), useAuth: () => ({ state: { value: { user: { id: 'user' } } } }),
    definePageMeta() {}, useSeoMeta() {}, errorMessage: error => error.message, crypto: { randomUUID },
    sessionStorage: { setItem: (k, v) => storage.set(k, v), getItem: k => storage.get(k), removeItem: k => storage.delete(k) },
    setInterval: () => 1, clearInterval() {}, arenaConflict: e => e.statusCode === 409 };
  const js = ts.transpileModule(script, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const result = vm.runInNewContext('(function(){' + js + ';return {' + names.join(',') + '};})()', scope);
  return { ...result, props, scope, mounts, unmounts, watchers, emitted, listeners, storage };
}
const component = 'app/components/arena/ArenaTurnActions.vue';
function props() {
  const move = { label: 'End turn', action: { type: 'end_turn' } };
  return { table: { version: 'pokemon-expanded-v2', seat: 0, phase: 'playing', turn: 0, turn_number: 2, waiting_for: null, prompt: null, legal: [move] }, moves: [move], matchId: 'match', revision: 2, locked: false };
}
test('End turn review is local; confirmation emits the exact current action once', () => {
  const p = props(), h = harness(component, p); h.choose(p.moves[0]); assert.equal(h.reviewing.value, true); assert.equal(h.emitted.length, 0);
  h.confirm(); h.confirm(); assert.equal(h.emitted.length, 1); assert.equal(h.emitted[0][1], p.moves[0].action); assert.equal(h.storage.size, 0);
});
test('Keep playing and unrecognised objects never submit a move', () => {
  const p = props(), h = harness(component, p); h.choose({ ...p.moves[0] }); assert.equal(h.reviewing.value, false);
  h.choose(p.moves[0]); h.cancel(); h.confirm(); assert.equal(h.emitted.length, 0);
});
for (const [name, change] of [
  ['revision', p => p.revision++], ['match', p => p.matchId = 'other'], ['lock', p => p.locked = true],
  ['prompt', p => p.table.prompt = {}], ['turn', p => p.table.turn = 1], ['rules', p => p.table.version = 'future'],
  ['removed action', p => { p.moves = []; p.table.legal = []; }]
]) test(name + ' invalidates review even before a watcher callback is flushed', () => {
  const p = props(), h = harness(component, p); h.choose(p.moves[0]); change(p); h.confirm(); assert.equal(h.emitted.length, 0); assert.equal(h.review.value, '');
});
test('identical polling preserves review but uses the newly supplied action object', () => {
  const p = props(), h = harness(component, p); h.choose(p.moves[0]);
  p.table = structuredClone(p.table); p.moves = p.table.legal; h.watchers.forEach(fn => fn());
  assert.equal(h.reviewing.value, true); h.confirm(); assert.equal(h.emitted[0][1], p.moves[0].action);
});
test('a removed action cannot resurrect an old review if it later reappears', () => {
  const p = props(), h = harness(component, p), old = p.moves; h.choose(old[0]); p.moves = []; h.watchers.forEach(fn => fn());
  p.moves = old; h.watchers.forEach(fn => fn()); h.confirm(); assert.equal(h.emitted.length, 0);
});
test('other server global moves retain their explicit action contract', () => {
  const p = props(), ready = { label: 'Ready', action: { type: 'ready' } }; p.moves = [ready];
  const h = harness(component, p); h.choose(ready); assert.equal(h.emitted[0][1], ready.action); assert.equal(h.reviewing.value, false);
});
test('blur, visibility change and unmount discard only local review and remove listeners', () => {
  const p = props(), h = harness(component, p); h.mounts.forEach(fn => fn());
  for (const event of ['blur', 'visibilitychange']) { h.choose(p.moves[0]); h.listeners.get(event)(); assert.equal(h.reviewing.value, false); }
  h.choose(p.moves[0]); h.unmounts.forEach(fn => fn()); assert.equal(h.listeners.size, 0); assert.equal(h.emitted.length, 0);
});
test('hidden documents cannot confirm even without a delivered visibility event', () => {
  const p = props(), h = harness(component, p); h.choose(p.moves[0]); h.scope.document.hidden = true; h.confirm(); assert.equal(h.emitted.length, 0);
});
const page = 'app/pages/arena/matches/[id].vue';
const frame = revision => ({ id: 'match', revision, seat: 0, status: 'active', mode: 'pvp', table: { players: [{ hand: [], bench: [], discard: [] }, { hand: [], bench: [], discard: [] }], legal: [], prompt: null } });
test('fresh reads clear recovered errors but preserve an uncertain pending-action warning', () => {
  const h = harness(page); h.error.value = 'Disconnected'; h.accept(frame(1)); assert.equal(h.error.value, '');
  h.pending.value = { id: 'match' }; h.error.value = 'Uncertain'; h.accept(frame(2)); assert.equal(h.error.value, 'Uncertain');
});
test('new required decisions close incidental Help/History without submitting an action', () => {
  const h = harness(page); h.accept(frame(1)); h.showLog.value = true; h.showHelp.value = true;
  const next = frame(2); next.table.prompt = { kind: 'prize' }; h.accept(next);
  assert.equal(h.showLog.value, false); assert.equal(h.showHelp.value, false); assert.equal(h.pending.value, null);
});
test('focus mode remains in-memory and page integrates the current guarded writer', () => {
  const h = harness(page); assert.equal(h.focusMode.value, false); h.focusMode.value = true; assert.equal(h.storage.size, 0);
  const text = source(page); assert.match(text, /ArenaTurnActions[^>]*@action="act"/); assert.match(text, /:focused="focusMode && !!table"/);
  assert.match(text, /<ArenaModal :open="showLog" label="Match history"/); assert.match(text, /<ArenaModal :open="showHelp" label="How to play"/);
});
