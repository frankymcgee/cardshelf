import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { tableFixture } from './helpers/arena-table-fixtures.mjs';
const read = name => fs.readFileSync(new URL('../app/components/arena/' + name + '.vue', import.meta.url), 'utf8');
const source = read('ArenaBoard');
function state(name, props, exports) {
  const script = read(name).match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1].replace(/^import .*$/mg, '');
  const js = ts.transpileModule(script, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  return vm.runInNewContext('(function(){' + js + ';return {' + exports + '};})()', {
    defineProps: () => props, defineEmits: () => () => {}, computed: fn => ({ get value() { return fn(); } })
  });
}
for (const seat of [0, 1]) {
  test(`seat ${seat}: opponent is above the viewer and Active zones face the centre`, () => {
    const props = tableFixture({ seat }), before = JSON.stringify(props);
    const h = state('ArenaBoard', props, 'self,other,sides,player,publicPlayer');
    assert.deepEqual(Array.from(h.sides.value), [1 - seat, seat]);
    assert.deepEqual(Array.from(state('ArenaPlayerZone', { self: false }, 'zones').zones.value), ['bench', 'active']);
    assert.deepEqual(Array.from(state('ArenaPlayerZone', { self: true }, 'zones').zones.value), ['active', 'bench']);
    assert.equal(h.player(seat), props.table.players[seat]);
    for (const index of [0, 1]) {
      const view = h.publicPlayer(index);
      assert.equal(view.active, props.table.players[index].active);
      assert.equal(view.bench, props.table.players[index].bench);
      assert.equal(view.discard_count, props.table.players[index].discard.length);
      for (const zone of ['hand', 'deck', 'prizes', 'discard']) assert.equal(Object.hasOwn(view, zone), false);
    }
    assert.equal(JSON.stringify(props), before);
  });
}
test('decorative backs are bounded and malformed counts never allocate huge arrays', () => {
  const h = state('ArenaCardStack', {}, 'visibleBacks');
  for (const value of [-1, 0, null, '7', NaN, Infinity, 1.5]) assert.equal(h.visibleBacks(value, 12), 0);
  assert.equal(h.visibleBacks(7, 12), 7);
  assert.equal(h.visibleBacks(60, 12), 12);
  assert.equal(h.visibleBacks(60, 6), 6);
});
test('table caption follows setup, both turns, prompts and match completion', () => {
  const props = tableFixture(), h = state('ArenaBoard', props, 'turnLabel');
  assert.equal(h.turnLabel.value, 'Your turn');
  props.table.turn = 1; assert.equal(h.turnLabel.value, 'South player is playing');
  props.table.waiting_for = 1; assert.equal(h.turnLabel.value, 'Opponent is choosing…');
  props.table.waiting_for = 0; props.table.prompt = {}; assert.equal(h.turnLabel.value, 'Your decision is needed');
  props.table.phase = 'setup'; assert.equal(h.turnLabel.value, 'Opening setup');
  props.table.phase = 'finished'; assert.equal(h.turnLabel.value, 'Match complete');
});
test('table remains a presentation component with the original event contract and no API calls', () => {
  assert.match(source, /select: \[unit: any\]; discard: \[seat: number\]; action: \[action: any\]/);
  for (const name of ['ArenaBoard', 'ArenaTable', 'ArenaPlayerZone', 'ArenaFieldZone', 'ArenaCardStack', 'ArenaDiscardPile', 'ArenaHandFan']) {
    assert.doesNotMatch(read(name), /useApi|\bfetch\s*\(|localStorage|sessionStorage|\.reverse\s*\(|\.sort\s*\(/);
  }
  assert.match(source, /@discard="emit\('discard', \$event\)"/);
  assert.match(read('ArenaPlayerZone'), /@inspect="emit\('discard', seat\)"/);
  assert.match(source, /:disabled="locked" @click="emit\('action', move.action\)"/);
});
test('tutorial focus hooks and keyboard-accessible hand scrolling remain on the delegated components', () => {
  assert.ok(read('ArenaFieldZone').includes('data-zone="active"'));
  assert.ok(read('ArenaCardStack').includes('data-zone="prizes"'));
  assert.ok(read('ArenaHandFan').includes('data-zone="hand"'));
  assert.match(read('ArenaHandFan'), /tabindex="0" role="region"/);
  assert.match(read('ArenaTable'), /:data-focus-zone="focusZone \|\| ''"/);
  assert.match(source, /<ArenaTable :focus-zone="focusZone"/);
});
