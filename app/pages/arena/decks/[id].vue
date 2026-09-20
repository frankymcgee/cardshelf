<script setup lang="ts">
import ArenaShell from '../../../components/arena/ArenaShell.vue'
import ArenaCard from '../../../components/arena/ArenaCard.vue'
definePageMeta({ layout: false, key: (to: { path: string }) => to.path })
useSeoMeta({ title: 'Deck workshop · CardShelf', robots: 'noindex, nofollow' })
const route = useRoute(), api = useApi(), id = computed(() => String(route.params.id)), isNew = computed(() => id.value === 'new')
const title = ref(''), rows = ref<any[]>([]), revision = ref(0), query = ref(''), owned = ref(false), supportedOnly = ref(false), page = ref(1)
const catalogue = ref<any>({ items: [], has_more: false }), legacy = ref<any[]>([]), legacyId = ref(''), selected = ref<any>(null)
const error = ref(''), notice = ref(''), busy = ref(false), loading = ref(false), ready = ref(false), validation = ref<any>(null)
let alive = true, sequence = 0, debounce: ReturnType<typeof setTimeout> | undefined, requestId = ''
const total = computed(() => rows.value.reduce((n, r) => n + r.quantity, 0))
const visible = computed<any[]>(() => supportedOnly.value ? catalogue.value.items.filter((c: any) => c.supported) : catalogue.value.items)
const grouped = computed(() => ['pokemon', 'trainer', 'energy'].map(kind => ({ kind, count: rows.value.filter(r => r.card.kind === kind).reduce((n, r) => n + r.quantity, 0) })))
async function search() {
  const seq = ++sequence; loading.value = true
  try { const next = await api('/api/arena/catalogue', { query: { q: query.value, page: page.value, owned: owned.value ? '1' : '0' } }); if (alive && seq === sequence) catalogue.value = next }
  catch (e) { if (alive && seq === sequence) error.value = errorMessage(e) } finally { if (seq === sequence) loading.value = false }
}
function accept(deck: any) { title.value = deck.title; rows.value = deck.cards.map((r: any) => ({ card: r.card, quantity: r.quantity })); revision.value = deck.revision || 0; validation.value = deck.validation }
function amount(card: any, delta: number) {
  if (busy.value || !ready.value) return
  const row = rows.value.find(r => r.card.id === card.id)
  if (delta > 0 && total.value >= 60) { error.value = 'The deck already has 60 cards.'; return }
  if (row) { row.quantity = Math.max(0, row.quantity + delta); rows.value = rows.value.filter(r => r.quantity > 0) } else if (delta > 0) rows.value.push({ card, quantity: 1 })
  validation.value = null; error.value = ''
}
async function save() {
  if (busy.value || !ready.value) return; busy.value = true; error.value = ''; notice.value = ''; requestId ||= crypto.randomUUID()
  try { const result = await api(isNew.value ? '/api/arena/decks' : '/api/arena/decks/' + id.value, { method: isNew.value ? 'POST' : 'PUT', body: { title: title.value, revision: revision.value, request_id: requestId, cards: rows.value.map(r => ({ card_id: r.card.id, quantity: r.quantity })) } }); accept(result); requestId = ''; notice.value = result.validation.playable ? 'Deck saved and ready for Casual Core.' : 'Draft saved. Complete the deck before entering a match.'; if (isNew.value) await navigateTo('/arena/decks/' + result.id) }
  catch (e) { error.value = errorMessage(e) + ' Your local edits are retained. Check your saved decks before retrying a creation after a connection failure.' } finally { busy.value = false }
}
async function importLegacy() {
  if (!legacyId.value || busy.value || !isNew.value || total.value) return; busy.value = true; error.value = ''
  try { const result = await api('/api/arena/legacy/' + legacyId.value); accept(result); notice.value = 'Copied the supported list into this unsaved draft. The original deck is unchanged.' }
  catch (e) { error.value = errorMessage(e) } finally { busy.value = false }
}
async function remove() {
  if (isNew.value || busy.value || !window.confirm('Delete this saved deck? Existing match snapshots and collection cards will remain.')) return
  busy.value = true; try { await api('/api/arena/decks/' + id.value, { method: 'DELETE', body: { title: title.value, revision: revision.value } }); await navigateTo('/arena') } catch (e) { error.value = errorMessage(e) } finally { busy.value = false }
}
function exportDeck() {
  const blob = new Blob([JSON.stringify({ format: 'cardshelf-arena-deck', version: 1, title: title.value, game: 'pokemon', cards: rows.value.map(r => ({ card_id: r.card.id, name: r.card.name, quantity: r.quantity })) }, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = 'cardshelf-arena-deck.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
}
watch([query, owned], () => { page.value = 1; clearTimeout(debounce); debounce = setTimeout(search, 250) })
watch(page, () => { clearTimeout(debounce); void search() })
onMounted(async () => {
  try { const status = await api('/api/arena/status'); if (!status.allowed) throw new Error(status.message); if (!isNew.value) accept(await api('/api/arena/decks/' + id.value)); legacy.value = (await api('/api/arena/decks')).legacy; ready.value = true; await search() }
  catch (e) { error.value = errorMessage(e) }
})
onBeforeUnmount(() => { alive = false; sequence++; clearTimeout(debounce) })
</script>
<template><ArenaShell title="DECK WORKSHOP"><div class="arena-section-heading"><div><span class="arena-kicker">BUILD YOUR STRATEGY</span><h1>{{ isNew ? 'A new contender.' : 'Tune your next match.' }}</h1></div><NuxtLink to="/arena" class="arena-link">Back to Arena</NuxtLink></div><p v-if="error" class="arena-alert error" role="alert">{{ error }}</p><p v-if="notice" class="arena-alert" role="status">{{ notice }}</p>
  <div v-if="ready" class="arena-workshop"><section><div class="arena-panel arena-workshop-search"><label>Search imported Pokémon cards<input v-model="query" maxlength="100" placeholder="Name or card number"></label><label class="arena-check"><input v-model="owned" type="checkbox">Owned cards only</label><label class="arena-check"><input v-model="supportedOnly" type="checkbox">Hide unsupported cards on this page</label><p class="arena-muted">An entire effect must be implemented before a card is available. Collectible artwork variants share the four-copy name limit. New game records do not need to be owned to build a practice deck.</p></div><p v-if="loading" role="status">Loading catalogue…</p><div class="arena-builder-grid"><article v-for="result in visible" :key="result.card.id" class="arena-catalogue-card" :class="{ unsupported: !result.supported }"><ArenaCard :card="result.card" @select="selected = result"/><strong>{{ result.card.name }}</strong><span>{{ result.supported ? 'Supported · ' + result.card.kind : 'Not supported yet' }}</span><p v-if="!result.supported" class="arena-muted">{{ result.reason }}</p><button class="arena-button" :disabled="busy || !result.supported || total >= 60" @click="amount(result.card, 1)">+ Add card</button></article></div><p v-if="!loading && !visible.length" class="arena-panel">No matching cards on this page. Import a Pokémon set, change the filters, or use original training decks from the Arena home.</p><div class="arena-pagination"><button class="arena-button" :disabled="loading || page === 1" @click="page--">Previous</button><span>Catalogue page {{ page }}</span><button class="arena-button" :disabled="loading || !catalogue.has_more" @click="page++">Next</button></div></section>
    <aside><section class="arena-panel arena-deck-summary"><label>Deck name<input v-model="title" maxlength="80" :disabled="busy" placeholder="Name your deck"></label><div class="arena-deck-total"><strong>{{ total }}</strong><span>/ 60 cards</span></div><div class="arena-deck-meter"><i :style="{ width: (total / 60 * 100) + '%' }" /></div><div class="arena-deck-kinds"><span v-for="group in grouped" :key="group.kind">{{ group.count }} {{ group.kind }}</span></div><p class="arena-muted">Exactly 60 cards, at least one Basic Pokémon, and no more than four cards with the same name except Basic Energy.</p><div v-for="row in rows" :key="row.card.id" class="arena-deck-row"><button class="arena-deck-row-name" @click="selected = { card: row.card, supported: true }">{{ row.card.name }}<small>{{ row.card.set_name }} #{{ row.card.number }}</small></button><div><button :disabled="busy" :aria-label="'Remove one ' + row.card.name" @click="amount(row.card, -1)">−</button><b>{{ row.quantity }}</b><button :disabled="busy || total >= 60" :aria-label="'Add one ' + row.card.name" @click="amount(row.card, 1)">+</button></div></div><p v-if="!rows.length" class="arena-muted">Add cards from the catalogue to begin.</p><div v-if="validation" class="arena-validation" :class="{ valid: validation.playable }"><strong>{{ validation.playable ? 'Ready for Casual Core' : 'Draft · not ready to play' }}</strong><p v-for="message in validation.errors" :key="message">{{ message }}</p></div><div class="arena-actions"><button class="arena-button primary" :disabled="busy || !title.trim()" @click="save">{{ busy ? 'Saving…' : 'Save deck' }}</button><button class="arena-button" @click="exportDeck">Export list</button><button v-if="!isNew" class="arena-link danger" :disabled="busy" @click="remove">Delete</button></div></section>
      <section v-if="isNew && legacy.length" class="arena-panel"><h2>Copy an earlier deck</h2><label>Manual beta deck<select v-model="legacyId" :disabled="busy || total > 0"><option value="">Choose a previous deck</option><option v-for="d in legacy" :key="d.id" :value="d.id">{{ d.title }}</option></select></label><button class="arena-button" :disabled="!legacyId || busy || total > 0" @click="importLegacy">Check and copy supported list</button><p class="arena-muted">Unsupported effects are reported, not removed silently. The original list remains intact.</p></section>
      <section v-if="selected" class="arena-panel arena-card-inspector"><h2>{{ selected.card.name }}</h2><ArenaCard :card="selected.card" disabled/><p v-if="selected.reason" class="arena-alert">{{ selected.reason }}</p><p>{{ selected.card.program?.text }}</p><div v-for="(attack, i) in selected.card.attacks || []" :key="i" class="arena-attack-info"><strong>{{ attack.name }} · {{ attack.printed || attack.damage }}</strong><small>{{ attack.cost.join(', ') }}</small><p>{{ attack.text }}</p></div></section>
    </aside></div>
</ArenaShell></template>
