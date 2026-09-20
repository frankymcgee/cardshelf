<script setup lang="ts">
definePageMeta({ key: (to: { path: string }) => to.path })
import BattleCardText from '../../../components/battle/BattleCardText.vue'
import { BATTLE_DISCLAIMER } from '../../../../shared/battle.mjs'
const api = useApi(), route = useRoute(), title = ref('My Pokémon deck'), rows = ref<any[]>([]), revision = ref(0)
const results = ref<any[]>([]), query = ref(''), owned = ref(false), page = ref(1), more = ref(false), inspect = ref<any>(null)
const allowed = ref(false), pendingSave = ref<any>(null), busy = ref(false), loading = ref(true), searching = ref(false), error = ref(''), validation = ref<any>(null), saved = ref('')
const total = computed(() => rows.value.reduce((n, r) => n + r.quantity, 0))
const signature = () => JSON.stringify({ title: title.value, cards: rows.value.map(r => ({ card_id: r.card.id, quantity: r.quantity })) })
const dirty = computed(() => signature() !== saved.value)
let searchSequence = 0, alive = true
async function search(next = 1) {
  const sequence = ++searchSequence; searching.value = true; error.value = ''
  try { const result = await api('/api/battle/cards', { query: { q: query.value, page: next, owned: owned.value ? '1' : '0' } }); if (alive && sequence === searchSequence) { results.value = result.items; page.value = result.page; more.value = result.has_more } }
  catch (e) { if (alive && sequence === searchSequence) error.value = errorMessage(e) }
  finally { if (alive && sequence === searchSequence) searching.value = false }
}
function adjust(card: any, amount: number) {
  if (busy.value || pendingSave.value || total.value + amount > 60) return
  const row = rows.value.find(r => r.card.id === card.id)
  if (row) { row.quantity += amount; rows.value = rows.value.filter(r => r.quantity > 0) }
  else if (amount > 0) rows.value.push({ card, quantity: amount })
}
async function load() {
  try { const access = await api('/api/battle'); allowed.value = access.allowed === true; if (!allowed.value) { error.value = 'Battle beta must be enabled and your account approved before building a deck.'; return }
    const id = String(route.params.id)
    if (id !== 'new') { const deck = await api('/api/battle/decks/' + id); title.value = deck.title; rows.value = deck.cards; revision.value = deck.revision; validation.value = deck.validation }
    saved.value = signature(); await search()
  } catch (e) { error.value = errorMessage(e) }
  finally { loading.value = false }
}
async function save() {
  if (busy.value || !allowed.value) return
  busy.value = true; error.value = ''
  const id = String(route.params.id)
  pendingSave.value ||= { title: title.value, game: 'pokemon', cards: rows.value.map(r => ({ card_id: r.card.id, quantity: r.quantity })), revision: revision.value, request_id: crypto.randomUUID() }
  try { const deck = await api('/api/battle/decks' + (id === 'new' ? '' : '/' + id), { method: id === 'new' ? 'POST' : 'PUT', body: pendingSave.value })
    if (!alive) return
    title.value = deck.title; rows.value = deck.cards; revision.value = deck.revision; validation.value = deck.validation; saved.value = signature(); pendingSave.value = null
    if (id === 'new') await navigateTo('/battle/decks/' + deck.id, { replace: true })
  } catch (e: any) { if (!alive) return; error.value = errorMessage(e); if ([400, 401, 403, 404, 409].includes(e?.statusCode || e?.status)) { pendingSave.value = null; if ([401, 403, 404].includes(e?.statusCode || e?.status)) { allowed.value = false; rows.value = []; results.value = []; inspect.value = null } } else error.value += ' Save confirmation is uncertain. Retry the same saved request before changing this draft.' }
  finally { busy.value = false }
}
async function remove() {
  if (busy.value || pendingSave.value || dirty.value || String(route.params.id) === 'new' || !window.confirm('Delete saved deck “' + title.value + '”? Your collection and existing match snapshots will remain unchanged.')) return
  busy.value = true
  try { await api('/api/battle/decks/' + route.params.id, { method: 'DELETE', body: { revision: revision.value, confirm_title: title.value } }); await navigateTo('/battle') }
  catch (e) { error.value = errorMessage(e) } finally { busy.value = false }
}
function exportDeck() {
  const blob = new Blob([JSON.stringify({ format: 'cardshelf-battle-deck', version: 1, game: 'pokemon', title: title.value, cards: rows.value.map(r => ({ card_id: r.card.id, name: r.card.name, quantity: r.quantity })) }, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = 'cardshelf-pokemon-deck.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
}
onMounted(load)
onBeforeUnmount(() => { alive = false; searchSequence++; rows.value = []; results.value = []; inspect.value = null; pendingSave.value = null })
useSeoMeta({ title: 'Build a Pokémon deck · CardShelf', robots: 'noindex, nofollow' })
</script>
<template><div class="battle-ui"><header class="battle-top"><div><NuxtLink to="/battle" class="text-button">Back to Battle</NuxtLink><h1>Build your next deck.</h1><p class="muted">English Pokémon · card designs, not collectible finishes.</p></div><span class="battle-summary-total">{{ total }} / 60</span></header>
<p class="battle-intro">{{ BATTLE_DISCLAIMER }} You may use unowned cards for this private playtest. The Owned cards only filter is optional; changing a deck never adds or removes physical copies.</p><p v-if="error" class="alert error" role="alert">{{ error }}</p><p v-if="loading" class="loading-panel">Loading your deck…</p>
<div v-else-if="allowed" class="battle-deck-layout"><section class="panel battle-card-panel"><form @submit.prevent="search(1)"><div class="battle-search-head"><label>Search imported cards<input v-model="query" type="search" maxlength="100" placeholder="Card name or number"></label><button class="button primary" :disabled="searching">Search</button></div><label class="battle-check spaced"><input v-model="owned" type="checkbox" @change="search(1)">Owned cards only</label></form><p v-if="searching" class="small muted" role="status">Searching…</p>
<div class="battle-search-grid"><article v-for="card in results" :key="card.id" class="battle-catalogue-card"><strong>{{ card.name }}</strong><small class="muted">{{ card.set_name }} · {{ card.number }}<br>{{ card.category }} {{ card.stage }} · Owned {{ card.owned_quantity }}</small><button class="text-button" @click="inspect = card">Read card</button><button class="button secondary" :disabled="busy || !!pendingSave || total >= 60" @click="adjust(card, 1)">Add to deck</button></article></div><p v-if="!results.length && !searching" class="battle-empty">No matching English Pokémon cards. Import a Pokémon set in Data & settings before building decks.</p><div class="battle-actions"><button class="button secondary" :disabled="page <= 1 || searching" @click="search(page - 1)">Previous</button><span class="small">Page {{ page }}</span><button class="button secondary" :disabled="!more || searching" @click="search(page + 1)">Next</button></div></section>
<section class="panel battle-card-panel"><form @submit.prevent="save"><label>Deck name<input v-model="title" required maxlength="80" :disabled="busy || !!pendingSave"></label><ul class="battle-list spaced"><li v-for="row in rows" :key="row.card.id" class="battle-row"><div><button class="text-button" @click.prevent="inspect = row.card">{{ row.card.name }}</button><small>{{ row.card.set_name }} · {{ row.card.number }}</small></div><div class="battle-quantity"><button type="button" :disabled="busy || !!pendingSave" :aria-label="'Remove one ' + row.card.name" @click="adjust(row.card, -1)">−</button><span>{{ row.quantity }}</span><button type="button" :disabled="busy || !!pendingSave || total >= 60" :aria-label="'Add one ' + row.card.name" @click="adjust(row.card, 1)">+</button></div></li></ul><p v-if="!rows.length" class="battle-empty">Add cards from the catalogue to start your deck.</p><div class="battle-actions"><button class="button primary" :disabled="busy">{{ busy ? 'Saving…' : pendingSave ? 'Retry save' : 'Save deck' }}</button><button type="button" class="button secondary" :disabled="busy || !!pendingSave" @click="exportDeck">Export list</button><button v-if="route.params.id !== 'new'" type="button" class="text-button" :disabled="busy || !!pendingSave || dirty" @click="remove">Delete deck</button></div><p class="small muted">{{ dirty ? 'Unsaved changes. Save before entering a match.' : 'Saved. Changes do not affect active matches.' }}</p></form>
<div v-if="validation" class="battle-validation"><strong>{{ validation.playable ? 'Casual deck construction complete' : 'Before entering a match' }}</strong><p v-if="dirty">These checks describe the last saved version.</p><p v-for="message in validation.errors" :key="message">{{ message }}</p><p v-for="message in validation.warnings" :key="message" class="muted">{{ message }}</p></div><p class="data-note">The usual copy limit is checked by English card name across artwork variants; only explicitly identified Basic Energy is exempt. Exceptions and tournament legality require player review.</p></section></div>
<AppModal :open="!!inspect" :title="inspect?.name || 'Card text'" @close="inspect = null"><BattleCardText v-if="inspect" :card="inspect"/></AppModal></div></template>
<style src="~/assets/css/battle.css"></style>
