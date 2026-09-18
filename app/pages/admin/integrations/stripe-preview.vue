<script setup lang="ts">
import type { PricingOffer } from '../../../../shared/pricing-table.mjs'
definePageMeta({ layout: 'marketing' })
useSeoMeta({ title: 'Test pricing preview · CardShelf', robots: 'noindex, nofollow' })
type Preview = { preview: true, environment: 'sandbox', checkout_enabled: false, last_synced_at: string | null, sync_failed: boolean, offers: PricingOffer[] }
const api = useApi(), auth = useAuth(), data = ref<Preview | null>(null), error = ref(''), loading = ref(false)
const isAdmin = computed(() => auth.state.value.user?.role === 'admin')
let controller: AbortController | null = null, generation = 0
function clearPreview() { generation++; controller?.abort(); controller = null; data.value = null; loading.value = false }
async function load() {
  if (loading.value || !isAdmin.value) return
  const request = ++generation
  controller = new AbortController(); loading.value = true; data.value = null; error.value = ''
  try {
    const result = await api<Preview>('/api/admin/integrations/stripe/products/preview', { signal: controller.signal, cache: 'no-store' })
    if (request !== generation || !isAdmin.value) return
    if (result?.preview !== true || result.environment !== 'sandbox' || result.checkout_enabled !== false || !Array.isArray(result.offers)) throw new Error('The server did not return a Test pricing preview. Reload after checking the application version.')
    data.value = result
  } catch (e) { if (request === generation) error.value = errorMessage(e) }
  finally { if (request === generation) { loading.value = false; controller = null } }
}
const lastSync = computed(() => {
  const date = new Date(data.value?.last_synced_at || '')
  return Number.isFinite(date.getTime()) ? date.toLocaleString('en-AU') : 'No successful product sync recorded'
})
watch(isAdmin, allowed => { if (!allowed) clearPreview() })
onMounted(() => { void load(); window.addEventListener('focus', load) })
onBeforeUnmount(() => { clearPreview(); window.removeEventListener('focus', load) })
</script>
<template>
<main class="test-pricing-preview">
  <section class="m-container m-page-hero">
    <div class="preview-banner" role="status"><strong>TEST PREVIEW</strong><span>Administrator only · Stripe Test / Sandbox · No checkout</span></div>
    <span class="m-eyebrow">PLANS & ACCESS</span><h1>Your collection.<br><em>Your level of detail.</em></h1>
    <p class="m-lead">Review the website pricing table using your saved Test products. Live prices, subscriptions and existing access remain unchanged.</p>
    <div class="preview-actions"><NuxtLink to="/admin/platform" class="m-button m-button-outline">Back to product sync</NuxtLink><NuxtLink to="/pricing" class="m-text-link">View public pricing</NuxtLink><button v-if="isAdmin" type="button" class="m-button" :disabled="loading" @click="load">{{ loading ? 'Loading preview…' : 'Refresh preview' }}</button></div>
    <p class="m-fine">Refresh preview reads the saved catalogue only. To fetch product changes from Stripe, use Sync now in the Test / Sandbox product catalogue first. You do not need to enable Test checkout or change the active billing mode.</p>
  </section>
  <section v-if="!isAdmin" class="m-container preview-message" role="alert">Administrator access is required. Protected tester or Complimentary access alone does not permit this preview.</section>
  <template v-else>
    <p v-if="loading" class="m-container preview-message" role="status">Loading the saved Test catalogue…</p>
    <p v-if="error" class="m-container preview-message preview-error" role="alert">{{ error }}</p>
    <template v-if="data">
      <div class="m-container preview-sync"><p class="m-fine">Last successful Test product sync: {{ lastSync }}.</p><p v-if="data.sync_failed" class="preview-message" role="status">The latest Test sync failed. This preview shows the last saved catalogue, not unsynced Stripe changes. Review product-sync status before publishing.</p></div>
      <SubscriptionPricingTable v-if="data.offers.length" :offers="data.offers" mode="preview" />
      <section v-else class="m-container preview-message"><h2>No Test prices to preview yet.</h2><p>Open Platform administration → Stripe product catalogue, select Test / Sandbox and run Sync now. Only published, supported monthly or yearly Test offers appear; archived or paused offers are excluded.</p><p>Products saved only in Stripe are not fetched by this preview. For manually configured offers, verify and publish the Test offer in Stripe integration. Neither action requires activating subscriptions.</p></section>
    </template>
  </template>
</main>
</template>
<style scoped>
.preview-banner{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:18px 22px;border:2px solid #9c6800;border-radius:14px;background:#fff3ce;color:#503600;margin-bottom:28px}.preview-banner strong{letter-spacing:.08em}.preview-actions{display:flex;gap:16px;flex-wrap:wrap;align-items:center;margin:24px 0}.preview-actions button{font:inherit;cursor:pointer}.preview-actions button:disabled{opacity:.6;cursor:wait}.preview-message{padding:24px;border:1px solid #ded9ed;border-radius:14px;margin-bottom:28px;overflow-wrap:anywhere}.preview-error{border-color:#b63c3c}.preview-sync{margin-bottom:32px}.preview-sync .preview-message{margin-top:16px}.test-pricing-preview{padding-bottom:64px}.preview-actions .m-button-outline{background:transparent;color:inherit;border:1px solid currentColor}@media(max-width:620px){.preview-actions{align-items:stretch;flex-direction:column}}
</style>
