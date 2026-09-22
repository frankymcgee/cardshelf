<script setup lang="ts">
import ArenaCard from './ArenaCard.vue'
import ArenaTable from './ArenaTable.vue'
import ArenaPlayerZone from './ArenaPlayerZone.vue'
import ArenaHandFan from './ArenaHandFan.vue'
const props = defineProps<{ table: any; aliases: string[]; selected?: string; hit?: string; focusZone?: string; stadiumMoves?: any[]; locked?: boolean }>()
const emit = defineEmits<{ select: [unit: any]; discard: [seat: number]; action: [action: any] }>()
const self = computed(() => props.table.seat), other = computed(() => self.value === 0 ? 1 : 0)
const sides = computed(() => [other.value, self.value])
const player = (seat: number) => props.table.players[seat]
// Give field/pile components only public values. Hidden-zone contents are never props.
function publicPlayer(seat: number) {
  const p = player(seat)
  return { active: p.active, bench: p.bench, hand_count: p.hand_count, deck_count: p.deck_count, prize_count: p.prize_count, discard_count: p.discard.length, ready: p.ready }
}
const turnLabel = computed(() => {
  if (props.table.phase === 'setup') return 'Opening setup'
  if (props.table.phase !== 'playing') return 'Match complete'
  if (props.table.waiting_for != null && props.table.waiting_for !== self.value) return 'Opponent is choosing…'
  if (props.table.prompt) return 'Your decision is needed'
  return props.table.turn === self.value ? 'Your turn' : `${props.aliases[props.table.turn]} is playing`
})
</script>
<template>
  <ArenaTable :focus-zone="focusZone">
    <template v-for="seat in sides" :key="seat">
      <ArenaPlayerZone :player="publicPlayer(seat)" :alias="aliases[seat]" :seat="seat" :self="seat === self" :turn="table.turn === seat && table.phase === 'playing'" :setup="table.phase === 'setup'" :turn-number="table.turn_number" :selected="selected" :hit="hit" @select="emit('select', $event)" @discard="emit('discard', $event)" />
      <section v-if="seat !== self" class="arena-table-centre" aria-label="Battlefield">
        <div class="arena-table-status"><span class="arena-kicker">BATTLEFIELD</span><strong>{{ turnLabel }}</strong><small v-if="table.phase === 'playing'">Turn {{ table.turn_number }}</small></div>
        <section v-if="table.stadium !== undefined" class="arena-stadium-slot" aria-label="Shared Stadium">
          <template v-if="table.stadium?.unit && !table.stadium.unit.hidden">
            <ArenaCard :unit="table.stadium.unit" :selected="selected === table.stadium.unit.id" :label="'Inspect Stadium: ' + table.stadium.unit.card.name" @select="emit('select', $event)" />
            <div><span class="arena-kicker">SHARED STADIUM</span><button type="button" class="arena-link" @click="emit('select', table.stadium.unit)">{{ table.stadium.unit.card.name }}</button><small>Played by {{ aliases[table.stadium.seat] }} · affects both fields as written</small><button v-for="move in stadiumMoves || []" :key="JSON.stringify(move.action)" type="button" class="arena-button" :disabled="locked" @click="emit('action', move.action)">{{ move.label }}</button></div>
          </template>
          <div v-else><span class="arena-kicker">SHARED STADIUM</span><p>No Stadium in play.</p><small>Play a supported Stadium from your hand.</small></div>
        </section>
        <div v-else class="arena-table-core-mark" aria-hidden="true">CS</div>
      </section>
    </template>
    <ArenaHandFan :cards="player(self).hand" :selected="selected" @select="emit('select', $event)" />
  </ArenaTable>
</template>
