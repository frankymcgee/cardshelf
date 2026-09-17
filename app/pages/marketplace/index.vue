<script setup lang="ts">
import { aud, saleStateLabel, SALE_CONDITIONS } from '../../../shared/marketplace.mjs'
const api = useApi(), route = useRoute(), notice = useNotice()
const data = ref<any>(null), access = ref<any>(null), loading = ref(true), failure = ref('')
const filters = reactive({ q: '', language: '', condition: '', order: 'newest' }), page = ref(1)
const mine = computed(() => route.query.mine === '1')
let sequence = 0, timer: ReturnType<typeof setTimeout> | undefined
async function load() {
  const current = ++sequence; loading.value = true; failure.value = ''
  try { const next = await api('/api/marketplace/listings', { query: { ...filters, page: page.value, mine: String(mine.value) } }); if (current === sequence) data.value = next }
  catch (e) { if (current === sequence) failure.value = errorMessage(e) }
  finally { if (current === sequence) loading.value = false }
}
onMounted(async () => { load(); try { access.value = await api('/api/marketplace/access') } catch (e) { notice.show(errorMessage(e), 'error') } })
watch([filters, mine], () => { page.value = 1; clearTimeout(timer); timer = setTimeout(load, 250) }, { deep: true })
watch(page, load)
onBeforeUnmount(() => { sequence++; clearTimeout(timer) })
</script>
<template>
  <MarketplaceShell :title="mine ? 'Your sale shelf' : 'Find your next favourite'">
    <div class="market-controls"><p class="muted small">{{ mine ? 'Manage availability without changing your collection.' : 'One physical card per listing. All asking prices are in AUD.' }}</p><NuxtLink v-if="access?.can_sell" to="/marketplace/new" class="button primary"><AppIcon name="plus" :size="18" />Sell a card</NuxtLink><span v-else-if="access" class="badge">Selling · Collector Plus</span></div>
    <div class="market-filters">
      <label>Search<input v-model="filters.q" type="search" maxlength="100" placeholder="Card, number, set or city" /></label>
      <label>Language<select v-model="filters.language"><option value="">All languages</option><option value="en">English</option><option value="ja">Japanese</option></select></label>
      <label>Condition<select v-model="filters.condition"><option value="">All conditions</option><option v-for="c in SALE_CONDITIONS" :key="c" :value="c">{{ c }}</option></select></label>
      <label>Sort<select v-model="filters.order"><option value="newest">Newest first</option><option value="price_low">Price: low to high</option><option value="price_high">Price: high to low</option></select></label>
    </div>
    <div v-if="failure" class="market-error" role="alert">{{ failure }} <button class="text-button" @click="load">Retry</button></div>
    <p v-if="loading" class="loading-panel" role="status">Loading the market…</p>
    <div v-else-if="data?.items.length" class="market-grid">
      <NuxtLink v-for="item in data.items" :key="item.id" :to="'/marketplace/' + item.id" class="market-card">
        <div class="market-card-photo"><img :src="item.photos[0].url" :alt="item.card_name + ' — seller’s front photo'" loading="lazy" /><span class="market-pill" :class="item.hidden ? 'hidden' : item.status">{{ item.hidden ? 'Hidden by moderator' : saleStateLabel(item.status) }}</span></div>
        <div class="market-card-copy"><h2>{{ item.card_name }}</h2><p>{{ item.set_name }} · #{{ item.local_id }}</p><p>{{ item.printing_label }} · {{ item.condition }} · {{ item.language.toUpperCase() }}</p><span class="market-card-price">{{ aud(item.price_minor) }}</span><p>Seller asking price · 1 card</p><div class="market-card-footer"><span>{{ item.seller_alias }}</span><span>{{ item.region }}</span></div></div>
      </NuxtLink>
    </div>
    <section v-else-if="!failure" class="market-empty"><h2>{{ mine ? 'Your next listing starts here.' : 'A little space for the next great find.' }}</h2><p>{{ mine ? 'List a card with your own photos and an asking price.' : 'No matching listings yet. Try a different search or check back after sellers add cards.' }}</p></section>
    <div v-if="data?.total > 24" class="pagination"><button class="button secondary" :disabled="loading || page === 1" @click="page--">Previous</button><span>Page {{ page }} of {{ Math.ceil(data.total / 24) }}</span><button class="button secondary" :disabled="loading || page * 24 >= data.total" @click="page++">Next</button></div>
  </MarketplaceShell>
</template>
