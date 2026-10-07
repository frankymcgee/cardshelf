// Synthetic acknowledged snapshots; not shipped as a Nuxt route or connected to real accounts.
import { createApp, reactive, h } from '/vue.js';
import ArenaEffects from '/app/components/arena/ArenaEffects.vue';
import ArenaBoard from '/app/components/arena/ArenaBoard.vue';
import { tableFixture, tableUnit } from '/tests/helpers/arena-table-fixtures.mjs';
const query = new URLSearchParams(location.search), seat = query.has('seat1') ? 1 : 0;
const fixture = tableFixture({ seat, legacy: query.has('legacy') });
fixture.table.version = query.has('legacy') ? 'pokemon-core-v1' : 'pokemon-expanded-v2';
fixture.table.round = 1; fixture.table.events = [{ n: 1, seat, kind: 'setup', text: 'Training table' }];
for (const p of fixture.table.players) p.bench = p.bench.slice(0, 1);
fixture.table.players[seat].active.damage = 20;
fixture.table.players[seat].hand[1].card = { id: 'training:energy', name: 'Training Energy', kind: 'energy', type: 'Grass' };
fixture.table.players[seat].hand[2].card = { id: 'training:stadium', name: 'Training Stadium', kind: 'trainer', program: { kind: 'stadium' } };
fixture.table.legal = [{ card: 'Hand-0', label: 'Play to Bench', action: { type: 'bench', card: 'Hand-0' } }];
const state = reactive({ ...fixture, revision: 1, matchId: 'effects-training', available: true, show: true });
const actions = [], selections = [];
function advance(kind) {
  const t = JSON.parse(JSON.stringify(state.table)), p = t.players[seat], op = t.players[1 - seat];
  const event = (kind, extra = {}) => t.events.push({ n: t.events.at(-1).n + 1, kind, seat, ...extra });
  const take = index => p.hand.splice(p.hand.findIndex(u => u.id === 'Hand-' + index), 1)[0];
  if (kind === 'play') { p.bench.push(take(0)); event('bench'); }
  if (kind === 'opponent-play') { op.bench.push(tableUnit('Revealed-Opponent')); event('bench', { seat: 1 - seat }); }
  if (kind === 'evolve') { const prior = p.active; p.active = take(0); p.active.under = [prior]; p.active.card.stage = 'Stage1'; event('evolve', { target: p.active.id }); }
  if (kind === 'attach') { p.active.energy.push(take(1)); event('energy', { target: p.active.id }); }
  if (kind === 'swap') { const a = p.active; p.active = p.bench[0]; p.bench = [a]; event('switch'); }
  if (kind === 'attack') { op.active.damage += 30; event('attack', { attacker: p.active.id, target: op.active.id, attack: 'Training Strike', damage: 30 }); }
  if (kind === 'coin') event('coin', { heads: true });
  if (kind === 'status') { op.active.conditions = { poison: true, special: 'asleep' }; op.active.damage += 10; event('condition', { seat: 1 - seat, target: op.active.id, damage: 10 }); }
  if (kind === 'heal') { p.active.damage = 0; event('heal', { target: p.active.id }); }
  if (kind === 'draw' || kind === 'prize') { p.hand.push(tableUnit('NEW-PRIVATE-' + kind)); if (kind === 'draw') p.deck_count--; else p.prize_count--; event(kind); }
  if (kind === 'stadium') { t.stadium = { seat, unit: take(2) }; event('trainer'); }
  if (kind === 'turn') { t.turn = 1 - seat; t.turn_number++; op.hand_count++; op.deck_count--; event('turn', { seat: t.turn, turn: t.turn_number }); }
  if (kind === 'knockout') { const defeated = op.active; event('attack', { attacker: p.active.id, target: defeated.id, attack: 'Final Strike', damage: 100 }); event('knockout', { seat: 1 - seat, card: { name: defeated.card.name } }); op.active = tableUnit('Replacement'); op.discard.push({ ...defeated, id: 'rekeyed-discard' }); }
  if (kind === 'result') { t.phase = 'finished'; t.result = seat; event('result'); }
  if (kind === 'burst') for (let i = 0; i < 15; i++) event('coin', { heads: true });
  if (kind === 'remove') p.hand = [];
  p.hand_count = p.hand.length; state.table = t; state.revision++;
}
window.effectsFixture = { state, actions, selections, advance, poll() { state.table = JSON.parse(JSON.stringify(state.table)); } };
createApp({ setup() { return () => h('div', { class: 'arena-root' }, h('main', { class: 'arena-main' }, [
  h('h1', 'Arena · Confirmed battle effects'),
  state.show ? h(ArenaEffects, { table: state.table, matchId: state.matchId, revision: state.revision, available: state.available }, { default: () => h(ArenaBoard, {
    table: state.table, aliases: state.aliases, selected: state.selected, stadiumMoves: [], locked: !state.available,
    onSelect: unit => { state.selected = unit.id; selections.push(unit.id); }, onAction: action => actions.push(action), onDiscard: () => {}
  }) }) : h('p', 'Table unmounted')
])); } }).mount('#app');
