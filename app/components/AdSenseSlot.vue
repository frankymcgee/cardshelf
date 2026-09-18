<script setup lang="ts">
import { startAdSense } from '../../shared/adsense-browser.mjs'
interface Placement { eligible: boolean; publisher_id?: string; slot_id?: string; revision?: number }
const props = defineProps<{ contentReady: boolean }>()
const api = useApi(), route = useRoute()
const placement = ref<Placement | null>(null), unit = ref<HTMLElement | null>(null), failed = ref(false)
let alive = false, sequence = 0, requested = false, reloading = false
let timer: ReturnType<typeof setInterval> | undefined, observer: ResizeObserver | undefined
function freshDocument() {
  if (reloading || !alive) return
  reloading = true
  window.location.replace(window.location.href)
}
function allowed() { return alive && !reloading && props.contentReady && placement.value?.eligible === true && !failed.value }
function requestAd() {
  if (requested || !allowed() || document.visibilityState !== 'visible') return
  // Read the nonce property, which supports browser nonce hiding. Do not expose
  // it in a meta content/data attribute that CSS selectors could read.
  const nonce = document.querySelector<HTMLScriptElement>('script[nonce]')?.nonce || ''
  requested = startAdSense(window, document, unit.value, placement.value, nonce, allowed, () => { failed.value = true })
}
async function check() {
  const request = ++sequence
  if (!alive) return
  try {
    const value = await api<Placement>('/api/ads/adsense', { query: { path: route.path } })
    if (!alive || request !== sequence) return
    const revision = document.querySelector<HTMLMetaElement>('meta[name="cardshelf-adsense-revision"]')?.content
    if (!value.eligible || String(value.revision) !== revision) {
      placement.value = null
      if (requested) freshDocument()
      return
    }
    placement.value = value
    await nextTick()
    if (!alive || request !== sequence) return
    if (!observer && unit.value && typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(requestAd); observer.observe(unit.value)
    }
    requestAd()
  } catch {
    if (!alive || request !== sequence) return
    placement.value = null
    if (requested) freshDocument()
  }
}
function visibleCheck() { if (document.visibilityState === 'visible') check() }
function restored(event: PageTransitionEvent) { if (event.persisted && requested) freshDocument() }
watch(() => props.contentReady, ready => { if (ready && !requested) check(); else if (!ready && requested) failed.value = true })
onMounted(() => {
  alive = true; check()
  window.addEventListener('focus', visibleCheck)
  window.addEventListener('cardshelf:membership-changed', visibleCheck)
  document.addEventListener('visibilitychange', visibleCheck)
  window.addEventListener('pageshow', restored)
  // Recheck entitlement only. This timer NEVER asks Google for another ad.
  timer = setInterval(visibleCheck, 60000)
})
onBeforeUnmount(() => {
  alive = false; sequence++; clearInterval(timer); observer?.disconnect()
  window.removeEventListener('focus', visibleCheck)
  window.removeEventListener('cardshelf:membership-changed', visibleCheck)
  document.removeEventListener('visibilitychange', visibleCheck)
  window.removeEventListener('pageshow', restored)
  placement.value = null
})
</script>
<template>
  <aside v-if="placement?.eligible && contentReady && !failed" class="adsense-slot" aria-label="Advertisement">
    <small class="sponsor-disclosure">ADVERTISEMENT</small>
    <ins ref="unit" class="adsbygoogle" style="display:block"></ins>
  </aside>
</template>
<style scoped>
.adsense-slot{margin:32px 0;padding:16px 0;min-width:0;width:100%;border-top:1px solid var(--line,#dcdfe7)}
.adsense-slot small{display:block;margin-bottom:10px;font-size:10px;letter-spacing:.1em;color:var(--muted,#6c7280)}
.adsbygoogle{min-width:0;width:100%}
</style>
