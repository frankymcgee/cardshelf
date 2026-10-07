<script setup lang="ts">
import { computed, ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { arenaEffectFrame, arenaEffectPlan, arenaEffectUnit, ARENA_EFFECT_LIMITS } from '../../../shared/arena-effects.mjs'
import ArenaCard from './ArenaCard.vue'
const props = defineProps<{ table: any; matchId: string; revision: number; available: boolean }>()
const stage = ref<HTMLElement | null>(null), enabled = ref(true), reduced = ref(false), minimal = ref(false)
const motion = computed(() => !enabled.value || !props.available ? 'off' : reduced.value || minimal.value ? 'reduced' : 'full')
const flights = ref<any[]>([]), impacts = ref<any[]>([]), beams = ref<any[]>([]), cues = ref<any[]>([])
const strikes = ref<any[]>([]), bursts = ref<any[]>([]), banners = ref<any[]>([])
const liveFlights = computed(() => flights.value.map(flight => ({ ...flight, unit: flight.id ? arenaEffectUnit(props.table, flight.id) : null })).filter(flight => !flight.id || flight.unit))
const liveStrikes = computed(() => strikes.value.map(strike => ({ ...strike, unit: arenaEffectUnit(props.table, strike.id) })).filter(strike => strike.unit))
let previous: any = null, observedAt = 0, generation = 0, mounted = false
let expiry: ReturnType<typeof setTimeout> | undefined, flightExpiry: ReturnType<typeof setTimeout> | undefined
let preference: MediaQueryList | null = null
function clearEffects() {
  generation++; clearTimeout(expiry); clearTimeout(flightExpiry)
  flights.value = []; impacts.value = []; beams.value = []; cues.value = []
  strikes.value = []; bursts.value = []; banners.value = []
}
function baseline() {
  clearEffects()
  previous = mounted && props.available && !document.hidden ? arenaEffectFrame(props.table, props.matchId, props.revision) : null
  observedAt = Date.now()
}
function interrupt() { clearEffects(); previous = null }
function toggle() { enabled.value = !enabled.value; baseline() }
function toggleMotion() { minimal.value = !minimal.value; baseline() }
function changedPreference() {
  const value = !!preference?.matches
  if (value === reduced.value) return
  reduced.value = value; clearEffects()
  // A preference change is not a new game baseline. A delayed change event must
  // not consume an acknowledged update or cancel an effect already using it.
}
// Hidden-tab polling stops in the match page. Wait for a NEW response after
// visibility/focus returns; the old in-memory table is not a fresh baseline.
function visibility() { interrupt() }
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
// Colour is presentation only; damage and legal moves always come from the server.
function tone(anchor: string) {
  const unit: any = anchor.startsWith('unit:') ? arenaEffectUnit(props.table, anchor.slice(5)) : null
  const type = String(unit?.card?.type || '').toLowerCase()
  return ['fire', 'water', 'grass', 'lightning', 'psychic', 'fighting', 'metal', 'darkness', 'dragon', 'fairy'].includes(type) ? type : 'colorless'
}
function burst(kind: string, target: any, anchor: string, key: string, delay = 0) {
  const radius = Math.max(36, Math.min(86, target.width * .65))
  return { kind, key, tone: tone(anchor), style: { left: target.x + 'px', top: target.y + 'px', '--burst-size': radius * 2 + 'px', '--burst-delay': delay + 'ms' },
    sparks: Array.from({ length: 6 }, (_, index) => {
      const angle = index * Math.PI / 3 + .3, distance = radius * 1.3
      return { '--spark-x': Math.cos(angle) * distance + 'px', '--spark-y': Math.sin(angle) * distance + 'px', '--spark-angle': angle + 'rad' }
    }) }
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
  const plan = elapsed > 15000 ? { moves: [], impacts: [], accents: [], cues: [] } : arenaEffectPlan(before, after, props.table.events)
  if (!plan.moves.length && !plan.impacts.length && !plan.accents.length && !plan.cues.length) return
  await nextTick()
  if (!mounted || ticket !== generation || !props.available || document.hidden || !enabled.value) return
  if (props.table.spectator) for (const cue of plan.cues) if (cue.kind === 'result') cue.text = 'Match complete'
  cues.value = plan.cues
  if (motion.value === 'full') {
    const destination = positions()
    flights.value = plan.moves.flatMap((move: any, index: number) => {
      const from = origin.get(move.from), to = destination.get(move.to)
      if (!from || !to || Math.hypot(to.x - from.x, to.y - from.y) < 5) return []
      const width = Math.max(42, Math.min(90, to.width)), height = width * 1.4
      return [{ ...move, tone: tone(move.to), key: ticket + ':' + index, style: { left: to.x - width / 2 + 'px', top: to.y - height / 2 + 'px', width: width + 'px', height: height + 'px', '--travel-x': from.x - to.x + 'px', '--travel-y': from.y - to.y + 'px', '--travel-scale': Math.min(1.35, Math.max(.65, from.width / width)) } }]
    })
    impacts.value = plan.impacts.flatMap((impact: any, index: number) => {
      const target = destination.get(impact.target)
      if (!target) return []
      return [{ ...impact, tone: tone(impact.source || impact.target), key: ticket + ':' + index, style: { left: target.x + 'px', top: target.y - Math.min(index, 3) * 12 + 'px', '--impact-delay': impact.kind === 'attack' ? '240ms' : '0ms' } }]
    })
    beams.value = plan.impacts.filter((impact: any) => impact.kind === 'attack' && impact.source).flatMap((impact: any, index: number) => {
      const from = destination.get(impact.source), to = destination.get(impact.target)
      if (!from || !to) return []
      return [{ key: ticket + ':' + index, tone: tone(impact.source), style: { left: from.x + 'px', top: from.y + 'px', width: Math.hypot(to.x - from.x, to.y - from.y) + 'px', '--beam-angle': Math.atan2(to.y - from.y, to.x - from.x) + 'rad' } }]
    })
    strikes.value = plan.impacts.filter((impact: any) => impact.kind === 'attack' && impact.source).flatMap((impact: any, index: number) => {
      const from = destination.get(impact.source), to = destination.get(impact.target), id = impact.source.slice(5)
      if (!from || !to || !arenaEffectUnit(props.table, id)) return []
      const width = Math.max(42, Math.min(100, from.width))
      return [{ id, key: ticket + ':' + index, tone: tone(impact.source), style: { left: from.x - width / 2 + 'px', top: from.y - width * .7 + 'px', width: width + 'px', height: width * 1.4 + 'px', '--strike-x': (to.x - from.x) * .72 + 'px', '--strike-y': (to.y - from.y) * .72 + 'px' } }]
    })
    bursts.value = [...plan.impacts.filter((impact: any) => impact.kind !== 'coin'), ...plan.accents].slice(0, ARENA_EFFECT_LIMITS.accents).flatMap((accent: any, index: number) => {
      const target = destination.get(accent.target)
      return target ? [burst(accent.kind, target, accent.source || accent.target, ticket + ':' + index, accent.kind === 'attack' ? 240 : 100)] : []
    })
    const announcement = plan.cues.find((cue: any) => cue.kind === 'result') || plan.cues.find((cue: any) => cue.kind === 'knockout') || plan.cues.find((cue: any) => cue.kind === 'turn')
    const centre = destination.get('centre')
    if (announcement && centre) banners.value = [{ ...announcement, key: ticket, style: { left: centre.x + 'px', top: centre.y + 'px' } }]
    // Clear face-bearing decoration promptly; later frames never reuse old geometry or faces.
    flightExpiry = setTimeout(() => { flights.value = []; beams.value = []; strikes.value = [] }, ARENA_EFFECT_LIMITS.flight)
  }
  expiry = setTimeout(clearEffects, ARENA_EFFECT_LIMITS.lifetime)
}
watch([() => props.table, () => props.revision, () => props.matchId, () => props.available], update, { flush: 'pre' })
onMounted(() => {
  mounted = true; preference = window.matchMedia('(prefers-reduced-motion: reduce)'); reduced.value = preference.matches
  preference.addEventListener('change', changedPreference)
  window.addEventListener('resize', baseline); window.addEventListener('scroll', interrupt, true)
  window.addEventListener('blur', interrupt); window.addEventListener('focus', interrupt)
  document.addEventListener('visibilitychange', visibility); baseline()
})
onBeforeUnmount(() => {
  mounted = false; interrupt(); preference?.removeEventListener('change', changedPreference); preference = null
  window.removeEventListener('resize', baseline); window.removeEventListener('scroll', interrupt, true)
  window.removeEventListener('blur', interrupt); window.removeEventListener('focus', interrupt)
  document.removeEventListener('visibilitychange', visibility)
})
</script>
<template>
  <div ref="stage" class="arena-effects-stage" :data-arena-motion="motion">
    <div class="arena-effects-toolbar"><span class="arena-kicker">LIVE TABLE</span><span v-if="reduced" class="arena-effects-preference">System reduced motion · text feedback</span><div class="arena-effects-controls"><button type="button" class="arena-button quiet" :aria-pressed="minimal || reduced" :disabled="reduced" @click="toggleMotion">Motion: {{ minimal || reduced ? 'Reduced' : 'Full' }}</button><button type="button" class="arena-button quiet" :aria-pressed="enabled" @click="toggle">Battle effects: {{ enabled ? 'On' : 'Off' }}</button></div></div>
    <slot />
    <div class="arena-effects-recap" role="status" aria-label="Battle activity" aria-live="polite" aria-atomic="true">
      <span v-for="(cue, index) in cues" :key="index" class="arena-effect-cue" :data-cue="cue.kind"><b v-if="cue.seat === table.seat">YOU · </b><b v-else-if="cue.seat === 0 || cue.seat === 1">OPPONENT · </b>{{ cue.text }}</span>
    </div>
    <div v-if="motion === 'full' && (liveFlights.length || impacts.length || beams.length || liveStrikes.length || bursts.length || banners.length)" class="arena-motion-layer" :style="{ '--arena-flight-duration': ARENA_EFFECT_LIMITS.flight + 'ms' }" aria-hidden="true" inert>
      <div v-for="beam in beams" :key="beam.key" class="arena-effect-beam" :data-tone="beam.tone" :style="beam.style" />
      <div v-for="strike in liveStrikes" :key="strike.key" class="arena-effect-strike" :data-tone="strike.tone" :style="strike.style"><ArenaCard :unit="strike.unit" :tabindex="-1" disabled /></div>
      <div v-for="flight in liveFlights" :key="flight.key" class="arena-effect-flight" :data-tone="flight.tone" :style="flight.style" :data-flight-kind="flight.kind">
        <ArenaCard v-if="flight.unit" :unit="flight.unit" :tabindex="-1" disabled />
        <div v-else class="arena-effect-card-back">CS</div>
      </div>
      <div v-for="effect in bursts" :key="effect.key" class="arena-effect-burst" :data-burst="effect.kind" :data-tone="effect.tone" :style="effect.style"><i class="arena-burst-ring" /><i class="arena-burst-orbit" /><i v-for="(spark, index) in effect.sparks" :key="index" class="arena-burst-spark" :style="spark" /></div>
      <div v-for="impact in impacts" :key="impact.key" class="arena-effect-impact" :class="'is-' + impact.kind" :data-tone="impact.tone" :data-impact="impact.kind" :style="impact.style"><template v-if="impact.amount !== null"><span class="arena-impact-amount">{{ impact.amount }}</span><small> damage</small></template><template v-else>{{ impact.text }}</template></div>
      <div v-for="banner in banners" :key="banner.key" class="arena-effect-banner" :data-announcement="banner.kind" :style="banner.style"><span class="arena-banner-mark">CS</span><strong>{{ banner.text }}</strong></div>
    </div>
  </div>
</template>
<style src="~/assets/css/arena-effects.css"></style>
