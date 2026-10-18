<script setup lang="ts">
const props = withDefaults(defineProps<{ modelValue: number; pages: number; spread?: boolean; disabled?: boolean }>(), { spread: true, disabled: false })
const emit = defineEmits<{ 'update:modelValue': [page: number]; 'update:spread': [spread: boolean] }>()
const step = computed(() => props.spread ? 2 : 1)
const total = computed(() => Math.max(1, props.pages))
const current = computed(() => Math.floor(Math.max(0, Math.min(props.modelValue, total.value - 1)) / step.value) * step.value)
const last = computed(() => Math.min(total.value, current.value + step.value))
const turning = ref(false), direction = ref('next')
let start: { id: number; x: number; y: number; time: number } | null = null
let clickUntil = 0, timer: ReturnType<typeof setTimeout> | undefined, frame: number | undefined
watch([current, () => props.modelValue], () => { if (current.value !== props.modelValue) emit('update:modelValue', current.value) })
onBeforeUnmount(() => { clearTimeout(timer); if (frame !== undefined) cancelAnimationFrame(frame) })
function turn(delta: number) {
  if (props.disabled || turning.value) return
  const next = current.value + delta * step.value
  if (next < 0 || next >= total.value) return
  direction.value = delta > 0 ? 'next' : 'previous'
  turning.value = true
  emit('update:modelValue', next)
  clearTimeout(timer); timer = setTimeout(() => { turning.value = false }, 360)
}
function pointerDown(event: PointerEvent) {
  if (!event.isPrimary) { start = null; return }
  clickUntil = 0
  if (event.pointerType === 'mouse' || props.disabled || turning.value || (event.target as HTMLElement).closest('input, select, textarea, a, [data-no-swipe]')) return
  start = { id: event.pointerId, x: event.clientX, y: event.clientY, time: Date.now() }
}
function pointerUp(event: PointerEvent) {
  const origin = start; start = null
  if (!origin || origin.id !== event.pointerId) return
  const dx = event.clientX - origin.x, dy = event.clientY - origin.y
  if (event.pointerType === 'touch' && Math.abs(dx) < 10 && Math.abs(dy) < 10 && Date.now() - origin.time < 400 && !props.disabled && !turning.value) {
    const button = (event.target as Element).closest<HTMLButtonElement>('button[data-book-tap]')
    if (button && !button.disabled && (event.currentTarget as HTMLElement).contains(button)) {
      // Resolve the pocket tap exactly once. Some touch browsers omit the
      // compatibility click after a swipe; others deliver it late.
      clickUntil = Date.now() + 600
      frame = requestAnimationFrame(() => { frame = undefined; if (button.isConnected) button.click() })
      return
    }
  }
  if (Math.abs(dx) < 45 || Math.abs(dx) < Math.abs(dy) * 1.5) return
  // Swiping over a pocket must never also trigger its tap-to-edit action,
  // including an outward swipe at the first or last spread.
  clickUntil = Date.now() + 600
  const root = event.currentTarget as HTMLElement
  if (root.hasPointerCapture(event.pointerId)) root.releasePointerCapture(event.pointerId)
  // Let touchend finish against the original pocket before replacing its DOM.
  // Replacing it inside pointerup can swallow the next tap in touch browsers.
  frame = requestAnimationFrame(() => { frame = undefined; turn(dx < 0 ? 1 : -1) })
}
function pointerMove(event: PointerEvent) {
  if (!start || start.id !== event.pointerId) return
  const dx = event.clientX - start.x, dy = event.clientY - start.y
  if (Math.abs(dx) < 45 || Math.abs(dx) < Math.abs(dy) * 1.5) return
  // Keep a confirmed swipe on the stable book, rather than the pocket which
  // will leave the DOM on a page turn. Ordinary taps retain their card target.
  const root = event.currentTarget as HTMLElement
  if (!root.hasPointerCapture(event.pointerId)) root.setPointerCapture(event.pointerId)
}
function preventSwipeClick(event: MouseEvent) {
  if (event.detail !== 0 && Date.now() < clickUntil) { event.preventDefault(); event.stopImmediatePropagation() }
}
function toggleSpread() {
  if (props.disabled || turning.value) return
  emit('update:spread', !props.spread)
  emit('update:modelValue', Math.floor(current.value / (props.spread ? 1 : 2)) * (props.spread ? 1 : 2))
}
</script>
<template>
  <section class="binder-book" :class="{ 'two-page-book': spread, turning }" aria-label="Binder pages">
    <div class="book-options"><span class="small muted">{{ spread ? 'Two-page spread' : 'Single page' }}</span><button class="text-button" :disabled="disabled || turning" @click="toggleSpread">{{ spread ? 'Single page' : 'Two pages' }}</button></div>
    <div class="book-viewport" tabindex="0" aria-label="Binder page spread. Swipe left or right, or use arrow keys to turn pages."
      @keydown.left.self.prevent="turn(-1)" @keydown.right.self.prevent="turn(1)"
      @pointerdown.capture="pointerDown" @pointermove.capture="pointerMove" @pointerup.capture="pointerUp" @pointercancel="start = null"
      @click.capture="preventSwipeClick" @dragstart="start = null">
      <div class="book-content" :class="{ 'settle-next': turning && direction === 'next', 'settle-previous': turning && direction === 'previous' }"><slot /></div>
      <div v-if="turning" class="book-turn-leaf" :class="direction" aria-hidden="true" />
    </div>
    <div class="binder-pagination book-pagination"><button class="button secondary" :disabled="current === 0 || disabled || turning" @click="turn(-1)"><AppIcon name="left" :size="17" />Previous</button><span class="book-range" aria-live="polite" aria-atomic="true">{{ last === current + 1 ? 'Page' : 'Pages' }} {{ current + 1 }}<template v-if="last !== current + 1">–{{ last }}</template> of {{ total }}</span><button class="button secondary" :disabled="last >= total || disabled || turning" @click="turn(1)">Next<AppIcon name="right" :size="17" /></button></div>
  </section>
</template>
<style scoped>
.binder-book{min-width:0}.book-options{display:flex;justify-content:space-between;align-items:center;gap:12px;margin:4px 0 8px}.book-options button{min-height:40px;font-size:12px}.book-viewport{position:relative;touch-action:pan-y pinch-zoom;isolation:isolate;border-radius:12px}.book-viewport:focus-visible{outline:3px solid var(--primary);outline-offset:5px}.book-content{min-width:0;transform-origin:center}.book-turn-leaf{position:absolute;top:0;bottom:0;width:50%;pointer-events:none;z-index:5;border-radius:6px;background:linear-gradient(100deg,var(--surface-soft),var(--paper) 30%,var(--line));backface-visibility:hidden;box-shadow:-8px 0 20px #0002}.book-turn-leaf.next{right:0;transform-origin:left center;animation:turn-next .35s ease-in-out forwards}.book-turn-leaf.previous{left:0;transform-origin:right center;animation:turn-previous .35s ease-in-out forwards}.settle-next{animation:settle-next .35s ease-out}.settle-previous{animation:settle-previous .35s ease-out}.book-pagination{gap:8px;margin-top:16px}.book-pagination .button{min-height:44px}.book-range{font-size:12px;text-align:center}
@keyframes turn-next{0%{transform:perspective(1500px) rotateY(0);opacity:.8}85%{opacity:.3}100%{transform:perspective(1500px) rotateY(-165deg);opacity:0}}@keyframes turn-previous{0%{transform:perspective(1500px) rotateY(0);opacity:.8}85%{opacity:.3}100%{transform:perspective(1500px) rotateY(165deg);opacity:0}}@keyframes settle-next{from{opacity:.7;transform:translateX(8px)}to{opacity:1;transform:none}}@keyframes settle-previous{from{opacity:.7;transform:translateX(-8px)}to{opacity:1;transform:none}}
@media(max-width:600px){.book-pagination .button{font-size:11px;padding:10px;gap:4px}.book-range{font-size:11px}.book-options{margin-top:0}.book-options .small{font-size:11px}}
@media(prefers-reduced-motion:reduce){.book-content{animation:none!important}.book-turn-leaf{display:none;animation:none}}


.two-page-book{max-width:860px;max-width:min(100%,calc(100dvh - 180px));margin-inline:auto}
@media(max-width:600px){.two-page-book :deep(.artwork-labels){display:none}.two-page-book :deep(.artwork-fallback>span),.two-page-book :deep(.artwork-fallback>small){display:none}.two-page-book :deep(.artwork-fallback>svg){width:18px;height:18px}}
</style>
