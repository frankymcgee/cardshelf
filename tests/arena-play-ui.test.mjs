import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as contract from '../shared/arena.mjs';
const source = fs.readFileSync(new URL('../app/components/arena/ArenaInteraction.vue', import.meta.url), 'utf8');
function harness() {
  const unit = id => ({ id, card: { name: id }, energy: [], tools: [], under: [] });
  const table = { version: contract.ARENA_VERSION, seat: 0, turn: 0, turn_number: 3, phase: 'playing', waiting_for: null, prompt: null,
    players: [{ hand: [unit('hand')], active: unit('active'), bench: [], discard: [] }, { hand: [], bench: [], discard: [] }],
    legal: [{ card: 'hand', label: 'Play to Bench', action: { type: 'bench', card: 'hand' } }], events: [{ n: 1 }] };
  const props = { table, selected: 'hand', locked: false }, events = [], watches = [], mounted = [], unmounted = [], listeners = new Map(), frames = new Map();
  let frameId = 0, target = null, captured = null;
  class Element { isConnected = true; focus() {} }
  const surface = new Element(); surface.contains = node => node === target; surface.dataset = {};
  surface.setPointerCapture = id => { captured = id; }; surface.hasPointerCapture = id => captured === id; surface.releasePointerCapture = () => { captured = null; };
  const rootTarget = { parentElement: surface, dataset: { arenaDrop: 'zone:0:bench' } }; target = rootTarget;
  const window = { innerWidth: 1200, innerHeight: 900, scrollBy: () => {}, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) };
  const document = { hidden: false, elementFromPoint: () => target, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) };
  const script = source.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1].replace(/^import .*$/mg, '');
  const js = ts.transpileModule(script, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  const state = vm.runInNewContext('(function(){' + js + ';return {surface,gesture,review,hint,over,playable,targets,reviewMoves,beginDrag,moveDrag,endDrag,chooseTargets,confirm,cancel,escape,interrupted,additionalPointer,pause,visibility,swallowClick};})()', {
    ...contract, HTMLElement: Element, window, document, Date, Math, Set,
    defineProps: () => props, defineEmits: () => (name, value) => { events.push([name, value]); if (name === 'select') props.selected = value.id; },
    ref: value => ({ value }), computed: fn => ({ get value() { return fn(); } }), watch: (_, fn) => watches.push(fn), onMounted: fn => mounted.push(fn), onBeforeUnmount: fn => unmounted.push(fn),
    requestAnimationFrame: fn => { frames.set(++frameId, fn); return frameId; }, cancelAnimationFrame: id => frames.delete(id)
  });
  state.surface.value = surface; mounted.forEach(fn => fn());
  const pointer = (extra = {}) => ({ pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1, isPrimary: true, clientX: 100, clientY: 400, currentTarget: surface, preventDefault() {}, ...extra });
  const start = () => state.beginDrag(table.players[0].hand[0], pointer());
  const move = () => state.moveDrag(pointer({ clientX: 150 }));
  const drop = () => state.endDrag(pointer({ clientX: 150 }));
  return { state, props, events, pointer, start, move, drop, watches, unmounted, listeners, frames, surface,
    outside() { target = null; }, capture() { return captured; } };
}
test('drag threshold preserves an ordinary click without submitting or capturing', () => {
  const h = harness(); h.start(); h.state.moveDrag(h.pointer({ clientX: 103 })); h.drop();
  assert.equal(h.state.review.value, null); assert.equal(h.capture(), null); assert.equal(h.events.length, 0);
});
test('valid drop opens review; explicit confirmation alone emits the exact action once', () => {
  const h = harness(), before = JSON.stringify(h.props.table), action = h.props.table.legal[0].action;
  h.start(); h.move(); assert.equal(h.capture(), 1); assert.equal(h.frames.size, 1); h.drop();
  assert.equal(h.capture(), null); assert.equal(h.frames.size, 0); assert.equal(h.state.review.value.target, 'zone:0:bench');
  assert.equal(h.events.filter(([kind]) => kind === 'action').length, 0);
  const key = h.state.reviewMoves.value[0].key; h.state.confirm(key); h.state.confirm(key);
  assert.equal(h.events.filter(([kind]) => kind === 'action').length, 1); assert.equal(h.events.at(-1)[1], action);
  assert.equal(JSON.stringify(h.props.table), before);
});
test('invalid destination and pointer cancellation cannot play a card', () => {
  for (const mode of ['outside', 'cancel']) {
    const h = harness(); h.start(); h.move();
    if (mode === 'outside') { h.outside(); h.drop(); } else h.state.interrupted(h.pointer());
    assert.equal(h.state.review.value, null); assert.equal(h.state.gesture.value, null);
    assert.equal(h.events.filter(([kind]) => kind === 'action').length, 0); assert.equal(h.frames.size, 0);
  }
});
test('keyboard target selection uses the same confirmation and exact payload', () => {
  const h = harness(); h.state.chooseTargets(h.props.table.players[0].hand[0]);
  assert.equal(h.events.filter(([kind]) => kind === 'action').length, 0);
  h.state.confirm(h.state.reviewMoves.value[0].key); assert.equal(h.events.at(-1)[1], h.props.table.legal[0].action);
});
for (const [name, invalidate] of [
  ['locked', h => { h.props.locked = true; }], ['new event', h => { h.props.table.events.push({ n: 2 }); }],
  ['removed card', h => { h.props.table.players[0].hand = []; }], ['removed move', h => { h.props.table.legal = []; }],
  ['prompt', h => { h.props.table.prompt = {}; }], ['opponent turn', h => { h.props.table.turn = 1; }],
  ['selection changed', h => { h.props.selected = 'other'; }]
]) test(`${name}: both a live drag and pending review are invalidated`, () => {
  for (const review of [false, true]) {
    const h = harness(); h.start(); h.move(); if (review) h.drop();
    invalidate(h); h.watches.forEach(fn => fn()); h.drop(); h.state.confirm('old-key');
    assert.equal(h.state.review.value, null); assert.equal(h.state.gesture.value, null);
    assert.equal(h.events.filter(([kind]) => kind === 'action').length, 0);
  }
});
test('identical polling keeps review but confirmation rechecks the current option object', () => {
  const h = harness(); h.start(); h.move(); h.drop();
  h.props.table = structuredClone(h.props.table); h.watches.forEach(fn => fn());
  assert.ok(h.state.review.value); h.state.confirm(h.state.reviewMoves.value[0].key);
  assert.equal(h.events.at(-1)[1], h.props.table.legal[0].action);
});
test('secondary pointer, Escape, blur and capture failure safely stop interaction', () => {
  for (const mode of ['extra', 'escape', 'blur', 'capture']) {
    const h = harness(); h.start(); if (mode === 'capture') h.surface.setPointerCapture = () => { throw new Error('capture'); }; h.move();
    if (mode === 'extra') h.state.additionalPointer(h.pointer({ pointerId: 2 }));
    if (mode === 'escape') h.state.escape({ key: 'Escape', preventDefault() {} });
    if (mode === 'blur') h.state.pause();
    h.drop(); assert.equal(h.state.review.value, null); assert.equal(h.frames.size, 0); assert.equal(h.capture(), null);
  }
});
test('teardown releases capture, local intents, animation frames and listeners', () => {
  const h = harness(); h.start(); h.move(); h.unmounted.forEach(fn => fn());
  assert.equal(h.listeners.size, 0); assert.equal(h.frames.size, 0); assert.equal(h.capture(), null); assert.equal(h.state.gesture.value, null);
});
test('touch handle follows the same deliberate movement and confirmation state machine', () => {
  const h = harness(); h.state.beginDrag(h.props.table.players[0].hand[0], h.pointer({ pointerType: 'touch' }));
  h.state.moveDrag(h.pointer({ pointerType: 'touch', clientX: 150 })); h.state.endDrag(h.pointer({ pointerType: 'touch', clientX: 150 }));
  assert.ok(h.state.review.value); assert.equal(h.events.filter(([kind]) => kind === 'action').length, 0);
});
test('completed drag suppresses only the follow-on pointer click, never keyboard activation', () => {
  const h = harness(); h.start(); h.move(); h.drop(); let stopped = 0;
  h.state.swallowClick({ detail: 1, preventDefault() { stopped++; }, stopPropagation() { stopped++; } });
  assert.equal(stopped, 2);
  h.state.swallowClick({ detail: 0, preventDefault() { stopped++; }, stopPropagation() { stopped++; } }); assert.equal(stopped, 2);
});

test('a fresh pointer press after a drop does not suppress an immediate confirmation click', () => {
  const h = harness(); h.start(); h.move(); h.drop(); let stopped = 0;
  // Some browsers dispatch no click after pointer capture; a new press must still work.
  h.state.additionalPointer(h.pointer());
  h.state.swallowClick({ detail: 1, preventDefault() { stopped++; }, stopPropagation() { stopped++; } });
  assert.equal(stopped, 0);
  h.state.confirm(h.state.reviewMoves.value[0].key);
  assert.equal(h.events.filter(([kind]) => kind === 'action').length, 1);
});
