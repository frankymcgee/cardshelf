<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import ArenaCard from './ArenaCard.vue'
const props = defineProps<{ cards: any[]; selected?: string }>()
const emit = defineEmits<{ select: [unit: any] }>()
const scroller = ref<HTMLElement | null>(null), focusedIndex = ref(0)
function fanStyle(index: number) {
  const offset = index - (props.cards.length - 1) / 2
  // A bounded fan for ordinary hands; a straight scrollable row for unusually large hands.
  return { '--fan-tilt': (props.cards.length > 12 ? 0 : Math.max(-6, Math.min(6, offset * 1.3))) + 'deg', '--fan-drop': (props.cards.length > 12 ? 0 : Math.min(12, Math.abs(offset) * 2)) + 'px' }
}
function focusCard(index: number) {
  if (!props.cards.length) return
  focusedIndex.value = Math.max(0, Math.min(props.cards.length - 1, index))
  const card = scroller.value?.querySelector<HTMLElement>(`[data-hand-index="${focusedIndex.value}"]`)
  card?.focus({ preventScroll: true })
  card?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' })
}
function onKey(event: KeyboardEvent) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || !props.cards.length) return
  event.preventDefault()
  focusCard(event.key === 'Home' ? 0 : event.key === 'End' ? props.cards.length - 1 : focusedIndex.value + (event.key === 'ArrowRight' ? 1 : -1))
}
function selectCard(unit: any) {
  if (!unit || unit.hidden || !unit.card || !props.cards.some(card => card === unit)) return
  emit('select', unit)
}
watch(() => props.cards.map(card => card.id).join('|'), async () => {
  const hadFocus = typeof document !== 'undefined' && scroller.value?.contains(document.activeElement)
  focusedIndex.value = Math.min(focusedIndex.value, Math.max(0, props.cards.length - 1))
  await nextTick()
  if (hadFocus && scroller.value) {
    if (props.cards.length) focusCard(focusedIndex.value)
    else scroller.value.focus({ preventScroll: true })
  }
})
</script>
<template>
  <section class="arena-hand-area" data-zone="hand" aria-label="Your private hand">
    <div class="arena-zone-caption"><strong>Your hand</strong><span>{{ cards.length }} cards · only you can see these</span></div>
    <p class="arena-hand-hint">Tap a card to select · use Inspect for a closer look</p>
    <div ref="scroller" class="arena-hand-fan arena-hand-interactive" tabindex="0" role="region" aria-label="Your hand cards; scroll horizontally for more" @keydown="onKey">
      <ArenaCard v-for="(unit, index) in cards" :key="unit.id" :unit="unit" :selected="selected === unit.id" :data-hand-index="index" :tabindex="index === focusedIndex ? 0 : -1" :style="fanStyle(index)" @focus="focusedIndex = index" @select="selectCard" />
      <p v-if="!cards.length" class="arena-muted">Your hand is empty.</p>
    </div>
  </section>
</template>
