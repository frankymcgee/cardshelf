<script setup lang="ts">
import ArenaCard from './ArenaCard.vue'
import ArenaTable from './ArenaTable.vue'
import ArenaPlayerZone from './ArenaPlayerZone.vue'
import ArenaHandFan from './ArenaHandFan.vue'
import ArenaInteraction from './ArenaInteraction.vue'
const props = defineProps<{ table: any; aliases: string[]; selected?: string; hit?: string; focusZone?: string; stadiumMoves?: any[]; locked?: boolean; spectator?: boolean }>()
const emit = defineEmits<{ select: [unit: any]; discard: [seat: number]; action: [action: any] }>()
const self = computed(() => props.table.seat), other = computed(() => self.value === 0 ? 1 : 0)
const sides = computed(() => [other.value, self.value])
const player = (seat: number) => props.table.players[seat]
// Reusable boards may receive an incomplete alias list; child labels always need text.
const alias = (seat: number): string => props.aliases[seat] || `Player ${seat + 1}`
// Give field/pile components only public values. Hidden-zone contents are never props.
function publicPlayer(seat: number) {
  const p = player(seat)
  const top = p.discard[p.discard.length - 1]
  return { active: p.active, bench: p.bench, hand_count: p.hand_count, deck_count: p.deck_count, prize_count: p.prize_count, discard_count: p.discard.length, discardTop: top && !top.hidden ? top.card : undefined, ready: p.ready }
}
const turnLabel = computed(() => {
  if (props.spectator) return props.table.phase === 'setup' ? 'Opening setup' : props.table.phase === 'finished' ? 'Match complete' : props.table.waiting_for != null ? `${alias(props.table.waiting_for)} is choosing…` : `${alias(props.table.turn)} is playing`
  if (props.table.phase === 'setup') return 'Opening setup'
  if (props.table.phase !== 'playing') return 'Match complete'
  if (props.table.waiting_for != null && props.table.waiting_for !== self.value) return 'Opponent is choosing…'
  if (props.table.prompt) return 'Your decision is needed'
  return props.table.turn === self.value ? 'Your turn' : `${alias(props.table.turn)} is playing`
})
</script>
<template>
  <ArenaInteraction v-slot="interaction" :table="table" :selected="selected" :locked="locked" @select="emit('select', $event)" @action="emit('action', $event)">
  <ArenaTable :focus-zone="focusZone">
    <template v-for="seat in sides" :key="seat">
      <ArenaPlayerZone :player="publicPlayer(seat)" :alias="alias(seat)" :seat="seat" :self="seat === self" :spectator="spectator" :turn="table.turn === seat && table.phase === 'playing'" :setup="table.phase === 'setup'" :turn-number="table.turn_number" :selected="selected" :hit="hit" :targets="interaction.targets" :over="interaction.over" @select="emit('select', $event)" @discard="emit('discard', $event)" />
      <section v-if="seat !== self" class="arena-table-centre" aria-label="Battlefield">
        <div class="arena-table-status"><span class="arena-kicker">BATTLEFIELD</span><strong>{{ turnLabel }}</strong><small v-if="table.phase === 'playing'">Turn {{ table.turn_number }}</small></div>
        <section v-if="table.stadium !== undefined" class="arena-stadium-slot" data-arena-drop="stadium" :class="{ 'is-arena-target': interaction.targets.includes('stadium'), 'is-arena-over': interaction.over === 'stadium' }" aria-label="Shared Stadium">
          <template v-if="table.stadium?.unit && !table.stadium.unit.hidden">
            <ArenaCard :unit="table.stadium.unit" :selected="selected === table.stadium.unit.id" :label="'Inspect Stadium: ' + table.stadium.unit.card.name" @select="emit('select', $event)" />
            <div><span class="arena-kicker">SHARED STADIUM</span><button type="button" class="arena-link" @click="emit('select', table.stadium.unit)">{{ table.stadium.unit.card.name }}</button><small>Played by {{ alias(table.stadium.seat) }} · affects both fields as written</small><button v-for="move in stadiumMoves || []" :key="JSON.stringify(move.action)" type="button" class="arena-button" :disabled="locked" @click="emit('action', move.action)">{{ move.label }}</button></div>
          </template>
          <div v-else><span class="arena-kicker">SHARED STADIUM</span><p>No Stadium in play.</p><small v-if="!spectator">Play a supported Stadium from your hand.</small></div>
        </section>
        <div v-else class="arena-table-core-mark" aria-hidden="true">CS</div>
        <div v-if="!spectator" class="arena-trainer-target" data-arena-drop="trainer" :class="{ 'is-arena-target': interaction.targets.includes('trainer'), 'is-arena-over': interaction.over === 'trainer' }"><span class="arena-kicker">TRAINER PLAY AREA</span><small>Drop a highlighted Trainer here to review its move.</small></div>
      </section>
    </template>
    <template #hand><ArenaHandFan v-if="!spectator" :cards="player(self).hand" :selected="selected" :playable="interaction.playable" @drag="interaction.beginDrag" @choose="interaction.chooseTargets" @select="emit('select', $event)" /></template>
    <template #actions><slot name="actions" /></template>
  </ArenaTable>
  </ArenaInteraction>
</template>
