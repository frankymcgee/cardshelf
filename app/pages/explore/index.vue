<script setup lang="ts">
import { GAMES, GAME_CODES, gameName } from '../../../shared/games.mjs'
definePageMeta({ layout: 'marketing' })
useMarketingSeo('Free card catalogue', 'Browse Pokémon, Yu-Gi-Oh! and Magic: The Gathering cards and available source prices without a subscription.', '/explore')
const api = useApi(), route = useRoute()
const game = ref(GAME_CODES.some(code => code === String(route.query.game)) ? String(route.query.game) : 'pokemon'), language = ref('en'), search = ref(''), set = ref(''), page = ref(1)
const data = ref<any>(null), sets = ref<any[]>([]), error = ref(''), loading = ref(false)
let sequence = 0, alive = true
async function load() {
  const request = ++sequence; loading.value = true; error.value = ''
  try {
    const [result, choices] = await Promise.all([api('/api/public/catalogue', { query: { game: game.value, language: language.value, q: search.value, set: set.value, page: page.value } }), api('/api/public/catalogue/sets', { query: { game: game.value, language: language.value } })])
    if (alive && request === sequence) { data.value = result; sets.value = choices }
  } catch (e) { if (alive && request === sequence) error.value = errorMessage(e) }
  finally { if (alive && request === sequence) loading.value = false }
}
watch(game, () => { page.value = 1; set.value = ''; language.value = 'en'; load() })
watch(language, () => { page.value = 1; set.value = ''; load() })
onMounted(load)
onBeforeUnmount(() => { alive = false; sequence++ })
function searchCards() { page.value = 1; load() }
async function next(delta: number) { page.value += delta; await load() }
</script>
<template>
  <div class="m-container free-catalogue">
    <header class="catalogue-heading"><span class="m-eyebrow">OPEN TO EVERY COLLECTOR</span><h1>Find your next favourite.</h1><p>Explore every supported game. Card information and source prices are free; your private collections are always separate.</p></header>
    <form class="catalogue-search" @submit.prevent="searchCards"><GamePicker v-model="game" /><label>Language<select v-model="language"><option value="en">English</option><option v-if="game === 'pokemon'" value="ja">Japanese</option></select></label><label>Set<select v-model="set"><option value="">All imported sets</option><option v-for="s in sets" :key="s.id" :value="s.id">{{ s.name }}</option></select></label><label>Find a card<input v-model="search" maxlength="100" type="search" placeholder="Name or card number"></label><button class="m-button" :disabled="loading">Search</button></form>
    <p v-if="error" class="alert warning" role="alert">{{ error }}</p>
    <p v-if="loading" class="muted" role="status">Loading the catalogue…</p>
    <p v-if="data" class="data-note">{{ data.total }} {{ gameName(game) }} catalogue entries on this server. Only imported sets are listed.</p>
    <div v-if="data" class="public-card-grid"><NuxtLink v-for="card in data.items" :key="card.id" :to="'/explore/' + encodeURIComponent(card.id)" class="public-card-tile"><CardArtwork :card="card" :badges="false" effects-mode="off" /><strong>{{ card.name }}</strong><small>{{ card.set_name }} · #{{ card.local_id }}</small><span class="badge">{{ gameName(card.game) }}</span></NuxtLink></div>
    <p v-if="data && !data.items.length && !loading" class="empty-state">No cards match. The administrator can import more sets; no subscription is required to browse them.</p>
    <nav v-if="data" class="catalogue-pagination" aria-label="Catalogue pages"><button class="button secondary" :disabled="loading || page <= 1" @click="next(-1)">Previous</button><span>Page {{ page }} / {{ Math.max(1, Math.ceil(data.total / data.limit)) }}</span><button class="button secondary" :disabled="loading || page * data.limit >= data.total" @click="next(1)">Next</button></nav>
    <AdSenseSlot :content-ready="!!data?.items?.length && !error" />
    <SponsorSlot placement="catalogue" />
    <CatalogueCredits />
  </div>
</template>
