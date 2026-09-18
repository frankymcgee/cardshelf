<script setup lang="ts">
const props = defineProps<{ placement: 'overview' | 'catalogue' }>()
const api = useApi(), auth = useAuth(), route = useRoute()
const creative = ref<any>(null)
let sequence = 0, alive = false, timer: ReturnType<typeof setInterval> | undefined
async function refresh() {
  const request = ++sequence
  creative.value = null
  if (!alive) return
  try {
    if (!auth.state.value.loaded) await auth.refresh()
    if (!alive || request !== sequence || !auth.state.value.user) return
    const response = await api('/api/ads/placement', { query: { placement: props.placement } })
    if (alive && request === sequence && response.eligible === true) creative.value = response.creative
  } catch { /* No entitlement/configuration response means no advertisement. */ }
}
function clearImage() { if (creative.value) creative.value.image = null }
function visibleRefresh() { if (document.visibilityState === 'visible') refresh() }
onMounted(() => { alive = true; refresh(); window.addEventListener('focus', visibleRefresh); window.addEventListener('cardshelf:membership-changed', visibleRefresh); document.addEventListener('visibilitychange', visibleRefresh); timer = setInterval(visibleRefresh, 60000) })
watch(() => [props.placement, route.fullPath, auth.state.value.user?.id], refresh)
onBeforeUnmount(() => { alive = false; sequence++; clearInterval(timer); window.removeEventListener('focus', visibleRefresh); window.removeEventListener('cardshelf:membership-changed', visibleRefresh); document.removeEventListener('visibilitychange', visibleRefresh) })
</script>
<template>
  <aside v-if="creative" class="sponsor-slot" aria-label="Advertisement">
    <div class="sponsor-disclosure">ADVERTISEMENT · SPONSORED BY {{ creative.sponsor }}</div>
    <img v-if="creative.image" :src="creative.image" :alt="creative.image_alt || creative.sponsor" loading="lazy" decoding="async" referrerpolicy="no-referrer" @error="clearImage">
    <div class="sponsor-copy"><p>{{ creative.text }}</p><a :href="creative.url" target="_blank" rel="sponsored noopener noreferrer" referrerpolicy="no-referrer" class="button secondary">{{ creative.cta }}<span class="sr-only"> (opens sponsor website)</span></a></div>
  </aside>
</template>
