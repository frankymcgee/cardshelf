<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import ArenaModal from './ArenaModal.vue'
import { arenaEndTurnMove, arenaEndTurnContext } from '../../../shared/arena-match-ui.mjs'
const props = defineProps<{ table: any; moves: any[]; matchId: string; revision: number; locked: boolean }>()
const emit = defineEmits<{ action: [action: any] }>()
const review = ref('')
const context = computed(() => arenaEndTurnContext(props.table, props.matchId, props.revision, props.locked))
const endMove = computed(() => arenaEndTurnMove(props.moves))
const options = computed(() => (Array.isArray(props.moves) ? props.moves : []).slice(0, 256)
  .filter(move => move && typeof move.label === 'string' && move.action && typeof move.action.type === 'string'))
const reviewing = computed(() => !!review.value && review.value === context.value && !!endMove.value)
function cancel() { review.value = '' }
function choose(move: any) {
  if (props.locked || !options.value.includes(move)) return
  if (move.action.type === 'end_turn') { if (context.value && move === endMove.value) review.value = context.value; return }
  emit('action', move.action)
}
function confirm() {
  // Resolve the current option again, not a cached action from before the dialog.
  const move = endMove.value
  if (!reviewing.value || props.locked || !move || document.hidden) { cancel(); return }
  cancel(); emit('action', move.action)
}
watch(() => [context.value, !!endMove.value], () => { if (!reviewing.value) cancel() }, { flush: 'sync' })
onMounted(() => { window.addEventListener('blur', cancel); document.addEventListener('visibilitychange', cancel) })
onBeforeUnmount(() => { cancel(); window.removeEventListener('blur', cancel); document.removeEventListener('visibilitychange', cancel) })
</script>
<template>
  <div class="arena-turn-actions">
    <button v-for="move in options" :key="JSON.stringify(move.action)" type="button" class="arena-button"
      :class="move.action.type === 'ready' ? 'primary' : ''"
      :disabled="locked || move.action.type === 'end_turn' && (!context || move !== endMove)"
      @click="choose(move)">{{ move.label }}</button>
    <ArenaModal :open="reviewing" label="End your turn?" close-label="Keep playing" @close="cancel">
      <div v-if="reviewing" class="arena-end-turn-review"><h2>End this turn without attacking?</h2>
        <p>This sends the current server-provided End turn action. It does not play an attack or choose any other move for you.</p>
        <p>Choose Keep playing to inspect your cards and available moves. This confirmation expires when the table changes or the connection is interrupted.</p>
        <button type="button" class="arena-button primary" :disabled="locked || !reviewing" @click="confirm">Confirm end turn</button>
      </div>
    </ArenaModal>
  </div>
</template>
<style scoped>
.arena-turn-actions{display:flex;flex-wrap:wrap;gap:8px;min-width:0}.arena-turn-actions>.arena-button{min-height:44px}.arena-end-turn-review{max-width:640px;line-height:1.6}.arena-end-turn-review h2{font-size:23px;line-height:1.3}.arena-end-turn-review .arena-button{min-height:44px;margin-top:12px}
</style>
