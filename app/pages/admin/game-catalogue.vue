<script setup lang="ts">
type CatalogueGame = 'pokemon' | 'yugioh' | 'mtg'
interface CatalogueSet {
  game: CatalogueGame
  language: 'en' | 'ja'
  code: string
  source_code: string
  name: string
}
const api = useApi(), notice = useNotice()
const game = ref<CatalogueGame>('pokemon'), language = ref<'en' | 'ja'>('en'), sets = ref<CatalogueSet[]>([]), query = ref(''), selected = ref(''), confirmed = ref(false), busy = ref(false), loading = ref(false), loaded = ref(false), error = ref(''), job = ref('')
const status = ref<any>(null), statusError = ref('')
const workerHealthy = computed(() => status.value?.worker_last_seen && Date.now() - Date.parse(status.value.worker_last_seen) < 120000)
const gameNames: Record<string, string> = { pokemon: 'Pokémon', yugioh: 'Yu-Gi-Oh!', mtg: 'Magic: The Gathering' }
let timer: ReturnType<typeof setTimeout> | undefined, alive = true, polling = false
async function refreshStatus() {
  if (!alive || polling) return
  clearTimeout(timer); polling = true
  try { const next = await api('/api/admin/status'); if (alive) { status.value = next; statusError.value = '' } }
  catch (e) { if (alive) statusError.value = errorMessage(e) }
  finally { polling = false; if (alive) timer = setTimeout(refreshStatus, 5000) }
}
onMounted(refreshStatus)
onBeforeUnmount(() => { alive = false; clearTimeout(timer) })
const visible = computed(() => {
  const search = query.value.trim().toLowerCase()
  return sets.value.filter(s => (s.name + ' ' + s.source_code + ' ' + s.code).toLowerCase().includes(search)).slice(0, 150)
})
let catalogueRequest = 0
function resetCatalogue() {
  catalogueRequest++
  sets.value = []; query.value = ''; selected.value = ''; confirmed.value = false
  loading.value = false; loaded.value = false; error.value = ''; job.value = ''
}
watch(game, resetCatalogue, { flush: 'sync' })
watch(language, resetCatalogue, { flush: 'sync' })
function catalogueSets(result: unknown, requested: CatalogueGame, requestedLanguage: 'en' | 'ja'): CatalogueSet[] {
  // The API returns the normalised array directly, not an object with a `sets` property.
  // Reject malformed data before it can replace the list used by the template.
  const invalid = () => new Error('The server returned an invalid set catalogue. Reload the page and try again.')
  if (!Array.isArray(result)) throw invalid()
  if (requested === 'pokemon') {
    if (result.some(set => !set || typeof set.id !== 'string' || !set.id.trim() || typeof set.name !== 'string' || !set.name.trim())) throw invalid()
    return result.map(set => ({ game: requested, language: requestedLanguage, code: set.id, source_code: set.id, name: set.name }))
  }
  if (result.some(set => !set || typeof set !== 'object' ||
    set.game !== requested || set.language !== 'en' ||
    typeof set.code !== 'string' || !set.code.trim() ||
    typeof set.source_code !== 'string' || !set.source_code.trim() ||
    typeof set.name !== 'string' || !set.name.trim())) {
    throw invalid()
  }
  return result
}
async function load() {
  if (loading.value || busy.value) return
  loading.value = true; error.value = ''
  const requested = game.value, requestedLanguage = language.value, request = ++catalogueRequest
  try {
    const result: unknown = requested === 'pokemon'
      ? await api('/api/admin/sets', { query: { language: requestedLanguage } })
      : await api('/api/admin/game-catalogue/sets', { query: { game: requested } })
    if (request !== catalogueRequest || requested !== game.value) return
    sets.value = catalogueSets(result, requested, requestedLanguage)
    loaded.value = true
    if (!sets.value.some(set => set.code === selected.value)) { selected.value = ''; confirmed.value = false }
  } catch (e) {
    if (request === catalogueRequest && requested === game.value) error.value = errorMessage(e)
  } finally {
    if (request === catalogueRequest) loading.value = false
  }
}
async function queue() {
  if (busy.value || loading.value || !selected.value.trim()) return
  if (game.value !== 'pokemon' && (!confirmed.value || !sets.value.some(set => set.code === selected.value))) return
  busy.value = true; error.value = ''
  try {
    const result = game.value === 'pokemon'
      ? await api('/api/admin/imports', { method: 'POST', body: { language: language.value, set_id: selected.value.trim() } })
      : await api('/api/admin/game-catalogue/import', { method: 'POST', body: { game: game.value, code: selected.value, confirm_provider_terms: confirmed.value } })
    job.value = result.id
    notice.show(result.already_queued ? 'This set is already queued.' : 'Set import queued. Progress will appear below.')
    await refreshStatus()
  }
  catch (e) { error.value = errorMessage(e) } finally { busy.value = false }
}
async function retryImport(failed: any) {
  if (busy.value || loading.value) return
  const target = failed.kind === 'import-set' ? 'pokemon' : failed.payload.game
  if (!['pokemon', 'yugioh', 'mtg'].includes(target)) return
  game.value = target; language.value = target === 'pokemon' ? failed.payload.language : 'en'
  resetCatalogue()
  if (target !== 'pokemon') await load()
  if (error.value) return
  selected.value = target === 'pokemon' ? failed.payload.set_id : failed.payload.code
  if (target === 'pokemon') await queue()
  else notice.show('Review the provider terms above, then queue this set again.')
}
</script>
<template>
  <header class="page-heading"><div><span class="eyebrow">SHARED CARD CATALOGUE</span><h1>Game imports</h1><p>Choose a game and import one set at a time into the shared public catalogue.</p></div><span v-if="status" class="badge" :class="workerHealthy ? 'green' : 'amber'">{{ workerHealthy ? 'Worker online' : 'Worker not seen recently' }}</span></header>
  <p v-if="status && !workerHealthy" class="alert warning">Imports need the background worker. Check <code>docker compose logs worker</code> on the server.</p>
  <p v-if="statusError" class="alert warning" role="alert">Import progress could not be refreshed: {{ statusError }} <button class="text-button" @click="refreshStatus">Retry progress</button></p>
  <p v-if="error" class="alert error" role="alert">{{ error }}</p>
  <form class="panel game-import-panel form-stack" @submit.prevent="queue">
    <label>Card game<select v-model="game" :disabled="loading || busy"><option value="pokemon">Pokémon — TCGdex</option><option value="yugioh">Yu-Gi-Oh! — YGOPRODeck</option><option value="mtg">Magic: The Gathering — MTGJSON</option></select></label>
    <label v-if="game === 'pokemon'">Language<select v-model="language" :disabled="loading || busy"><option value="en">English</option><option value="ja">Japanese</option></select></label>
    <button type="button" class="button secondary" :disabled="loading || busy" @click="load">{{ loading ? 'Loading catalogue…' : 'Load available sets' }}</button>
    <p v-if="loaded && !loading && !error && !sets.length" class="muted small" role="status">No supported sets were returned for this game. Try loading the catalogue again later.</p>
    <template v-if="sets.length"><label>Find a set<input v-model="query" type="search" placeholder="Set name or code" /></label>
      <label>Set to import<select v-model="selected" :disabled="loading || busy"><option value="">Choose a set</option><option v-for="set in visible" :key="set.code" :value="set.code">{{ set.name }} ({{ set.source_code }})</option></select></label>
      <p class="muted small">{{ sets.length }} source sets; up to 150 matching choices shown. Refine the search to find others.</p>
    </template>
    <label v-if="game === 'pokemon'">TCGdex set ID<input v-model="selected" :disabled="loading || busy" required pattern="[A-Za-z0-9][A-Za-z0-9._+\-]*" placeholder="e.g. base1" /></label>
    <label v-else-if="sets.length" class="checkbox-label"><input v-model="confirmed" type="checkbox" :disabled="loading || busy" />I have reviewed the source and artwork terms, will keep reference data freely accessible, and understand prices/edition matches may be incomplete.</label>
    <button class="button primary" :disabled="loading || busy || !selected.trim() || (game !== 'pokemon' && !confirmed)">{{ busy ? 'Queuing…' : 'Queue set import' }}</button>
    <p v-if="job" class="alert info" role="status">Job {{ job }} is queued. Review progress below.</p>
    <p v-if="game === 'pokemon'" class="data-note">Import English or Japanese Pokémon sets from TCGdex by selecting a set or entering its ID. Variant flags are not a verified master checklist. Artwork uses the local cache when available, with TCGdex source fallbacks.</p>
    <p v-else class="data-note">Imports support English paper Magic and English Yu-Gi-Oh! set/rarity records. Artwork is downloaded once and rehosted locally. Other languages, graded cards, verified first editions and exhaustive artwork variations are not inferred.</p>
    <p class="data-note">Imports preserve collection quantities and manual printings. Imported catalogue information is available to visitors at <NuxtLink to="/explore">Browse cards</NuxtLink>.</p>
    <p v-if="game === 'mtg'" class="alert warning">The first Magic price import downloads the shared daily MTGJSON price file. Allow sufficient server memory and disk space. A response over the safety bound is rejected; the job reports a pricing error and retains imported metadata. Artwork is retrieved by the source's Scryfall printing ID, not by a fuzzy name search.</p>
  </form>
  <section id="progress" class="panel game-import-panel">
    <h2>Import progress</h2>
    <p v-if="!status && !statusError" class="muted" role="status">Loading import progress…</p>
    <p v-else-if="status && !status.jobs.length" class="muted">No imports queued yet.</p>
    <div v-if="status?.jobs.length" class="jobs">
      <article v-for="item in status.jobs.slice(0, 10)" :key="item.id" class="job">
        <div class="job-heading"><strong>{{ item.kind === 'refresh-prices' ? 'Market prices' : `${gameNames[item.payload.game || 'pokemon'] || item.payload.game} · ${item.payload.set_id || item.payload.code}` }} <span class="badge">{{ item.payload.language?.toUpperCase() || (item.kind === 'import-game-set' ? 'EN' : item.payload.card_id || 'Tracked cards') }}</span></strong><span class="badge" :class="item.status === 'completed' ? 'green' : item.status === 'failed' ? 'red' : 'purple'">{{ item.status }}</span></div>
        <div class="progress-track"><div :style="{ width: (item.total ? item.progress / item.total * 100 : 0) + '%' }" /></div>
        <div class="job-summary"><small>{{ item.message }}<template v-if="item.total"> · {{ item.progress }}/{{ item.total }}</template></small><button v-if="item.status === 'failed' && ['import-set', 'import-game-set'].includes(item.kind)" class="text-button" :disabled="busy || loading" @click="retryImport(item)">Retry set</button></div>
        <details v-if="item.errors?.length"><summary>{{ item.errors.length }} card errors</summary><p v-for="(issue, i) in item.errors.slice(0, 20)" :key="i" class="small muted">{{ issue.card_id }}: {{ issue.message }}</p></details>
      </article>
    </div>
    <div v-if="status" class="data-counts"><span>{{ status.counts.sets }} sets</span><span>{{ status.counts.cards.toLocaleString() }} cards</span><span>{{ status.counts.printings.toLocaleString() }} printings</span></div>
  </section>
  <CatalogueCredits />
</template>
<style scoped>.game-import-panel{max-width:900px;padding:24px;margin:24px 0;min-width:0}.game-import-panel select{max-width:100%}.job-heading strong{overflow-wrap:anywhere}.job-summary{gap:12px;flex-wrap:wrap}</style>
