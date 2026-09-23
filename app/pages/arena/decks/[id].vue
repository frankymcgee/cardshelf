<script setup lang="ts">
import { onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router'
import ArenaModal from '../../../components/arena/ArenaModal.vue'
import ArenaShell from '../../../components/arena/ArenaShell.vue'
import ArenaCard from '../../../components/arena/ArenaCard.vue'
import ArenaCardFacts from '../../../components/arena/ArenaCardFacts.vue'
import ArenaDeckCover from '../../../components/arena/ArenaDeckCover.vue'
import ArenaDeckImport from '../../../components/arena/ArenaDeckImport.vue'
definePageMeta({ layout: false, key: (to: { fullPath: string }) => to.fullPath })
useSeoMeta({ title: 'Deck workshop · CardShelf', robots: 'noindex, nofollow' })
const route = useRoute(), api = useApi(), id = computed(() => String(route.params.id)), isNew = computed(() => id.value === 'new')
const title = ref(''), rows = ref<any[]>([]), revision = ref(0), query = ref(''), owned = ref(false), supportedOnly = ref(true), page = ref(1)
const kind = ref(''), energyType = ref(''), set = ref(''), stage = ref(''), filters = ref<any>({ sets: [], types: [] })
const catalogue = ref<any>({ items: [], has_more: false }), legacy = ref<any[]>([]), legacyId = ref(''), selected = ref<any>(null)
const error = ref(''), searchError = ref(''), filterError = ref(''), notice = ref(''), busy = ref(false), loading = ref(false), ready = ref(false), validation = ref<any>(null)
const mobileView = ref('cards'), workshopContent = ref<HTMLDivElement | null>(null)
function showPanel(panel: string) { mobileView.value = panel; void nextTick(() => { if (window.innerWidth <= 950) workshopContent.value?.scrollIntoView({ block: 'start' }) }) }
const pendingSave = ref<any>(null), baseline = ref(JSON.stringify({ title: '', cards: [] }))
let alive = true, sequence = 0, debounce: ReturnType<typeof setTimeout> | undefined
const total = computed(() => rows.value.reduce((n, r) => n + r.quantity, 0))
const visible = computed<any[]>(() => catalogue.value.items)
const grouped = computed(() => ['pokemon', 'trainer', 'energy'].map(kind => ({ kind, count: rows.value.filter(r => r.card.kind === kind).reduce((n, r) => n + r.quantity, 0) })))
const preview = computed(() => [...rows.value].sort((a, b) => (a.card.kind === 'pokemon' ? 0 : 1) - (b.card.kind === 'pokemon' ? 0 : 1)).slice(0, 3).map(r => r.card))
const locked = computed(() => busy.value || !!pendingSave.value)
const dirty = computed(() => ready.value && JSON.stringify(draft()) !== baseline.value)
function draft() { return { title: title.value, cards: rows.value.map(r => ({ card_id: r.card.id, quantity: r.quantity })) } }
function beforeUnload(event: BeforeUnloadEvent) { if (dirty.value) { event.preventDefault(); event.returnValue = '' } }
function confirmLeave() { return !dirty.value || window.confirm('Leave without saving this deck draft?') }
onBeforeRouteLeave(confirmLeave)
onBeforeRouteUpdate(confirmLeave)
async function search() {
  const seq = ++sequence; loading.value = true; searchError.value = ''; catalogue.value = { items: [], has_more: false }
  try {
    const next = await api('/api/arena/catalogue', { query: { q: query.value, page: page.value, owned: owned.value ? '1' : '0', supported: supportedOnly.value ? '1' : '0', kind: kind.value, type: energyType.value, set: set.value, stage: stage.value } })
    if (alive && seq === sequence) catalogue.value = next
  } catch (e) { if (alive && seq === sequence) searchError.value = errorMessage(e) }
  finally { if (alive && seq === sequence) loading.value = false }
}
async function loadFilters() {
  filterError.value = ''
  try { const result = await api('/api/arena/catalogue/filters'); if (alive) filters.value = result }
  catch { if (alive) filterError.value = 'Set and type filters could not load. Search is still available.' }
}
function accept(deck: any) {
  title.value = deck.title; rows.value = deck.cards.map((r: any) => ({ card: r.card, quantity: r.quantity, supported: r.supported !== false, reason: r.reason || '' }))
  revision.value = deck.revision || 0; validation.value = deck.validation; baseline.value = JSON.stringify(draft())
}
function amount(card: any, delta: number) {
  if (locked.value || !ready.value) return
  const row = rows.value.find(r => r.card.id === card.id)
  if (delta > 0 && (total.value >= 60 || row?.supported === false)) { error.value = total.value >= 60 ? 'The deck already has 60 cards.' : 'Remove or replace this unavailable card.'; return }
  if (row) { row.quantity = Math.max(0, row.quantity + delta); rows.value = rows.value.filter(r => r.quantity > 0) }
  else if (delta > 0) rows.value.push({ card, quantity: 1, supported: true })
  validation.value = null; error.value = ''; notice.value = ''
}
async function save() {
  if (busy.value || !ready.value) return
  busy.value = true; error.value = ''; notice.value = ''
  pendingSave.value ||= { path: isNew.value ? '/api/arena/decks' : '/api/arena/decks/' + id.value, method: isNew.value ? 'POST' : 'PUT', body: { ...draft(), revision: revision.value, request_id: crypto.randomUUID() } }
  try {
    const intent = pendingSave.value, result = await api(intent.path, { method: intent.method, body: intent.body })
    if (!alive) return
    accept(result); pendingSave.value = null
    notice.value = result.validation.playable ? 'Deck saved and ready for Casual Expanded.' : 'Draft saved. Complete the deck before entering a match.'
    if (isNew.value) await navigateTo('/arena/decks/' + result.id)
  } catch (e: any) {
    if (!alive) return
    const status = e?.statusCode || e?.status
    if ([400, 401, 403, 404, 409, 422, 429].includes(status)) pendingSave.value = null
    error.value = errorMessage(e) + (pendingSave.value ? ' The result is uncertain. Retry the same save below.' : ' Your local draft is retained. Reload the saved deck if it changed elsewhere.')
  } finally { busy.value = false }
}
function applyImport(result: any) {
  if (locked.value || !result.complete) return
  rows.value = result.cards.map((r: any) => ({ ...r, supported: true }))
  if (isNew.value && result.title) title.value = result.title
  validation.value = result.validation; selected.value = null; showPanel('deck'); error.value = ''; notice.value = 'Import applied to your draft. Choose Save deck to keep it.'
}
async function importLegacy() {
  if (!legacyId.value || locked.value || !isNew.value || total.value) return
  busy.value = true; error.value = ''
  try {
    const result = await api('/api/arena/legacy/' + legacyId.value)
    if (alive) { title.value = result.title; rows.value = result.cards; validation.value = result.validation; notice.value = 'Archived list copied into this draft. Save it as a new deck when ready.' }
  } catch (e) { if (alive) error.value = errorMessage(e) }
  finally { busy.value = false }
}
async function remove() {
  if (isNew.value || locked.value || !window.confirm('Delete this saved deck? Existing match snapshots and collection cards will remain.')) return
  busy.value = true
  try { await api('/api/arena/decks/' + id.value, { method: 'DELETE', body: { title: title.value, revision: revision.value } }); baseline.value = JSON.stringify(draft()); await navigateTo('/arena') }
  catch (e) { error.value = errorMessage(e) } finally { busy.value = false }
}
function exportDeck() {
  const blob = new Blob([JSON.stringify({ format: 'cardshelf-arena-deck', version: 1, title: title.value, game: 'pokemon', cards: rows.value.map(r => ({ card_id: r.card.id, name: r.card.name, quantity: r.quantity })) }, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = 'cardshelf-arena-deck.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
}
function resetFilters() { query.value = ''; owned.value = false; supportedOnly.value = true; kind.value = ''; energyType.value = ''; set.value = ''; stage.value = '' }
function queueSearch() { ++sequence; clearTimeout(debounce); catalogue.value = { items: [], has_more: false }; loading.value = true; debounce = setTimeout(search, 250) }
watch([query, owned, supportedOnly, kind, energyType, set, stage], () => { page.value = 1; queueSearch() })
watch(page, () => { if (ready.value) queueSearch() })
onMounted(async () => {
  window.addEventListener('beforeunload', beforeUnload)
  try {
    const status = await api('/api/arena/status'); if (!status.allowed) throw new Error(status.message)
    if (!isNew.value) { const result = await api('/api/arena/decks/' + id.value); if (alive) accept(result) }
    else if (typeof route.query.copy === 'string') {
      const result = await api('/api/arena/decks/' + encodeURIComponent(route.query.copy))
      if (alive) { accept(result); title.value = (result.title.slice(0, 73) + ' (copy)').slice(0, 80); revision.value = 0; baseline.value = JSON.stringify({ title: '', cards: [] }); notice.value = 'You are editing a separate copy. Save it to create a new deck.' }
    }
    if (!alive) return
    ready.value = true
    const lists = await api('/api/arena/decks'); if (alive) legacy.value = lists.legacy || []
    await Promise.all([loadFilters(), search()])
  } catch (e) { if (alive) error.value = errorMessage(e) }
})
onBeforeUnmount(() => { alive = false; sequence++; clearTimeout(debounce); window.removeEventListener('beforeunload', beforeUnload) })
</script>
<template>
  <ArenaShell class="arena-workshop-page" title="DECK WORKSHOP">
    <div class="aw-workshop-heading"><div><NuxtLink to="/arena" class="arena-link">← Back to your Arena</NuxtLink><span class="arena-kicker">THE DECK WORKSHOP</span><h1>{{ isNew ? 'Build your next contender.' : 'Make your next move better.' }}</h1><p class="arena-muted">Find your cards. Shape your strategy. Take it to the table.</p></div><span class="aw-draft-indicator">{{ dirty ? 'Unsaved changes' : isNew ? 'New draft' : 'Saved deck' }}</span></div>
    <p v-if="error" class="arena-alert error" role="alert">{{ error }}</p><p v-if="notice" class="arena-alert" role="status">{{ notice }}</p>
    <div v-if="pendingSave && !busy" class="arena-alert"><p>Your pending save is preserved. Editing is paused until its result is confirmed.</p><button class="arena-button primary" @click="save">Retry same save</button></div>
    <p v-if="!ready && !error" class="arena-panel" role="status">Opening the workshop…</p>
    <div v-if="ready" class="aw-workshop-tabs" role="group" aria-label="Workshop view"><button :aria-pressed="mobileView === 'cards'" @click="showPanel('cards')">Card catalogue</button><button :aria-pressed="mobileView === 'deck'" @click="showPanel('deck')">Your deck · {{ total }}/60</button></div>
    <div v-if="ready" ref="workshopContent" class="aw-workshop-layout" :class="{ 'show-deck': mobileView === 'deck' }">
      <section class="aw-catalogue">
        <ArenaDeckImport :has-cards="rows.length > 0" :locked="locked" @apply="applyImport" />
        <div class="arena-panel aw-catalogue-filters"><div class="aw-filter-heading"><h2>Find your cards</h2><button class="arena-link" @click="resetFilters">Reset filters</button></div><label class="aw-search">Search the imported catalogue<input v-model="query" maxlength="100" placeholder="Card name, number or English catalogue ID" type="search"></label><div class="aw-filter-grid"><label>Card category<select v-model="kind"><option value="">All cards</option><option value="pokemon">Pokémon</option><option value="trainer">Trainers</option><option value="energy">Energy</option></select></label><label>Energy type<select v-model="energyType"><option value="">All types</option><option v-for="type in filters.types" :key="type" :value="type">{{ type }}</option></select></label><label>Imported set<select v-model="set"><option value="">All sets</option><option v-for="item in filters.sets" :key="item.id" :value="item.id">{{ item.name }}</option></select></label><label>Evolution stage<select v-model="stage"><option value="">All stages</option><option value="Basic">Basic Pokémon</option><option value="Stage1">Stage 1</option><option value="Stage2">Stage 2</option><option value="MegaEvolution">Mega Evolution</option></select></label></div><div class="aw-filter-checks"><label class="arena-check"><input v-model="supportedOnly" type="checkbox">Supported cards only</label><label class="arena-check"><input v-model="owned" type="checkbox">Owned cards only</label></div><p class="arena-muted">Filters search the whole imported English Pokémon catalogue. Ownership is optional for Arena decks.</p><p v-if="filterError" class="arena-muted">{{ filterError }} <button class="arena-link" @click="loadFilters">Retry filters</button></p></div>
        <div class="aw-results-heading" aria-live="polite"><h2>Card catalogue</h2><span>{{ loading ? 'Checking cards…' : searchError ? 'Search unavailable' : visible.length + ' results · page ' + page }}</span></div><p v-if="searchError" class="arena-alert error" role="alert">{{ searchError }} <button class="arena-link" @click="search">Retry search</button></p><p v-if="loading" class="arena-panel" role="status">Checking the catalogue against your filters…</p>
        <div class="aw-catalogue-grid"><article v-for="result in visible" :key="result.card.id" class="aw-catalogue-card" :class="{ unsupported: !result.supported }"><ArenaCard :card="result.card" @select="selected = result"/><div class="aw-catalogue-card-info"><strong>{{ result.card.name }}</strong><small>{{ result.card.set_name }} · #{{ result.card.number }}</small><span>{{ result.supported ? (result.card.kind === 'pokemon' ? 'Pokémon' : result.card.kind === 'trainer' ? 'Trainer' : 'Energy') : 'Unsupported' }}<template v-if="result.owned_quantity"> · {{ result.owned_quantity }} owned</template></span></div><button class="arena-button" :disabled="locked || !result.supported || total >= 60" :aria-label="'Add ' + result.card.name + ' to deck'" @click="amount(result.card, 1)">+ Add card</button><button v-if="!result.supported" class="arena-link" @click="selected = result">Why unsupported?</button></article></div>
        <div v-if="!loading && !searchError && !visible.length" class="arena-panel aw-empty"><h3>No cards match these filters.</h3><p>Try another name, clear a filter, or import a Pokémon set from the catalogue tools.</p><button class="arena-button" @click="resetFilters">Reset filters</button></div>
        <div class="arena-pagination"><button class="arena-button" :disabled="loading || page === 1" @click="page--">Previous</button><span>Page {{ page }}</span><button class="arena-button" :disabled="loading || !catalogue.has_more" @click="page++">Next</button></div>
      </section>
      <aside class="aw-deck-sidebar">
        <section class="arena-panel aw-draft-summary"><ArenaDeckCover :cards="preview" /><label>Deck name<input v-model="title" maxlength="80" :disabled="locked" placeholder="Give your deck a name"></label><div class="aw-count-heading"><strong>{{ total }}<small> / 60 cards</small></strong><span>{{ validation?.playable ? 'Ready to play' : 'Building your deck' }}</span></div><div class="aw-composition" aria-label="Deck composition"><i v-for="group in grouped" :key="group.kind" :class="group.kind" :style="{ width: (group.count / 60 * 100) + '%' }" /></div><div class="aw-composition-legend"><span v-for="group in grouped" :key="group.kind"><i :class="group.kind"/>{{ group.count }} {{ group.kind === 'pokemon' ? 'Pokémon' : group.kind === 'trainer' ? 'Trainers' : 'Energy' }}</span></div><p class="arena-muted">60 cards · at least one Basic Pokémon · up to four of each name, except Basic Energy.</p>
          <div class="aw-draft-list"><div v-for="row in rows" :key="row.card.id" class="aw-draft-row"><button class="aw-draft-card-name" @click="selected = row"><strong>{{ row.card.name }}</strong><small>{{ row.card.set_name || row.card.id }}{{ row.card.number ? ' · #' + row.card.number : '' }}</small><small v-if="row.supported === false" class="aw-card-warning">Unavailable · remove or replace</small></button><div class="aw-quantity"><button :disabled="locked" :aria-label="'Remove one ' + row.card.name" @click="amount(row.card, -1)">−</button><b>{{ row.quantity }}</b><button :disabled="locked || total >= 60 || row.supported === false" :aria-label="'Add one ' + row.card.name" @click="amount(row.card, 1)">+</button></div></div><p v-if="!rows.length" class="arena-muted">Your next idea starts with one card. Add from the catalogue or import a list.</p></div>
          <div v-if="validation" class="arena-validation" :class="{ valid: validation.playable }"><strong>{{ validation.playable ? 'Ready for Casual Expanded' : 'Draft · not ready to play' }}</strong><p v-for="message in validation.errors" :key="message">{{ message }}</p></div><div class="aw-save-actions"><button class="arena-button primary" :disabled="locked || !title.trim()" @click="save">{{ busy ? 'Saving…' : 'Save deck' }}</button><NuxtLink v-if="!isNew && validation?.playable && !dirty" to="/arena" class="arena-button">Back to play</NuxtLink><button class="arena-button" :disabled="!rows.length" @click="exportDeck">Export list</button><NuxtLink v-if="!isNew" :to="{ path: '/arena/decks/new', query: { copy: id } }" class="arena-link">Duplicate saved deck</NuxtLink><button v-if="!isNew" class="arena-link danger" :disabled="locked" @click="remove">Delete saved deck</button></div>
        </section>

        <details v-if="isNew && legacy.length" class="arena-panel aw-import"><summary>Copy an archived deck</summary><div class="aw-import-content"><label>Archived deck<select v-model="legacyId" :disabled="locked || total > 0"><option value="">Choose a previous deck</option><option v-for="d in legacy" :key="d.id" :value="d.id">{{ d.title }}</option></select></label><button class="arena-button" :disabled="!legacyId || locked || total > 0" @click="importLegacy">Check and copy list</button><p class="arena-muted">Start with an empty draft. Unsupported cards are reported before copying.</p></div></details>
      </aside>
    </div>
    <ArenaModal :open="!!selected" :label="selected?.card.name || 'Card details'" @close="selected = null"><div v-if="selected" class="aw-card-inspector"><ArenaCard :card="selected.card" disabled/><p v-if="selected.reason" class="arena-alert">{{ selected.reason }}</p><code>{{ selected.card.id }}</code><ArenaCardFacts :card="selected.card"/><div v-for="(attack, i) in selected.card.attacks || []" :key="i" class="arena-attack-info"><strong>{{ attack.name }} · {{ attack.printed || attack.damage }}</strong><small>{{ attack.cost.join(', ') }}</small><p>{{ attack.text }}</p></div></div></ArenaModal>
  </ArenaShell>
</template>
