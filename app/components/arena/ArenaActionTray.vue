<script setup lang="ts">
const props = defineProps<{ unit: any; moves: any[]; locked?: boolean; hint?: string }>()
const emit = defineEmits<{ action: [action: any]; inspect: []; clear: [] }>()
function choose(move: any) {
  // Selection never submits a move. Only a present server-provided button can emit one.
  if (props.locked || !props.unit || props.unit.hidden || !props.unit.card || !props.moves.includes(move)) return
  emit('action', move.action)
}
</script>
<template>
  <section v-if="unit && !unit.hidden && unit.card" class="arena-panel arena-action-tray" aria-label="Selected card actions">
    <div class="arena-tray-heading"><div><span class="arena-kicker">SELECTED CARD</span><strong>{{ unit.card.name }}</strong></div><button type="button" class="arena-button quiet" aria-haspopup="dialog" @click="emit('inspect')">Inspect</button><button type="button" class="arena-tray-clear" aria-label="Clear card selection" @click="emit('clear')">×</button></div>
    <div class="arena-legal-moves"><button v-for="move in moves" :key="JSON.stringify(move.action)" type="button" class="arena-button" :class="move.action.type === 'attack' ? 'attack' : 'primary'" :disabled="locked" @click="choose(move)">{{ move.label }}</button></div>
    <p v-if="locked" class="arena-muted" role="status">Actions paused. Inspection is still available.</p>
    <p v-else-if="!moves.length" class="arena-muted">{{ hint || 'This card has no available move right now.' }}</p>
  </section>
</template>
