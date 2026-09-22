import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { tableFixture } from './helpers/arena-table-fixtures.mjs';
const source = fs.readFileSync(new URL('../app/components/arena/ArenaBoard.vue', import.meta.url), 'utf8');
function state(props) {
  const script = source.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1].replace(/^import .*$/mg, '');
  const js = ts.transpileModule(script, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  return vm.runInNewContext('(function(){' + js + ';return {self,other,sides,player,fieldZones,visibleBacks,turnLabel};})()', {
    defineProps: () => props, defineEmits: () => () => {}, computed: fn => ({ get value() { return fn(); } })
  });
}
for (const seat of [0, 1]) {
  test(`seat ${seat}: opponent is above the viewer and Active zones face the centre`, () => {
    const props = tableFixture({ seat }), before = JSON.stringify(props), h = state(props);
    assert.deepEqual(Array.from(h.sides.value), [1 - seat, seat]);
    assert.deepEqual(Array.from(h.fieldZones(1 - seat)), ['bench', 'active']);
    assert.deepEqual(Array.from(h.fieldZones(seat)), ['active', 'bench']);
    assert.equal(h.player(seat), props.table.players[seat]);
    assert.equal(JSON.stringify(props), before);
  });
}
test('decorative backs are bounded and malformed counts never allocate huge arrays', () => {
  const h = state(tableFixture());
  for (const value of [-1, 0, null, '7', NaN, Infinity, 1.5]) assert.equal(h.visibleBacks(value, 12), 0);
  assert.equal(h.visibleBacks(7, 12), 7);
  assert.equal(h.visibleBacks(60, 12), 12);
  assert.equal(h.visibleBacks(60, 6), 6);
});
test('table caption follows setup, both turns, prompts and match completion', () => {
  const props = tableFixture(), h = state(props);
  assert.equal(h.turnLabel.value, 'Your turn');
  props.table.turn = 1; assert.equal(h.turnLabel.value, 'South player is playing');
  props.table.waiting_for = 1; assert.equal(h.turnLabel.value, 'Opponent is choosing…');
  props.table.waiting_for = 0; props.table.prompt = {}; assert.equal(h.turnLabel.value, 'Your decision is needed');
  props.table.phase = 'setup'; assert.equal(h.turnLabel.value, 'Opening setup');
  props.table.phase = 'finished'; assert.equal(h.turnLabel.value, 'Match complete');
});
test('table remains a presentation component with the original event contract and no API calls', () => {
  assert.match(source, /select: \[unit: any\]; discard: \[seat: number\]; action: \[action: any\]/);
  assert.doesNotMatch(source, /useApi|\bfetch\s*\(|localStorage|sessionStorage|\.reverse\s*\(|\.sort\s*\(/);
  assert.match(source, /@click="emit\('discard', seat\)"/);
  assert.match(source, /:disabled="locked" @click="emit\('action', move.action\)"/);
});
test('both tutorial focus hooks and keyboard-accessible hand scrolling remain present', () => {
  for (const zone of ['active', 'prizes', 'hand']) assert.ok(source.includes(`data-zone="${zone}"`));
  assert.match(source, /class="arena-hand-fan" tabindex="0" role="region"/);
  assert.match(source, /:data-focus-zone="focusZone \|\| ''"/);
});
