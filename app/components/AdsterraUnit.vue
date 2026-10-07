<script setup lang="ts">
import { ADSTERRA_CARDSHELF_UNITS, selectAdsterraUnit } from '../../shared/adsterra.mjs'
import { startAdsterra } from '../../shared/adsterra-browser.mjs'
const props = defineProps<{ units?: Record<string, string>; layout: string; preview: boolean; nonce: string; allowed: () => boolean }>()
const emit = defineEmits<{ requested: [] }>()
const host = ref<HTMLElement | null>(null), frame = ref<HTMLIFrameElement | null>(null)
const selected = ref<ReturnType<typeof selectAdsterraUnit>>(null), nativeHeight = ref(250), retired = ref(false)
let alive = false, started = false, starting = false, visible = false
let resize: ResizeObserver | undefined, intersection: IntersectionObserver | undefined
const height = computed(() => selected.value?.format === 'native' ? nativeHeight.value : selected.value?.height || 0)
function measure() {
  if (!alive || !host.value || retired.value) return
  const width = host.value.getBoundingClientRect().width
  if (started) {
    // A smaller viewport retires the unit; resizing never requests another ad.
    if (selected.value?.width && width < selected.value.width) retired.value = true
    return
  }
  selected.value = selectAdsterraUnit(props.preview ? ADSTERRA_CARDSHELF_UNITS : props.units, props.layout, width,
    props.layout === 'rail' ? window.innerHeight - 160 : 600)
  request()
}
async function request() {
  if (!alive || started || starting || !visible || props.preview || retired.value || !selected.value || !props.allowed()) return
  starting = true
  await nextTick()
  if (alive && frame.value && selected.value && !retired.value && visible && props.allowed()) {
    started = startAdsterra(window, document, frame.value, selected.value, props.nonce, props.allowed)
    if (started) emit('requested')
    else if ((window as any).__cardshelfAdsterraUnits?.has(selected.value.key)) retired.value = true
  }
  starting = false
}
function onVisibility() { if (document.visibilityState === 'visible') request() }
function message(event: MessageEvent) {
  if (!started || !frame.value || event.source !== frame.value.contentWindow || event.data?.key !== selected.value?.key) return
  if (event.data?.type === 'cardshelf-adsterra-error') { retired.value = true; return }
  if (selected.value?.format !== 'native' || event.data?.type !== 'cardshelf-adsterra-size') return
  const value = event.data.height
  if (typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 2000) nativeHeight.value = Math.ceil(value)
}
watch(() => [props.units, props.preview, props.layout], measure)
onMounted(() => {
  alive = true
  resize = new ResizeObserver(measure)
  if (host.value) resize.observe(host.value)
  intersection = new IntersectionObserver(entries => {
    visible = entries.some(entry => entry.isIntersecting)
    if (visible) { measure(); request() }
  })
  if (host.value) intersection.observe(host.value)
  window.addEventListener('message', message)
  document.addEventListener('visibilitychange', onVisibility)
  measure()
})
onBeforeUnmount(() => {
  alive = false; resize?.disconnect(); intersection?.disconnect()
  window.removeEventListener('message', message)
  document.removeEventListener('visibilitychange', onVisibility)
})
</script>
<template>
  <div ref="host" class="adsterra-unit" :class="{ 'adsterra-retired': retired }" :data-format="selected?.format">
    <template v-if="selected && !retired">
      <small class="adsterra-label">ADVERTISEMENT<span v-if="preview"> · PREVIEW</span></small>
      <div v-if="preview" class="adsterra-preview" data-testid="adsterra-preview" :style="{ width: selected.width ? selected.width + 'px' : '100%', minHeight: height + 'px' }">
        <strong>{{ selected.label }}</strong><span>{{ selected.width ? selected.width + ' × ' + selected.height : 'Responsive native ads' }}</span><small>Advertising supports Free accounts.</small>
      </div>
      <iframe v-else ref="frame" :title="'Advertisement — ' + selected.label" :width="selected.width || '100%'" :height="height"
        sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox" referrerpolicy="no-referrer" scrolling="no" />
    </template>
  </div>
</template>
<style scoped>
.adsterra-unit{width:100%;min-width:0;text-align:center;break-inside:avoid}.adsterra-unit iframe{display:block;max-width:100%;border:0;margin:0 auto;background:transparent}.adsterra-label{display:block;padding:8px 0;font-size:10px;letter-spacing:.08em;font-weight:600;color:var(--muted,#6c7280)}.adsterra-preview{box-sizing:border-box;max-width:100%;margin:auto;border:1px dashed var(--line,#dcdfe7);border-radius:12px;background:var(--surface-soft,#f3f4f7);color:var(--muted,#6c7280);display:flex;flex-direction:column;justify-content:center;align-items:center;gap:8px;padding:8px}.adsterra-preview strong{font-size:13px}.adsterra-preview span,.adsterra-preview small{font-size:11px}.adsterra-retired{height:0;overflow:hidden}
@media print{.adsterra-unit{display:none}}
</style>
