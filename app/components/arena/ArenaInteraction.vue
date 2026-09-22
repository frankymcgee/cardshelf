<script setup lang="ts">
import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { arenaHandOptions, arenaInteractionStamp } from '../../../shared/arena.mjs'
import ArenaCard from './ArenaCard.vue'
import ArenaModal from './ArenaModal.vue'
const props = defineProps<{ table: any; selected?: string; locked?: boolean }>()
const emit = defineEmits<{ select: [unit: any]; action: [action: any] }>()
const surface = ref<HTMLElement | null>(null), gesture = ref<any>(null), review = ref<any>(null), hint = ref('')
const options = computed<any[]>(() => arenaHandOptions(props.table, props.locked))
const playable = computed<string[]>(() => [...new Set(options.value.map((option: any) => option.card))])
const stamp = computed(() => arenaInteractionStamp(props.table))
const handUnit = (id: string) => props.table?.players?.[props.table.seat]?.hand?.find((unit: any) => unit && !unit.hidden && unit.card && unit.id === id)
const activeId = computed<string>(() => gesture.value?.card || props.selected || '')
const targets = computed<string[]>(() => [...new Set(options.value.filter((option: any) => option.card === activeId.value).map((option: any) => option.target))])
const over = ref('')
const dragUnit = computed(() => gesture.value?.moved && handUnit(gesture.value.card))
const reviewUnit = computed(() => review.value && handUnit(review.value.card))
const reviewMoves = computed(() => !review.value || review.value.stamp !== stamp.value ? [] : options.value.filter((option: any) => option.card === review.value.card && (!review.value.target || option.target === review.value.target)))
const ghostStyle = computed(() => !gesture.value ? {} : { left: Math.max(8, Math.min(window.innerWidth - 108, gesture.value.x + 18)) + 'px', top: Math.max(8, Math.min(window.innerHeight - 160, gesture.value.y - 65)) + 'px' })
let frame = 0, suppressClickUntil = 0
function stopGesture() {
  const old = gesture.value
  gesture.value = null; over.value = ''; cancelAnimationFrame(frame); frame = 0
  try { if (old && surface.value?.hasPointerCapture(old.pointer)) surface.value.releasePointerCapture(old.pointer) } catch { /* Capture may already have been released by the browser. */ }
}
function cancel(message = '') {
  if (gesture.value?.moved) suppressClickUntil = Date.now() + 350
  stopGesture(); review.value = null
  if (message) hint.value = message
}
function valid(intent: any) {
  return intent && !props.locked && intent.stamp === stamp.value && handUnit(intent.card) && options.value.some((option: any) => option.card === intent.card)
}
function hitTarget(x: number, y: number, card: string) {
  let node = document.elementFromPoint(x, y) as HTMLElement | null
  if (!node || !surface.value?.contains(node)) return ''
  const allowed = options.value.filter((option: any) => option.card === card).map((option: any) => option.target)
  while (node && node !== surface.value) {
    const target = node.dataset?.arenaDrop
    if (target && allowed.includes(target)) return target
    node = node.parentElement
  }
  return ''
}
function scrollDuringDrag() {
  const g = gesture.value
  if (!g?.moved) return
  // Scroll only while deliberately dragging, with a bounded step near viewport edges.
  const dy = g.y < 56 ? -10 : g.y > window.innerHeight - 56 ? 10 : 0
  if (dy) { window.scrollBy(0, dy); over.value = hitTarget(g.x, g.y, g.card) }
  frame = requestAnimationFrame(scrollDuringDrag)
}
function beginDrag(unit: any, event: PointerEvent) {
  if (gesture.value || review.value || event.button !== 0 || event.isPrimary === false || !handUnit(unit?.id) || !playable.value.includes(unit.id)) return
  gesture.value = { card: unit.id, pointer: event.pointerId, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, stamp: stamp.value, moved: false, origin: event.currentTarget }
  hint.value = ''
}
function moveDrag(event: PointerEvent) {
  const g = gesture.value
  if (!g || event.pointerId !== g.pointer) return
  if (!valid(g) || event.pointerType === 'mouse' && !(event.buttons & 1)) { cancel('Drag cancelled. Nothing was played.'); return }
  g.x = event.clientX; g.y = event.clientY
  if (!g.moved && Math.hypot(g.x - g.startX, g.y - g.startY) < 8) return
  if (!g.moved) {
    try { surface.value?.setPointerCapture(g.pointer) } catch { cancel('Dragging is unavailable here. Use Choose target instead.'); return }
    g.moved = true; emit('select', handUnit(g.card)); hint.value = 'Choose a highlighted target. Release to review, or press Escape to cancel.'
    frame = requestAnimationFrame(scrollDuringDrag)
  }
  event.preventDefault(); over.value = hitTarget(g.x, g.y, g.card)
}
function endDrag(event: PointerEvent) {
  const g = gesture.value
  if (!g || event.pointerId !== g.pointer) return
  if (!g.moved) { stopGesture(); return }
  event.preventDefault()
  const target = valid(g) ? hitTarget(event.clientX, event.clientY, g.card) : ''
  stopGesture(); suppressClickUntil = Date.now() + 350
  if (!target) { hint.value = 'No legal target here. Nothing was played.'; return }
  if (g.origin instanceof HTMLElement && g.origin.isConnected) g.origin.focus({ preventScroll: true })
  review.value = { card: g.card, target, stamp: stamp.value }
  hint.value = 'Review the move before confirming. Nothing has been played yet.'
}
function chooseTargets(unit: any) {
  if (gesture.value || !handUnit(unit?.id) || !playable.value.includes(unit.id)) return
  emit('select', handUnit(unit.id)); review.value = { card: unit.id, target: '', stamp: stamp.value }
}
function confirm(key: string) {
  if (!valid(review.value)) { cancel('The table changed. Select the card again.'); return }
  const choice = reviewMoves.value.find((option: any) => option.key === key)
  if (!choice) { cancel('That move is no longer available. Nothing was played.'); return }
  // Clear the local intent before forwarding the unchanged server payload once.
  review.value = null; hint.value = 'Move submitted for server validation.'; emit('action', choice.action)
}
function swallowClick(event: MouseEvent) {
  if (event.detail > 0 && Date.now() < suppressClickUntil) {
    suppressClickUntil = 0; event.preventDefault(); event.stopPropagation()
  }
}
function escape(event: KeyboardEvent) { if (event.key === 'Escape' && gesture.value) { event.preventDefault(); cancel('Drag cancelled. Nothing was played.') } }
function interrupted(event: PointerEvent) { if (gesture.value && event.pointerId === gesture.value.pointer) cancel('Drag cancelled. Nothing was played.') }
function additionalPointer(event: PointerEvent) {
  if (gesture.value && event.pointerId !== gesture.value.pointer) cancel('Drag cancelled. Nothing was played.')
  // A fresh press is deliberate input, not the synthetic click following a drop.
  else if (!gesture.value) suppressClickUntil = 0
}
function pause() { if (gesture.value || review.value) cancel('Interaction cancelled. Select the card again.') }
function visibility() { if (document.hidden) pause() }
watch([stamp, () => props.locked, () => props.selected], () => {
  const intent = review.value || gesture.value
  if (intent && (!valid(intent) || (review.value || gesture.value?.moved) && props.selected !== intent.card)) cancel('The table or selection changed. Nothing was played.')
}, { flush: 'sync' })
onMounted(() => {
  window.addEventListener('pointermove', moveDrag, { passive: false }); window.addEventListener('pointerup', endDrag)
  window.addEventListener('pointercancel', interrupted); window.addEventListener('pointerdown', additionalPointer, true)
  window.addEventListener('keydown', escape); window.addEventListener('blur', pause); window.addEventListener('resize', pause)
  document.addEventListener('visibilitychange', visibility)
})
onBeforeUnmount(() => {
  cancel(); window.removeEventListener('pointermove', moveDrag); window.removeEventListener('pointerup', endDrag)
  window.removeEventListener('pointercancel', interrupted); window.removeEventListener('pointerdown', additionalPointer, true)
  window.removeEventListener('keydown', escape); window.removeEventListener('blur', pause); window.removeEventListener('resize', pause)
  document.removeEventListener('visibilitychange', visibility)
})
</script>
<template>
  <div ref="surface" class="arena-play-surface" :class="{ 'is-arena-dragging': !!dragUnit }" @click.capture="swallowClick" @lostpointercapture="interrupted">
    <slot v-bind="{ playable, targets, over, beginDrag, chooseTargets }" />
    <p class="arena-play-status" role="status" aria-live="polite">{{ hint || 'Highlighted hand cards have a server-provided move. Select first; confirm before playing.' }}</p>
    <div v-if="dragUnit" class="arena-drag-ghost" :style="ghostStyle" aria-hidden="true"><ArenaCard :unit="dragUnit" :tabindex="-1" /><span>{{ over ? 'Release to review' : 'Choose a highlighted target' }}</span></div>
    <ArenaModal :open="!!review && !!reviewUnit" label="Confirm card play" @close="review = null">
      <template v-if="reviewUnit">
        <p><strong>{{ reviewUnit.card.name }}</strong> · Nothing has been played yet. Confirm one server-provided move, or close to return to the table.</p>
        <div class="arena-play-confirmations"><button v-for="move in reviewMoves" :key="move.key" type="button" class="arena-button primary" :disabled="locked" @click="confirm(move.key)"><span>Confirm: {{ move.label }}</span><small>{{ move.targetLabel }}</small></button></div>
        <p v-if="!reviewMoves.length">No move is available. Close this preview and select the card again.</p>
      </template>
    </ArenaModal>
  </div>
</template>
