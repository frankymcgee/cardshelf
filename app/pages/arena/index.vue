<script setup lang="ts">
import ArenaDeckCover from '../../components/arena/ArenaDeckCover.vue'
import ArenaShell from '../../components/arena/ArenaShell.vue'
import { ARENA_NOTICE } from '../../../shared/arena.mjs'
definePageMeta({ layout: false })
useSeoMeta({ title: 'Battle arena · CardShelf', robots: 'noindex, nofollow' })
const api = useApi(), auth = useAuth()
const access = ref<any>(null), decks = ref<any[]>([]), matches = ref<any[]>([]), loading = ref(true), error = ref(''), busy = ref(false)
const alias = ref(''), deck = ref(''), difficulty = ref('normal'), code = ref(''), pending = ref<any>(null)
const opponent = ref('matched'), opponentDeck = ref('')
const opponentChoices = computed(() => decks.value.filter(playable))
const openMatches = computed(() => matches.value.filter(m => ['waiting', 'approval', 'ready', 'active'].includes(m.status)))
const continueMatch = computed(() => openMatches.value.find(m => m.status === 'active') || openMatches.value[0])
const pastMatches = computed(() => matches.value.filter(m => !['waiting', 'approval', 'ready', 'active'].includes(m.status)))
const tableFilter = ref('open')
const shownMatches = computed(() => tableFilter.value === 'open' ? openMatches.value : pastMatches.value)
const selectedDeck = computed(() => decks.value.find(d => d.id === deck.value))
function playable(d: any) { return d.validation ? d.validation.playable : d.total === 60 }
function modeLabel(mode: string) { return ({ tutorial: 'Guided training', practice: 'Computer practice', pvp: 'Private match' } as Record<string, string>)[mode] || mode }
function statusLabel(status: string) { return ({ waiting: 'Awaiting a player', approval: 'Seat approval', ready: 'Ready up', active: 'In progress', finished: 'Finished', cancelled: 'Cancelled' } as Record<string, string>)[status] || status }
let alive = true, sequence = 0
onBeforeUnmount(() => { alive = false; sequence++ })
async function load() {
  const seq = ++sequence; loading.value = true; error.value = ''
  try {
    const status = await api('/api/arena/status')
    if (!alive || seq !== sequence) return
    access.value = status
    if (status.allowed) {
      const [d, m] = await Promise.all([api('/api/arena/decks'), api('/api/arena/matches')])
      if (!alive || seq !== sequence) return
      decks.value = d.decks; matches.value = m.matches
    } else { decks.value = []; matches.value = [] }
  } catch (e: any) {
    if (alive && seq === sequence) { error.value = errorMessage(e); if ([401, 403].includes(e?.statusCode || e?.status)) { decks.value = []; matches.value = []; access.value = null } }
  } finally { if (alive && seq === sequence) loading.value = false }
}
async function submit() {
  if (busy.value || !pending.value) return
  busy.value = true; error.value = ''
  try { const result = await api(pending.value.path, { method: 'POST', body: pending.value.body }); pending.value = null; await navigateTo('/arena/matches/' + result.id) }
  catch (e: any) { error.value = errorMessage(e); if ([400, 401, 403, 404, 409, 422, 429].includes(e?.statusCode || e?.status)) pending.value = null; else error.value += ' Retry the same request below; do not create another match.' }
  finally { busy.value = false }
}
async function start(mode: string) {
  if (busy.value || pending.value) return
  const selected = decks.value.find(d => d.id === deck.value)
  if (mode === 'pvp' && (!selected || !playable(selected))) { error.value = 'Select a saved 60-card deck for a private match.'; return }
  if (mode === 'practice' && selected && !playable(selected)) { error.value = 'Complete and save a playable deck before starting practice.'; return }
  const useTraining = mode === 'tutorial' || !selected
  const chosenOpponent = decks.value.find(d => d.id === opponentDeck.value)
  if (mode === 'practice' && !useTraining && opponent.value === 'saved' && (!chosenOpponent || !playable(chosenOpponent))) { error.value = 'Choose a saved opponent deck before starting practice.'; return }
  const opponentOptions = mode === 'practice' && !useTraining ? { opponent: opponent.value, ...(opponent.value === 'saved' ? { opponent_deck_id: chosenOpponent.id, opponent_deck_revision: chosenOpponent.revision } : {}) } : {}
  pending.value = { path: '/api/arena/matches', body: { mode, alias: alias.value.trim(), difficulty: difficulty.value, request_id: crypto.randomUUID(), ...(useTraining ? { training: true } : { deck_id: selected.id, deck_revision: selected.revision }), ...opponentOptions } }; await submit()
}
async function join() {
  if (busy.value || pending.value) return
  const selected = decks.value.find(d => d.id === deck.value)
  if (!selected || !playable(selected)) { error.value = 'Select a playable saved deck before joining.'; return }
  pending.value = { path: '/api/arena/join', body: { code: code.value.trim(), alias: alias.value.trim(), deck_id: selected.id, deck_revision: selected.revision, request_id: crypto.randomUUID() } }; await submit()
}
onMounted(() => { alias.value = String(auth.state.value.user?.name || 'Collector').slice(0, 40); void load() })
</script>
<template>
  <ArenaShell class="arena-lobby-page">
    <section class="aw-lobby-hero">
      <div><span class="arena-kicker">WELCOME TO YOUR ARENA</span><h1>A deck worth building.<br><em>A table worth returning to.</em></h1><p>Find your next idea, settle into practice or bring a friend to the table.</p><div class="arena-actions"><a href="#play-modes" class="arena-button primary">Choose your next game <span aria-hidden="true">↓</span></a><NuxtLink to="/arena/decks/new" class="arena-button">Build a deck</NuxtLink></div><span class="aw-format-label">POKÉMON · AUTOMATED CASUAL EXPANDED</span></div>
      <ArenaDeckCover training />
    </section>
    <p v-if="error" class="arena-alert error" role="alert">{{ error }}</p>
    <p v-if="loading" class="arena-panel" role="status">Preparing your decks and tables…</p>
    <div v-if="pending && !busy" class="arena-alert"><p>The previous request needs confirmation before you can start another game.</p><button class="arena-button primary" @click="submit">Retry same request</button></div>
    <section v-if="access && !access.allowed" class="arena-panel"><span class="arena-kicker">YOUR ARENA ACCESS</span><h2>{{ access.tier ? 'The Arena is currently paused' : 'Take your seat with Collector' }}</h2><p>{{ access.message }}</p><NuxtLink to="/membership" class="arena-button primary">Your membership</NuxtLink></section>
    <template v-if="access?.allowed">
      <NuxtLink v-if="continueMatch" :to="'/arena/matches/' + continueMatch.id" class="aw-continue"><span class="aw-continue-icon" aria-hidden="true">↗</span><div><span class="arena-kicker">YOUR TABLE IS WAITING</span><h2>{{ continueMatch.status === 'active' ? 'Continue match' : 'Return to lobby' }}</h2><p>{{ continueMatch.host_alias }} vs {{ continueMatch.guest_alias || 'Waiting for a player' }} · {{ modeLabel(continueMatch.mode) }}</p></div><span class="arena-status">{{ statusLabel(continueMatch.status) }}</span><span aria-hidden="true">→</span></NuxtLink>
      <div id="play-modes" class="arena-section-heading aw-heading"><div><span class="arena-kicker">MAKE YOUR NEXT MOVE</span><h2>How would you like to play?</h2></div><span class="arena-muted">Three ways to find your rhythm.</span></div>
      <section class="aw-player-settings arena-panel"><label>Player name<input v-model="alias" maxlength="40" :disabled="busy || !!pending" placeholder="Public match alias"></label><label>Saved deck<select v-model="deck" :disabled="busy || !!pending"><option value="">Original training deck · solo modes</option><option v-for="d in decks" :key="d.id" :value="d.id">{{ d.title }} · {{ d.total }}/60{{ playable(d) ? '' : ' · draft' }}</option></select></label><label>Computer strength<select v-model="difficulty" :disabled="busy || !!pending"><option value="easy">Relaxed</option><option value="normal">Standard</option></select></label></section>
      <p v-if="selectedDeck && !playable(selectedDeck)" class="arena-alert">Your selected deck needs attention before a match. <NuxtLink :to="'/arena/decks/' + selectedDeck.id">Open deck workshop →</NuxtLink></p>
      <div class="aw-mode-grid">
        <article class="aw-mode-card aw-training"><span class="aw-mode-number">01</span><div class="aw-mode-art" aria-hidden="true"/><span class="arena-kicker">START SOMETHING NEW</span><h2>Guided training</h2><p>Learn with original illustrated teaching decks. Your coach walks you through setup, Energy and your first attacks.</p><span class="aw-mode-note">No saved deck needed</span><button class="arena-button primary" :disabled="busy || !!pending || !alias.trim()" @click="start('tutorial')">Start walkthrough</button></article>
        <article class="aw-mode-card aw-practice"><span class="aw-mode-number">02</span><div class="aw-mode-art" aria-hidden="true"/><span class="arena-kicker">TEST YOUR NEXT IDEA</span><h2>Computer practice</h2><p>Try a new strategy, mirror your deck or choose a saved opponent. Play at your own pace.</p><div v-if="deck" class="arena-practice-options"><label>Opponent deck<select v-model="opponent" :disabled="busy || !!pending"><option value="matched">Matched Deck</option><option value="mirror">Mirror Deck</option><option value="saved">Choose Opponent Deck</option></select></label><label v-if="opponent === 'saved'">Saved opponent deck<select v-model="opponentDeck" :disabled="busy || !!pending"><option value="">Select a playable deck</option><option v-for="d in opponentChoices" :key="d.id" :value="d.id">{{ d.title }}</option></select></label><p>{{ opponent === 'matched' ? 'Uses a playable saved deck with a similar composition, or a disclosed mirror when none is available.' : opponent === 'mirror' ? 'The computer uses its own shuffled copy of your deck.' : 'Both saved lists are checked before play.' }}</p></div><span v-else class="aw-mode-note">Original Ember and Tide training cards</span><button class="arena-button primary" :disabled="busy || !!pending || !alias.trim() || (!!selectedDeck && !playable(selectedDeck)) || (!!deck && opponent === 'saved' && !opponentDeck)" @click="start('practice')">{{ deck ? 'Play the computer' : 'Practise with training cards' }}</button></article>
        <article class="aw-mode-card aw-private"><span class="aw-mode-number">03</span><div class="aw-mode-art" aria-hidden="true"/><span class="arena-kicker">A FRIENDLY RIVALRY</span><h2>Private match</h2><p>Create a table, share its invitation and approve your opponent’s seat. Ready your decks and play head to head.</p><span class="aw-mode-note">Two eligible members · two playable decks</span><button class="arena-button primary" :disabled="busy || !!pending || !selectedDeck || !playable(selectedDeck) || !alias.trim()" @click="start('pvp')">Create private table</button></article>
      </div>
      <form class="arena-panel aw-join" @submit.prevent="join"><div><span class="arena-kicker">INVITED TO PLAY?</span><h2>Join their table.</h2></div><label>Invitation code<input v-model="code" maxlength="48" minlength="48" autocomplete="off" :disabled="busy || !!pending" required placeholder="Paste the private invitation code"></label><button class="arena-button" :disabled="busy || !!pending || !selectedDeck || !playable(selectedDeck) || !alias.trim()">Join match</button></form>
      <section class="aw-deck-shelf"><div class="arena-section-heading aw-heading"><div><span class="arena-kicker">THE DECK WORKSHOP</span><h2>Your next contenders.</h2></div><NuxtLink to="/arena/decks/new" class="arena-button">+ New deck</NuxtLink></div><div class="aw-deck-grid"><article v-for="d in decks" :key="d.id" class="aw-saved-deck"><NuxtLink :to="'/arena/decks/' + d.id" class="aw-deck-open"><ArenaDeckCover :cards="d.preview" /><div class="aw-deck-caption"><span :class="['aw-deck-state', { ready: playable(d) }]">{{ playable(d) ? 'Ready to play' : 'Draft' }}</span><h3>{{ d.title }}</h3><p>{{ d.total }}/60 cards <span v-for="group in d.groups" :key="group.kind">· {{ group.count }} {{ group.kind === 'pokemon' ? 'Pokémon' : group.kind === 'trainer' ? 'Trainers' : 'Energy' }}</span></p></div></NuxtLink><div class="aw-deck-actions"><button class="arena-link" :disabled="busy || !!pending || !playable(d)" @click="deck = d.id">{{ deck === d.id ? 'Selected for play ✓' : 'Select for play' }}</button><NuxtLink :to="{ path: '/arena/decks/new', query: { copy: d.id } }" class="arena-link" :aria-label="'Duplicate ' + d.title">Duplicate</NuxtLink></div></article><NuxtLink to="/arena/decks/new" class="aw-new-deck"><span aria-hidden="true">+</span><h3>{{ decks.length ? 'A fresh idea.' : 'Build your first deck.' }}</h3><p>Start from the catalogue or import a deck list.</p><strong>Open the workshop →</strong></NuxtLink></div></section>
      <section><div class="arena-section-heading aw-heading"><div><span class="arena-kicker">PICK UP WHERE YOU LEFT OFF</span><h2>Your tables</h2></div><button class="arena-link" :disabled="loading" @click="load">Refresh tables</button></div><div class="aw-table-tabs" role="group" aria-label="Filter your tables"><button :aria-pressed="tableFilter === 'open'" @click="tableFilter = 'open'">Open tables · {{ openMatches.length }}</button><button :aria-pressed="tableFilter === 'past'" @click="tableFilter = 'past'">Past matches · {{ pastMatches.length }}</button></div><div class="arena-match-list"><NuxtLink v-for="match in shownMatches" :key="match.id" :to="'/arena/matches/' + match.id" class="arena-match-row"><span class="arena-match-icon" aria-hidden="true">VS</span><div><strong>{{ match.host_alias }} vs {{ match.guest_alias || 'Waiting for a player' }}</strong><small>{{ modeLabel(match.mode) }} · {{ new Date(match.updated_at).toLocaleString() }}</small></div><span class="arena-status">{{ statusLabel(match.status) }}</span><span aria-hidden="true">→</span></NuxtLink><p v-if="!shownMatches.length" class="arena-panel arena-muted">{{ tableFilter === 'open' ? 'No open tables. Training is a good place to start, with no saved deck or catalogue import required.' : 'Your finished and cancelled matches will appear here.' }}</p></div></section>
    </template>
    <section class="arena-format-note"><h2>Supported cards. Clear rules.</h2><p>{{ ARENA_NOTICE }}</p><p>The workshop checks every card’s effects before play. Your physical collection stays separate from the decks you use in Arena.</p><NuxtLink v-if="access?.is_admin" to="/admin/arena" class="arena-link">Arena administration ↗</NuxtLink></section>
  </ArenaShell>
</template>
