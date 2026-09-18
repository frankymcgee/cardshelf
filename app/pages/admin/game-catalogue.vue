<script setup lang="ts">
type CatalogueGame = 'yugioh' | 'mtg'
interface CatalogueSet {
  game: CatalogueGame
  language: 'en'
  code: string
  source_code: string
  name: string
}
const api = useApi(), notice = useNotice()
const game = ref<CatalogueGame>('yugioh'), sets = ref<CatalogueSet[]>([]), query = ref(''), selected = ref(''), confirmed = ref(false), busy = ref(false), loading = ref(false), loaded = ref(false), error = ref(''), job = ref('')
const visible = computed(() => {
  const search = query.value.trim().toLowerCase()
  return sets.value.filter(s => (s.name + ' ' + s.source_code + ' ' + s.code).toLowerCase().includes(search)).slice(0, 150)
})
let catalogueRequest = 0
watch(game, () => {
  catalogueRequest++
  sets.value = []; query.value = ''; selected.value = ''; confirmed.value = false
  loading.value = false; loaded.value = false; error.value = ''; job.value = ''
}, { flush: 'sync' })
function catalogueSets(result: unknown, requested: CatalogueGame): CatalogueSet[] {
  // The API returns the normalised array directly, not an object with a `sets` property.
  // Reject malformed data before it can replace the list used by the template.
  if (!Array.isArray(result) || result.some(set => !set || typeof set !== 'object' ||
    set.game !== requested || set.language !== 'en' ||
    typeof set.code !== 'string' || !set.code.trim() ||
    typeof set.source_code !== 'string' || !set.source_code.trim() ||
    typeof set.name !== 'string' || !set.name.trim())) {
    throw new Error('The server returned an invalid set catalogue. Reload the page and try again.')
  }
  return result
}
async function load() {
  if (loading.value || busy.value) return
  loading.value = true; error.value = ''
  const requested = game.value, request = ++catalogueRequest
  try {
    const result: unknown = await api('/api/admin/game-catalogue/sets', { query: { game: requested } })
    if (request !== catalogueRequest || requested !== game.value) return
    sets.value = catalogueSets(result, requested)
    loaded.value = true
    if (!sets.value.some(set => set.code === selected.value)) { selected.value = ''; confirmed.value = false }
  } catch (e) {
    if (request === catalogueRequest && requested === game.value) error.value = errorMessage(e)
  } finally {
    if (request === catalogueRequest) loading.value = false
  }
}
async function queue() {
  if (busy.value || loading.value) return
  busy.value = true; error.value = ''
  try { const result = await api('/api/admin/game-catalogue/import', { method: 'POST', body: { game: game.value, code: selected.value, confirm_provider_terms: confirmed.value } }); job.value = result.id; notice.show(result.already_queued ? 'This set is already queued.' : 'Set import queued. The worker downloads and caches the source data.') }
  catch (e) { error.value = errorMessage(e) } finally { busy.value = false }
}
</script>
<template>
  <header class="page-heading"><div><span class="eyebrow">FREE CATALOGUE SOURCES</span><h1>Additional card games</h1><p>Import one set at a time into the shared public catalogue. No API key or paid provider plan is required by these integrations.</p></div></header>
  <p class="alert info">Pokémon keeps its existing <NuxtLink to="/settings">Data & settings import</NuxtLink>. New imports here support English paper Magic and English Yu-Gi-Oh! set/rarity records. Other languages, graded cards, verified first editions and exhaustive artwork variations are not inferred.</p>
  <p v-if="error" class="alert error" role="alert">{{ error }}</p>
  <section class="panel game-import-panel form-stack">
    <label>Card game<select v-model="game" :disabled="loading || busy"><option value="yugioh">Yu-Gi-Oh! — YGOPRODeck</option><option value="mtg">Magic: The Gathering — MTGJSON</option></select></label>
    <button class="button secondary" :disabled="loading || busy" @click="load">{{ loading ? 'Loading catalogue…' : 'Load available sets' }}</button>
    <p v-if="loaded && !loading && !error && !sets.length" class="muted small" role="status">No supported sets were returned for this game. Try loading the catalogue again later.</p>
    <template v-if="sets.length"><label>Find a set<input v-model="query" type="search" placeholder="Set name or code" /></label>
      <label>Set to import<select v-model="selected" :disabled="loading || busy"><option value="">Choose a set</option><option v-for="set in visible" :key="set.code" :value="set.code">{{ set.name }} ({{ set.source_code }})</option></select></label>
      <p class="muted small">{{ sets.length }} source sets; up to 150 matching choices shown. Refine the search to find others.</p>
      <label class="checkbox-label"><input v-model="confirmed" type="checkbox" :disabled="loading || busy" />I have reviewed the source and artwork terms, will keep reference data freely accessible, and understand prices/edition matches may be incomplete.</label>
      <button class="button primary" :disabled="loading || busy || !selected || !confirmed" @click="queue">{{ busy ? 'Queuing…' : 'Queue set import' }}</button>
    </template>
    <p v-if="job" class="alert info">Job {{ job }} is queued. <NuxtLink to="/settings">Review import progress in Data & settings.</NuxtLink></p>
    <p class="data-note">Imports preserve collection quantities and manual printings. Artwork is downloaded once and rehosted locally. Metadata and provider errors are reported instead of silently substituting another card. Imported catalogue information is available to visitors at <NuxtLink to="/explore">Browse cards</NuxtLink>.</p>
    <p v-if="game === 'mtg'" class="alert warning">The first Magic price import downloads the shared daily MTGJSON price file. Allow sufficient server memory and disk space. A response over the safety bound is rejected; the job reports a pricing error and retains imported metadata. Artwork is retrieved by the source's Scryfall printing ID, not by a fuzzy name search.</p>
  </section>
  <CatalogueCredits />
</template>
<style scoped>.game-import-panel{max-width:900px;padding:24px;margin:24px 0}</style>
