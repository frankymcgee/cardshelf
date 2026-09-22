import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as effects from '../shared/arena-effects.mjs';
const table = () => ({ version: 'pokemon-expanded-v2', seat: 0, phase: 'playing', turn: 0, turn_number: 1,
  players: [{ hand: [], bench: [], discard: [] }, { hand: [], bench: [], discard: [] }], events: [{ n: 1, kind: 'setup' }] });
test('unknown results and condition values never invent a defeat or unsupported status', () => {
  const a = table(); a.players[0].active = { id: 'a', card: {}, conditions: {} };
  const b = structuredClone(a); b.phase = 'finished'; b.result = null; b.players[0].active.conditions.special = '__proto__';
  assert.deepEqual(effects.arenaEffectPlan(effects.arenaEffectFrame(a, 'm', 1), effects.arenaEffectFrame(b, 'm', 2), b.events).cues, []);
});
test('successful equal-revision polling keeps a long thinking turn fresh without replaying it', async () => {
  const source = fs.readFileSync(new URL('../app/components/arena/ArenaEffects.vue', import.meta.url), 'utf8');
  const script = source.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1].replace(/^import .*$/mg, '');
  const js = ts.transpileModule(script, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  const props = { table: table(), matchId: 'm', revision: 1, available: true }, mounts = []; let now = 1000;
  const state = vm.runInNewContext('(function(){' + js + ';return {update,cues};})()', {
    ...effects, Date: { now: () => now }, defineProps: () => props, ref: value => ({ value }),
    computed: fn => ({ get value() { return fn(); } }), watch() {}, onMounted: fn => mounts.push(fn), onBeforeUnmount() {}, nextTick: () => Promise.resolve(),
    document: { hidden: false, addEventListener() {} }, window: { matchMedia: () => ({ matches: false, addEventListener() {} }), addEventListener() {} },
    setTimeout: () => 1, clearTimeout() {}
  });
  mounts.forEach(fn => fn()); now += 20000; props.table = structuredClone(props.table); await state.update();
  assert.equal(state.cues.value.length, 0);
  props.table = structuredClone(props.table); props.table.events.push({ n: 2, kind: 'coin', heads: true }); props.revision++;
  await state.update(); assert.equal(state.cues.value[0].text, 'Coin · Heads');
});
