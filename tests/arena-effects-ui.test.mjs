import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as effects from '../shared/arena-effects.mjs';
const source = fs.readFileSync(new URL('../app/components/arena/ArenaEffects.vue', import.meta.url), 'utf8');
function harness() {
  const unit = id => ({ id, card: { name: id }, damage: 0, conditions: {}, energy: [], tools: [] });
  const t = { version: 'pokemon-expanded-v2', seat: 0, turn: 0, turn_number: 1, phase: 'playing',
    players: [0, 1].map(i => ({ active: unit('a' + i), bench: [], hand: [unit('h' + i)], discard: [], hand_count: 1, deck_count: 40, prize_count: 6 })), events: [{ n: 1, kind: 'setup' }] };
  const props = { table: t, revision: 1, matchId: 'm', available: true }, mounts = [], unmounts = [], watchers = [], timers = new Map(), listeners = new Map();
  let now = 1000, timer = 0;
  const rect = (x, y) => ({ left: x, top: y, right: x + 100, bottom: y + 140, width: 100, height: 140 });
  const element = (x, y, data = {}) => ({ dataset: data, getBoundingClientRect: () => rect(x, y), closest: () => null, querySelector: () => null });
  const active = [element(400, 600, { arenaDrop: 'card:a0' }), element(400, 200, { arenaDrop: 'card:a1' })], centre = element(400, 400);
  const board = { querySelectorAll: selector => selector === '[data-arena-drop]' ? active : [], querySelector: () => centre };
  const stage = { querySelector: () => board };
  const preference = { matches: false, addEventListener: (n, fn) => listeners.set('media:' + n, fn), removeEventListener: n => listeners.delete('media:' + n) };
  const document = { hidden: false, addEventListener: (n, fn) => listeners.set('document:' + n, fn), removeEventListener: n => listeners.delete('document:' + n) };
  const window = { innerWidth: 1440, innerHeight: 1700, matchMedia: () => preference, addEventListener: (n, fn) => listeners.set(n, fn), removeEventListener: n => listeners.delete(n) };
  const script = source.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1].replace(/^import .*$/mg, '');
  const js = ts.transpileModule(script, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  const state = vm.runInNewContext('(function(){' + js + ';return {stage,enabled,reduced,minimal,motion,flights,impacts,beams,cues,strikes,bursts,banners,liveFlights,liveStrikes,update,baseline,interrupt,toggle,toggleMotion,visibility,changedPreference};})()', {
    ...effects, window, document, Date: { now: () => now }, console,
    defineProps: () => props, ref: value => ({ value }), computed: fn => ({ get value() { return fn(); } }),
    watch: (a, b) => watchers.push(b), onMounted: fn => mounts.push(fn), onBeforeUnmount: fn => unmounts.push(fn), nextTick: () => Promise.resolve(),
    setTimeout: fn => { timers.set(++timer, fn); return timer; }, clearTimeout: id => timers.delete(id)
  });
  state.stage.value = stage; mounts.forEach(fn => fn());
  const change = () => { props.table = structuredClone(props.table); props.revision++; props.table.events.push({ n: props.table.events.at(-1).n + 1, kind: 'attack', attacker: 'a0', target: 'a1', damage: 30, attack: 'Strike' }); };
  return { props, state, timers, listeners, unmounts, preference, document, change, later: () => { now += 20000; } };
}
test('initial mount is a quiet baseline; effects cannot submit actions or persist snapshots', () => {
  const h = harness(); assert.equal(h.state.impacts.value.length, 0); assert.equal(h.timers.size, 0);
  assert.doesNotMatch(source, /defineEmits|useApi|\$fetch|localStorage|sessionStorage|\.cloneNode\(/);
  assert.match(source, /aria-hidden="true" inert/); assert.match(source, /:unit="flight.unit"/);
});
test('a confirmed revision creates bounded effects and timers without changing the live table', async () => {
  const h = harness(); h.change(); const before = JSON.stringify(h.props.table); await h.state.update();
  assert.equal(h.state.impacts.value[0].amount, 30); assert.equal(h.state.beams.value.length, 1);
  assert.equal(h.timers.size, 2); assert.equal(JSON.stringify(h.props.table), before);
  assert.equal(h.state.liveStrikes.value.length, 1); assert.equal(h.state.liveStrikes.value[0].unit.id, 'a0');
  assert.equal(h.state.bursts.value[0].kind, 'attack'); assert.equal(h.state.bursts.value[0].sparks.length, 6);
});
test('same revision polls preserve an active effect without rescheduling it', async () => {
  const h = harness(); h.change(); await h.state.update(); const ids = [...h.timers.keys()];
  h.props.table = structuredClone(h.props.table); await h.state.update();
  assert.deepEqual([...h.timers.keys()], ids);
});
test('stale revisions never regress the deduplication baseline', async () => {
  const h = harness(); h.change(); await h.state.update(); const active = h.state.impacts.value;
  h.props.revision--; await h.state.update(); assert.equal(h.state.impacts.value, active);
});
test('disabled effects and OS reduced motion cannot start travel or impact animations', async () => {
  const h = harness(); h.preference.matches = true; h.state.changedPreference(); h.change(); await h.state.update();
  assert.equal(h.state.impacts.value.length, 0); assert.equal(h.state.beams.value.length, 0); assert.equal(h.state.cues.value.length, 1);
  h.state.toggle(); h.change(); await h.state.update(); assert.equal(h.state.cues.value.length, 0);
  h.state.toggle(); await h.state.update(); assert.equal(h.state.cues.value.length, 0);
});
test('connection loss cancels timers and reconnection establishes a baseline without historical replay', async () => {
  const h = harness(); h.change(); await h.state.update(); h.props.available = false; await h.state.update();
  assert.equal(h.timers.size, 0); assert.equal(h.state.impacts.value.length, 0);
  h.change(); h.props.available = true; await h.state.update(); assert.equal(h.state.cues.value.length, 0);
});
test('hidden tabs, focus/scroll interruption and long inactivity do not queue old effects', async () => {
  const h = harness(); h.change(); await h.state.update(); h.document.hidden = true; h.state.visibility();
  assert.equal(h.timers.size, 0); h.change(); h.document.hidden = false; h.state.visibility(); await h.state.update();
  assert.equal(h.state.impacts.value.length, 0); h.change(); h.later(); await h.state.update(); assert.equal(h.state.cues.value.length, 0);
  h.state.interrupt(); h.change(); await h.state.update(); assert.equal(h.state.cues.value.length, 0);
});
test('an interrupted pending DOM update cannot resurrect decoration', async () => {
  const h = harness(); h.change(); const task = h.state.update(); h.state.interrupt(); await task;
  assert.equal(h.state.impacts.value.length, 0); assert.equal(h.timers.size, 0);
});
test('new match identity clears current decoration instead of animating across tables', async () => {
  const h = harness(); h.change(); await h.state.update(); h.props.matchId = 'different'; h.props.revision = 1; await h.state.update();
  assert.equal(h.state.impacts.value.length, 0); assert.equal(h.state.cues.value.length, 0);
});
test('unmount cancels all timers, preference listeners and viewport listeners', async () => {
  const h = harness(); h.change(); await h.state.update(); h.unmounts.forEach(fn => fn());
  assert.equal(h.timers.size, 0); assert.equal(h.listeners.size, 0); assert.equal(h.state.impacts.value.length, 0);
  assert.equal(h.state.liveStrikes.value.length, 0); assert.equal(h.state.bursts.value.length, 0); assert.equal(h.state.banners.value.length, 0);
});
test('live flight faces disappear as soon as their current disclosed identity is removed', () => {
  const h = harness(); h.state.flights.value = [{ id: 'h0', kind: 'card' }]; assert.equal(h.state.liveFlights.value.length, 1);
  h.props.table.players[0].hand = []; assert.equal(h.state.liveFlights.value.length, 0);
});

test('manual reduced motion cancels every effect and retains new textual feedback without replay', async () => {
  const h = harness(); h.change(); await h.state.update(); assert.equal(h.state.liveStrikes.value.length, 1);
  h.state.toggleMotion(); assert.equal(h.state.motion.value, 'reduced'); assert.equal(h.state.liveStrikes.value.length, 0);
  assert.equal(h.state.bursts.value.length, 0); assert.equal(h.timers.size, 0);
  h.change(); await h.state.update(); assert.equal(h.state.cues.value.length, 1); assert.equal(h.state.impacts.value.length, 0);
  h.state.toggleMotion(); await h.state.update(); assert.equal(h.state.motion.value, 'full'); assert.equal(h.state.cues.value.length, 0);
});

test('strike artwork disappears immediately when its source is hidden or removed', async () => {
  const h = harness(); h.change(); await h.state.update(); assert.equal(h.state.liveStrikes.value.length, 1);
  h.props.table.players[0].active.hidden = true; assert.equal(h.state.liveStrikes.value.length, 0);
  h.props.table.players[0].active = null; assert.equal(h.state.liveStrikes.value.length, 0);
});

test('a delayed preference-change event cannot consume or cancel an already-correct new effect', async () => {
  const h = harness(); h.preference.matches = true; h.state.changedPreference();
  h.change(); await h.state.update(); assert.equal(h.state.impacts.value.length, 0);
  // Browser media state can update before its asynchronous change listener fires.
  h.preference.matches = false; h.change(); await h.state.update();
  const active = h.state.impacts.value; assert.equal(active[0].amount, 30);
  const ids = [...h.timers.keys()]; h.state.changedPreference();
  assert.equal(h.state.impacts.value, active); assert.deepEqual([...h.timers.keys()], ids);
});
test('missing effect metadata cancels active decoration instead of reading a null frame', async () => {
  const h = harness(); h.change(); await h.state.update();
  h.props.table = null; h.props.revision++; await h.state.update();
  assert.equal(h.state.impacts.value.length, 0); assert.equal(h.timers.size, 0);
});

test('returning to a hidden or blurred table waits for a fresh acknowledged baseline', async () => {
  for (const mode of ['focus', 'visibility']) {
    const h = harness();
    if (mode === 'focus') { h.listeners.get('blur')(); h.listeners.get('focus')(); }
    else { h.document.hidden = true; h.state.visibility(); h.document.hidden = false; h.state.visibility(); }
    // Real match polling is paused while hidden: the first new response arrives AFTER return.
    h.change(); await h.state.update();
    assert.equal(h.state.cues.value.length, 0); assert.equal(h.state.impacts.value.length, 0);
    h.change(); await h.state.update(); assert.equal(h.state.impacts.value[0].amount, 30);
  }
});
