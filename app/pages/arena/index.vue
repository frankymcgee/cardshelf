<script setup lang="ts">
import ArenaShell from '../../components/arena/ArenaShell.vue'
import { ARENA_NOTICE } from '../../../shared/arena.mjs'
definePageMeta({ layout: false })
useSeoMeta({ title: 'Battle arena · CardShelf', robots: 'noindex, nofollow' })
const api = useApi(), auth = useAuth()
const access = ref<any>(null), decks = ref<any[]>([]), matches = ref<any[]>([]), loading = ref(true), error = ref(''), busy = ref(false)
const alias = ref(''), deck = ref(''), difficulty = ref('normal'), code = ref(''), pending = ref<any>(null)
async function load() {
  loading.value = true
  try { access.value = await api('/api/arena/status'); if (access.value.allowed) { const [d, m] = await Promise.all([api('/api/arena/decks'), api('/api/arena/matches')]); decks.value = d.decks; matches.value = m.matches } else { decks.value = []; matches.value = [] } }
  catch (e) { error.value = errorMessage(e) } finally { loading.value = false }
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
  if (mode === 'pvp' && !selected) { error.value = 'Select a saved 60-card deck for a private match.'; return }
  const useTraining = mode === 'tutorial' || !selected
  pending.value = { path: '/api/arena/matches', body: { mode, alias: alias.value.trim(), difficulty: difficulty.value, request_id: crypto.randomUUID(), ...(useTraining ? { training: true } : { deck_id: selected.id, deck_revision: selected.revision }) } }; await submit()
}
async function join() {
  if (busy.value || pending.value) return
  const selected = decks.value.find(d => d.id === deck.value)
  if (!selected) { error.value = 'Select your saved deck before joining.'; return }
  pending.value = { path: '/api/arena/join', body: { code: code.value.trim(), alias: alias.value.trim(), deck_id: selected.id, deck_revision: selected.revision, request_id: crypto.randomUUID() } }; await submit()
}
onMounted(() => { alias.value = String(auth.state.value.user?.name || 'Collector').slice(0, 40); void load() })
</script>
<template><ArenaShell>
  <section class="arena-hero"><div><span class="arena-kicker">YOUR NEXT MATCH STARTS HERE</span><h1>Bring your deck.<br><em>Own your next move.</em></h1><p>Private head-to-head games, a computer practice partner and guided training. Automatic turns, attacks and supported card effects on a proper tabletop.</p><div class="arena-hero-badges"><span>Collector</span><span>Collector Plus</span><span>Pokémon · Casual Core</span></div></div><div class="arena-hero-table" aria-hidden="true"><i class="arena-hero-card one">CS</i><i class="arena-hero-card two">ARENA</i><i class="arena-hero-card three">60</i><span class="arena-hero-glow"/></div></section>
  <p v-if="error" class="arena-alert error" role="alert">{{ error }}</p><p v-if="loading" class="arena-panel" role="status">Preparing the arena…</p>
  <div v-if="pending && !busy" class="arena-alert"><p>A previous request still needs confirmation. Its request ID is retained.</p><button class="arena-button primary" @click="submit">Retry same request</button></div>
  <section v-if="access && !access.allowed" class="arena-panel"><h2>{{ access.tier ? 'The arena is currently paused' : 'Battle is a Collector benefit' }}</h2><p>{{ access.message }}</p><NuxtLink to="/membership" class="arena-button primary">Your membership</NuxtLink><p class="arena-muted">Administrator and old playtester permissions are not subscriptions. An administrator can assign a Collector tier for a controlled test without changing billing.</p></section>
  <template v-if="access?.allowed"><section class="arena-player-settings arena-panel"><label>Player name<input v-model="alias" maxlength="40" :disabled="busy || !!pending" placeholder="Public match alias"></label><label>Saved deck<select v-model="deck" :disabled="busy || !!pending"><option value="">Original training deck · solo modes</option><option v-for="d in decks" :key="d.id" :value="d.id">{{ d.title }} · {{ d.total }} cards</option></select></label><label>Computer strength<select v-model="difficulty" :disabled="busy || !!pending"><option value="easy">Relaxed</option><option value="normal">Standard</option></select></label><NuxtLink to="/arena/decks/new" class="arena-button">Build a deck</NuxtLink></section>
    <div class="arena-mode-grid"><article class="arena-mode-card"><span class="arena-mode-symbol" aria-hidden="true">01</span><span class="arena-kicker">LEARN BY PLAYING</span><h2>Guided training</h2><p>Set up your field, power an attack, resolve decisions and play to a result. A coach follows your progress using original teaching cards.</p><button class="arena-button primary" :disabled="busy || !!pending || !alias.trim()" @click="start('tutorial')">Start walkthrough</button></article><article class="arena-mode-card"><span class="arena-mode-symbol" aria-hidden="true">02</span><span class="arena-kicker">YOUR PRACTICE PARTNER</span><h2>Computer battle</h2><p>Test a supported deck against the CPU. Play each turn yourself or switch on Auto play to watch the rules-based players battle.</p><button class="arena-button primary" :disabled="busy || !!pending || !alias.trim()" @click="start('practice')">Play the computer</button></article><article class="arena-mode-card"><span class="arena-mode-symbol" aria-hidden="true">03</span><span class="arena-kicker">COLLECTOR VS COLLECTOR</span><h2>Private match</h2><p>Create a lobby, invite another subscribed member and approve their seat. Both players ready up before the first shuffle.</p><button class="arena-button primary" :disabled="busy || !!pending || !deck || !alias.trim()" @click="start('pvp')">Create private table</button></article></div>
    <form class="arena-panel arena-join" @submit.prevent="join"><div><span class="arena-kicker">HAVE AN INVITATION?</span><h2>Join their table.</h2></div><label>Invitation code<input v-model="code" maxlength="48" minlength="48" autocomplete="off" :disabled="busy || !!pending" required placeholder="Paste the private code"></label><button class="arena-button primary" :disabled="busy || !!pending || !deck || !alias.trim()">Join match</button></form>
    <div class="arena-section-heading"><h2>Your tables</h2><button class="arena-link" :disabled="loading" @click="load">Refresh</button></div><div class="arena-match-list"><NuxtLink v-for="match in matches" :key="match.id" :to="'/arena/matches/' + match.id" class="arena-match-row"><span class="arena-match-icon" aria-hidden="true">VS</span><div><strong>{{ match.host_alias }} vs {{ match.guest_alias || 'Waiting for opponent' }}</strong><small>{{ match.mode }} · {{ new Date(match.updated_at).toLocaleString() }}</small></div><span class="arena-status">{{ match.status }}</span><span aria-hidden="true">→</span></NuxtLink><p v-if="!matches.length" class="arena-panel arena-muted">Your first match is one click away. Training and computer practice do not require a catalogue import.</p></div>
    <div class="arena-section-heading"><h2>Saved decks</h2><NuxtLink to="/arena/decks/new" class="arena-link">New deck</NuxtLink></div><div class="arena-deck-list"><NuxtLink v-for="d in decks" :key="d.id" :to="'/arena/decks/' + d.id" class="arena-deck-mini"><span>{{ d.total }}<small>/ 60</small></span><strong>{{ d.title }}</strong><small>Edit deck →</small></NuxtLink></div>
  </template>
  <section class="arena-format-note"><h2>Automatic, without guessing card text.</h2><p>{{ ARENA_NOTICE }}</p><p>Normal Pokémon, Basic Energy and supported Item/Supporter effects are available. Cards with unimplemented Abilities, special rules or complex effects stay out of automated matches. The deck builder gives the reason for each unsupported card.</p><NuxtLink to="/battle" class="arena-link">Previous manual tables ↗</NuxtLink><NuxtLink v-if="access?.is_admin" to="/admin/arena" class="arena-link">Arena administration ↗</NuxtLink></section>
</ArenaShell></template>
