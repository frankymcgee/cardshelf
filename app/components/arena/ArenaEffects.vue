<script setup lang="ts">
import { computed, ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { arenaEffectFrame, arenaEffectPlan, arenaEffectUnit, ARENA_EFFECT_LIMITS } from '../../../shared/arena-effects.mjs'
import ArenaCard from './ArenaCard.vue'
const props = defineProps<{ table: any; matchId: string; revision: number; available: boolean }>()
const stage = ref<HTMLElement | null>(null), enabled = ref(true), reduced = ref(false)
const flights = ref<any[]>([]), impacts = ref<any[]>([]), beams = ref<any[]>([]), cues = ref<any[]>([])
const liveFlights = computed(() => flights.value.map(flight => ({ ...flight, unit: flight.id ? arenaEffectUnit(props.table, flight.id) : null })).filter(flight => !flight.id || flight.unit))
let previous: any = null, observedAt = 0, generation = 0, mounted = false
let expiry: ReturnType<typeof setTimeout> | undefined, flightExpiry: ReturnType<typeof setTimeout> | undefined
let preference: MediaQueryList | null = null
function clearEffects() {
  generation++; clearTimeout(expiry); clearTimeout(flightExpiry)
  flights.value = []; impacts.value = []; beams.value = []; cues.value = []
}
function baseline() {
  clearEffects()
  previous = mounted && props.available && !document.hidden ? arenaEffectFrame(props.table, props.matchId, props.revision) : null
  observedAt = Date.now()
}
function interrupt() { clearEffects(); previous = null }
function toggle() { enabled.value = !enabled.value; baseline() }
function changedPreference() {
  const value = !!preference?.matches
  if (value === reduced.value) return
  reduced.value = value; clearEffects()
  // A preference change is not a new game baseline. A delayed change event must
  // not consume an acknowledged update or cancel an effect already using it.
}
function visibility() { if (document.hidden) interrupt(); else baseline() }
// Ignore offscreen/clipped anchors rather than flying artwork across the page or moving the user's viewport.
function rectangle(element: Element | null): any {
  if (!element) return null
  const r = element.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2
  if (![x, y, r.width, r.height].every(Number.isFinite) || r.width < 8 || r.height < 8 || x < 0 || x > window.innerWidth || y < 0 || y > window.innerHeight) return null
  const scroll = element.closest('.arena-hand-fan')
  if (scroll) { const s = scroll.getBoundingClientRect(); if (x < s.left || x > s.right || y < s.top || y > s.bottom) return null }
  return { x, y, width: r.width, height: r.height }
}
function positions(): Map<string, any> {
  const result = new Map<string, any>(), board = stage.value?.querySelector('.arena-table')
  if (!board) return result
  const put = (key: string, element: Element | null) => { const value = rectangle(element); if (value) result.set(key, value) }
  for (const element of board.querySelectorAll<HTMLElement>('[data-hand-id]')) put('unit:' + element.dataset.handId, element)
  for (const element of board.querySelectorAll<HTMLElement>('[data-arena-drop]')) {
    const key = element.dataset.arenaDrop || ''
    if (key.startsWith('card:')) put('unit:' + key.slice(5), element.querySelector('.arena-card') || element)
    else if (key === 'stadium' || key === 'trainer') put(key, element)
  }
  for (const side of board.querySelectorAll<HTMLElement>('[data-side]')) {
    const seat = side.dataset.side === 'self' ? props.table.seat : 1 - props.table.seat
    put(`pile:${seat}:deck`, side.querySelector('.arena-deck-stack'))
    put(`pile:${seat}:discard`, side.querySelector('.arena-table-discard'))
    put(`pile:${seat}:prizes`, side.querySelector('.arena-table-prizes'))
    put(`pile:${seat}:hand`, side.dataset.side === 'self' ? board.querySelector('.arena-hand-interactive') : side.querySelector('.arena-opponent-hand'))
  }
  put('centre', board.querySelector('.arena-table-centre'))
  return result
}
async function update() {
  if (!mounted) return
  if (preference && reduced.value !== preference.matches) changedPreference()
  if (!props.available || document.hidden || !enabled.value) { baseline(); return }
  const after = arenaEffectFrame(props.table, props.matchId, props.revision), before = previous
  if (before && after && after.key === before.key && after.revision <= before.revision) {
    if (after.revision === before.revision) observedAt = Date.now() // A current poll keeps a slow turn fresh without replaying it.
    return
  }
  const elapsed = Date.now() - observedAt
  const origin = positions()
  clearEffects(); const ticket = generation
  previous = after; observedAt = Date.now()
  if (!before || !after) return
  // No historical animation on initial load, reconnect, long inactivity or navigation.
  const plan = elapsed > 15000 ? { moves: [], impacts: [], cues: [] } : arenaEffectPlan(before, after, props.table.events)
  if (!plan.moves.length && !plan.impacts.length && !plan.cues.length) return
  await nextTick()
  if (!mounted || ticket !== generation || !props.available || document.hidden || !enabled.value) return
  cues.value = plan.cues
  if (!reduced.value) {
    const destination = positions()
    flights.value = plan.moves.flatMap((move: any, index: number) => {
      const from = origin.get(move.from), to = destination.get(move.to)
      if (!from || !to || Math.hypot(to.x - from.x, to.y - from.y) < 5) return []
      const width = Math.max(42, Math.min(90, to.width)), height = width * 1.4
      return [{ ...move, key: ticket + ':' + index, style: { left: to.x - width / 2 + 'px', top: to.y - height / 2 + 'px', width: width + 'px', height: height + 'px', '--travel-x': from.x - to.x + 'px', '--travel-y': from.y - to.y + 'px', '--travel-scale': Math.min(1.35, Math.max(.65, from.width / width)) } }]
    })
    impacts.value = plan.impacts.flatMap((impact: any, index: number) => {
      const target = destination.get(impact.target)
      if (!target) return []
      return [{ ...impact, key: ticket + ':' + index, style: { left: target.x + 'px', top: target.y - Math.min(index, 3) * 12 + 'px' } }]
    })
    beams.value = plan.impacts.filter((impact: any) => impact.kind === 'attack' && impact.source).flatMap((impact: any, index: number) => {
      const from = destination.get(impact.source), to = destination.get(impact.target)
      if (!from || !to) return []
      return [{ key: ticket + ':' + index, style: { left: from.x + 'px', top: from.y + 'px', width: Math.hypot(to.x - from.x, to.y - from.y) + 'px', '--beam-angle': Math.atan2(to.y - from.y, to.x - from.x) + 'rad' } }]
    })
    // Clear face-bearing decoration promptly; later frames never reuse old geometry or faces.
    flightExpiry = setTimeout(() => { flights.value = []; beams.value = [] }, ARENA_EFFECT_LIMITS.flight)
  }
  expiry = setTimeout(clearEffects, ARENA_EFFECT_LIMITS.lifetime)
}
watch([() => props.table, () => props.revision, () => props.matchId, () => props.available], update, { flush: 'pre' })
onMounted(() => {
  mounted = true; preference = window.matchMedia('(prefers-reduced-motion: reduce)'); reduced.value = preference.matches
  preference.addEventListener('change', changedPreference)
  window.addEventListener('resize', baseline); window.addEventListener('scroll', interrupt, true)
  window.addEventListener('blur', interrupt); window.addEventListener('focus', baseline)
  document.addEventListener('visibilitychange', visibility); baseline()
})
onBeforeUnmount(() => {
  mounted = false; interrupt(); preference?.removeEventListener('change', changedPreference); preference = null
  window.removeEventListener('resize', baseline); window.removeEventListener('scroll', interrupt, true)
  window.removeEventListener('blur', interrupt); window.removeEventListener('focus', baseline)
  document.removeEventListener('visibilitychange', visibility)
})
</script>
<template>
  <div ref="stage" class="arena-effects-stage">
    <div class="arena-effects-toolbar"><span class="arena-kicker">LIVE TABLE</span><span v-if="reduced" class="arena-effects-preference">Reduced motion · text feedback</span><button type="button" class="arena-button quiet" :aria-pressed="enabled" @click="toggle">Battle effects: {{ enabled ? 'On' : 'Off' }}</button></div>
    <slot />
    <div class="arena-effects-recap" role="status" aria-label="Battle activity" aria-live="polite" aria-atomic="true">
      <span v-for="(cue, index) in cues" :key="index" class="arena-effect-cue" :data-cue="cue.kind"><b v-if="cue.seat === table.seat">YOU · </b><b v-else-if="cue.seat === 0 || cue.seat === 1">OPPONENT · </b>{{ cue.text }}</span>
    </div>
    <div v-if="!reduced && enabled && (liveFlights.length || impacts.length || beams.length)" class="arena-motion-layer" aria-hidden="true" inert>
      <div v-for="beam in beams" :key="beam.key" class="arena-effect-beam" :style="beam.style" />
      <div v-for="flight in liveFlights" :key="flight.key" class="arena-effect-flight" :style="flight.style" :data-flight-kind="flight.kind">
        <ArenaCard v-if="flight.unit" :unit="flight.unit" :tabindex="-1" disabled />
        <div v-else class="arena-effect-card-back">CS</div>
      </div>
      <div v-for="impact in impacts" :key="impact.key" class="arena-effect-impact" :class="'is-' + impact.kind" :data-impact="impact.kind" :style="impact.style">{{ impact.text }}</div>
    </div>
  </div>
</template>
<style src="~/assets/css/arena-effects.css"></style>
