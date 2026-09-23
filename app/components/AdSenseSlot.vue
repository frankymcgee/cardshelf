<script setup lang="ts">
import { startAdSense } from '../../shared/adsense-browser.mjs'
import { adFreePath, adsensePageKind, marketplaceAdSize } from '../../shared/adsense-policy.mjs'
interface Placement { eligible: boolean; placeholder?: boolean; publisher_id?: string; slot_id?: string; revision?: number; auto_ads?: boolean; page_kind?: string }
const props = defineProps<{ contentReady: boolean; autoOnly?: boolean; grid?: boolean; marketplace?: boolean; manualAllowed?: boolean; adFreeUrl?: string }>()
const api = useApi(), route = useRoute(), auth = useAuth()
const placement = ref<Placement | null>(null), unit = ref<HTMLElement | null>(null), failed = ref(false), unsupported = ref(false), unfilled = ref(false), manualRetired = ref(false)
const adminPreview = computed(() => auth.state.value.user?.role === 'admin' && auth.state.value.admin_placement_view === 'preview')
const placeholder = computed(() => (adminPreview.value || placement.value?.placeholder === true) && props.contentReady && !!adsensePageKind(path()))
const manual = computed(() => !props.autoOnly && props.manualAllowed !== false && !unsupported.value && !manualRetired.value && !!placement.value?.slot_id)
const path = () => route.fullPath.split('#')[0] || '/'
const browser = () => window as Window & { __cardshelfAdSenseLoaded?: boolean; __cardshelfAdSenseBlocked?: boolean }
let requestedUserId: string | null = null
let alive = false, sequence = 0, requested = false, reloading = false, checking = false
let timer: ReturnType<typeof setInterval> | undefined, observer: ResizeObserver | undefined, fillObserver: MutationObserver | undefined
function freshDocument() {
  if (reloading || !alive) return
  reloading = true; browser().__cardshelfAdSenseBlocked = true
  // A failed eligibility check must not automatically generate another ad view.
  window.location.replace(adFreePath(props.adFreeUrl || path()))
}
function allowed() { return alive && !reloading && props.contentReady && placement.value?.eligible === true && !failed.value && !browser().__cardshelfAdSenseBlocked }
function requestAd() {
  if (requested || !allowed() || document.visibilityState !== 'visible') return
  if (manual.value && (!unit.value?.isConnected || unit.value.getBoundingClientRect().width <= 0)) return
  if (manual.value && props.marketplace && unit.value) {
    const rect = unit.value.getBoundingClientRect()
    if (!marketplaceAdSize(rect.width, rect.height)) unsupported.value = true
  }
  const value = { ...placement.value, slot_id: manual.value ? placement.value?.slot_id : '' }
  if (!value.slot_id && value.auto_ads !== true) return
  const nonce = document.querySelector<HTMLScriptElement>('script[nonce]')?.nonce || ''
  requested = startAdSense(window, document, unit.value, value, nonce, allowed, () => { failed.value = true })
  if (requested) requestedUserId = auth.state.value.user?.id || null
  // A document first loaded for Auto ads must not later introduce an empty
  // manual unit. Filtering never creates a second display request.
  if (requested && !value.slot_id) manualRetired.value = true
  if (requested && manual.value && unit.value && typeof MutationObserver !== 'undefined') {
    fillObserver = new MutationObserver(() => {
      if (unit.value?.getAttribute('data-ad-status') === 'unfilled') unfilled.value = true
    })
    fillObserver.observe(unit.value, { attributes: true, attributeFilter: ['data-ad-status'] })
  }
}
async function check() {
  if (!alive || checking || !adsensePageKind(path())) return
  checking = true; const request = ++sequence, requestedPath = path()
  let checkedUser: string | null = auth.state.value.user?.id || null
  try {
    // Resolve the initial client identity before requesting an ad. Marketing
    // layouts refresh the session asynchronously too; that first resolution
    // must not look like a later logout/account switch.
    if (!auth.state.value.loaded) await auth.refresh()
    if (!alive || request !== sequence) return
    checkedUser = auth.state.value.user?.id || null
    // Local administrator layout preview must not depend on an advertising request.
    if (adminPreview.value) {
      if (requested) freshDocument()
      return
    }
    if (browser().__cardshelfAdSenseBlocked) return
    const value = await api<Placement>('/api/ads/adsense', { query: { path: requestedPath } })
    if (!alive || request !== sequence) return
    if (requestedPath !== path() || checkedUser !== (auth.state.value.user?.id || null)) return
    if (value.placeholder && value.page_kind === adsensePageKind(path())) {
      if (requested) { freshDocument(); return }
      placement.value = value; return
    }
    const revision = document.querySelector<HTMLMetaElement>('meta[name="cardshelf-adsense-revision"]')?.content
    if (!value.eligible || String(value.revision) !== revision || value.page_kind !== adsensePageKind(path())) {
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
  } finally { checking = false; if (alive && (requestedPath !== path() || checkedUser !== (auth.state.value.user?.id || null))) check() }
}
watch(() => placeholder.value, async visible => {
  if (!visible || typeof document === 'undefined' || route.hash !== '#cardshelf-placement-preview') return
  await nextTick()
  document.getElementById('cardshelf-placement-preview')?.scrollIntoView({ block: 'center' })
})
function visibleCheck() { if (document.visibilityState === 'visible') check() }
function restored(event: PageTransitionEvent) { if (event.persisted && requested) freshDocument() }
watch(() => props.manualAllowed, value => { if (value === false && requested) manualRetired.value = true })
watch(() => props.contentReady, ready => { if (ready && !requested) check(); else if (!ready && requested) freshDocument() })
watch(() => auth.state.value.user?.id, next => { if (requested && (next || null) !== requestedUserId) { placement.value = null; freshDocument() } else if (!requested) { placement.value = null; check() } })
watch(() => route.fullPath, () => { placement.value = null; check() })
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
  alive = false; sequence++; clearInterval(timer); observer?.disconnect(); fillObserver?.disconnect()
  window.removeEventListener('focus', visibleCheck)
  window.removeEventListener('cardshelf:membership-changed', visibleCheck)
  document.removeEventListener('visibilitychange', visibleCheck)
  window.removeEventListener('pageshow', restored)
  placement.value = null
})
</script>
<template>
  <AutoPlacementPreview v-if="placeholder" :key="route.path" :path="path()" :administrator="adminPreview" :marketplace="marketplace" :grid="grid" />
  <aside v-else-if="placement?.eligible && contentReady && manual && !failed && !unfilled" :class="marketplace ? 'market-card marketplace-ad' : 'adsense-slot'" aria-label="Advertisements">
    <template v-if="marketplace">
      <div class="market-card-photo market-ad-photo"><div class="market-ad-space" style="position:relative;aspect-ratio:5/7;width:100%;min-width:0">
        <small class="ad-disclosure">Advertisements</small>
        <div style="position:absolute;inset:28px 0 0"><ins ref="unit" class="adsbygoogle" style="display:block;width:100%;height:100%"></ins></div>
      </div></div>
      <div class="market-card-copy"><p class="ad-explanation">Advertising, not a card for sale.</p><p>Free accounts are supported by advertisements.</p></div>
    </template>
    <template v-else><small class="ad-disclosure">Advertisements</small><ins ref="unit" class="adsbygoogle" style="display:block"></ins></template>
  </aside>
</template>
<style scoped>
.adsense-slot{margin:32px 0;padding:16px 0;min-width:0;width:100%;border-top:1px solid var(--line,#dcdfe7)}
.ad-disclosure{display:block;margin-bottom:10px;font-size:11px;letter-spacing:.06em;color:var(--muted,#6c7280);font-weight:600}
.adsbygoogle{min-width:0;width:100%}
.marketplace-ad{min-width:0;overflow:visible;border-style:dashed;background:var(--paper,#fff)}
.marketplace-ad:hover{box-shadow:none}.market-ad-photo{background:var(--surface-soft,#f3f4f7);border-radius:15px 15px 0 0}
.marketplace-ad .ad-disclosure{position:absolute;top:0;left:0;right:0;text-align:center;margin:0}
.marketplace-ad .ad-explanation{font-weight:600;color:var(--ink,#333)}
.marketplace-ad .market-card-copy{justify-content:center;min-height:170px}
.marketplace-ad .market-card-copy p{color:var(--muted,#6c7280)}
@media(max-width:600px){.marketplace-ad .market-card-copy{min-height:145px}}
</style>
