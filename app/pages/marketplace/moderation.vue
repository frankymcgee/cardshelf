<script setup lang="ts">
const api = useApi(), auth = useAuth(), data = ref<any>(null), failure = ref(''), page = ref(1), loading = ref(false)
async function load() {
  loading.value = true; failure.value = ''
  try { data.value = await api('/api/marketplace/reports', { query: { page: page.value } }) }
  catch (e) { failure.value = errorMessage(e) } finally { loading.value = false }
}
onMounted(load); watch(page, load)
</script>
<template>
  <MarketplaceShell title="Keep the market welcoming" subtitle="Administrator review of reported listings.">
    <div v-if="failure" class="market-error" role="alert">{{ failure }}</div><p v-if="loading" class="loading-panel">Loading reports…</p>
    <template v-if="auth.state.value.user?.role === 'admin'"><div class="market-controls"><p class="market-help">Open a listing to hide it or restore visibility with a recorded reason. Private messages are only visible to their participants.</p><button class="button secondary" :disabled="loading" @click="load">Refresh</button></div>
      <article v-for="r in data?.items || []" :key="r.id" class="market-panel"><span class="market-pill" :class="{ hidden: r.hidden }">{{ r.reason.replaceAll('_', ' ') }}</span><h2 style="margin-top:12px">{{ r.card_name }}</h2><p class="market-help">Seller: {{ r.seller_alias }} · {{ new Date(r.created_at).toLocaleString('en-AU') }}</p><p class="market-description">{{ r.details }}</p><NuxtLink :to="'/marketplace/' + r.listing_id" class="button secondary">Review listing</NuxtLink></article>
      <p v-if="data && !data.items.length" class="market-empty">No open reports.</p><div v-if="data?.has_more || page > 1" class="pagination"><button class="button secondary" :disabled="page === 1 || loading" @click="page--">Previous</button><span>Page {{ page }}</span><button class="button secondary" :disabled="!data?.has_more || loading" @click="page++">Next</button></div>
    </template>
  </MarketplaceShell>
</template>
