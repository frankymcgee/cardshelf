<script setup lang="ts">
import ArenaShell from '~/components/arena/ArenaShell.vue'
import { tournamentRoundName } from '../../../../../shared/arena-tournaments.mjs'
definePageMeta({ layout: false, key: (to: { path: string }) => to.path })
useSeoMeta({ title: 'Tournament bracket · CardShelf', robots: 'noindex, nofollow' })
const api = useApi(), route = useRoute(), auth = useAuth(), data = ref<any>(null), error = ref(''), notice = ref(''), busy = ref(false), pending = ref<any>(null), connected = ref(false)
const email = ref(''), alias = ref(''), deckId = ref(''), consent = ref(false), decks = ref<any[]>([]), deckError = ref('')
const decisions = ref<Record<string, string>>({}), reasons = ref<Record<string, string>>({}), cancelReason = ref('')
const own = computed(() => data.value?.entries.find((e: any) => e.id === data.value.own_entry_id))
const accepted = computed(() => data.value?.entries.filter((e: any) => e.status === 'accepted') || [])
const rounds = computed(() => data.value?.bracket_size ? Array.from({ length: Math.log2(data.value.bracket_size) }, (_, i) => i + 1) : [])
const live = computed(() => data.value?.games.filter((g: any) => ['ready', 'active'].includes(g.status)) || [])
const locked = computed(() => busy.value || !!pending.value || !connected.value)
const name = (id: string | null) => data.value?.entries.find((e: any) => e.id === id)?.alias || (id ? 'Former entrant' : 'Awaiting winner')
const seed = (id: string | null) => data.value?.entries.find((e: any) => e.id === id)?.seed
const canPlay = (node: any) => !!node && !!own.value && [node.left_id, node.right_id].includes(own.value.id)
const endpoint = () => '/api/arena/tournaments/' + encodeURIComponent(String(route.params.id))
const key = () => 'cardshelf-tournament-action:' + auth.state.value.user?.id + ':' + String(route.params.id)
let alive = true, reading = false, epoch = 0, timer: ReturnType<typeof setInterval> | undefined
function store() { try { pending.value ? sessionStorage.setItem(key(), JSON.stringify(pending.value)) : sessionStorage.removeItem(key()) } catch {} }
function accept(next: any) { if (alive && next.id === String(route.params.id) && (!data.value || next.revision >= data.value.revision)) { data.value = next; connected.value = true; if (!pending.value) error.value = '' } }
async function load() {
  if (!alive || reading || busy.value || document.hidden) return; reading = true; const stamp = epoch
  try { const next = await api(endpoint()); if (stamp === epoch) accept(next) }
  catch (e: any) { if (alive && stamp === epoch) { error.value = errorMessage(e); connected.value = false; if ([401, 403, 404].includes(e?.statusCode || e?.status)) { data.value = null; pending.value = null; store(); decks.value = [] } } }
  finally { reading = false }
}
async function loadDecks() {
  deckError.value = ''
  try { const result = await api('/api/arena/decks'); if (alive) decks.value = result.decks.filter((d: any) => d.validation?.playable) }
  catch (e) { if (alive) { deckError.value = errorMessage(e); decks.value = [] } }
}
async function send() {
  if (busy.value || !pending.value) return; busy.value = true; error.value = ''; const stamp = ++epoch, intent = pending.value
  try {
    const next = await api(endpoint() + '/actions', { method: 'POST', body: intent })
    if (!alive || stamp !== epoch) return
    pending.value = null; store(); accept(next); notice.value = 'Tournament updated.'
    if (intent.type === 'invite') email.value = ''
    if (next.opened_match_id) { const node = next.nodes.find((n: any) => n.id === next.games.find((g: any) => g.id === next.opened_match_id)?.node_id); await navigateTo(canPlay(node) ? '/arena/matches/' + next.opened_match_id : '/arena/tournaments/' + next.id + '/watch/' + next.opened_match_id) }
  } catch (e: any) {
    if (alive && stamp === epoch) { error.value = errorMessage(e); if ([400, 401, 403, 404, 409, 422, 429].includes(e?.statusCode || e?.status)) { pending.value = null; store() } else error.value += ' Retry the same request to confirm its result.' }
  } finally { busy.value = false }
}
async function act(type: string, values: any = {}) {
  if (locked.value || !data.value) return
  pending.value = { type, ...values, revision: data.value.revision, request_id: crypto.randomUUID() }; store(); await send()
}
function register() { const deck = decks.value.find(d => d.id === deckId.value); if (deck) void act('accept', { deck_id: deck.id, deck_revision: deck.revision, alias: alias.value, spectator_consent: consent.value }) }
function start() { if (window.confirm(`Randomly seed ${accepted.value.length} accepted entrants and lock registration? Unaccepted invitations will not enter the bracket.`)) void act('start', { confirm: true }) }
function forfeit(node: any) { if (window.confirm(`Advance ${name(decisions.value[node.id] || null)} by administrator forfeit? This closes any unfinished game and cannot be undone.`)) void act('forfeit', { node_id: node.id, winner_id: decisions.value[node.id], reason: reasons.value[node.id] }) }
function cancel() { if (window.confirm('Cancel this tournament and close its unfinished matches?')) void act('cancel', { reason: cancelReason.value }) }
function focus() { if (!document.hidden) void load() }
onMounted(async () => {
  try { const old = JSON.parse(sessionStorage.getItem(key()) || 'null'); if (old?.request_id && old?.type) pending.value = old } catch {}
  await load(); if (own.value) { alias.value = own.value.alias; deckId.value = own.value.deck_id || ''; consent.value = !!own.value.spectator_consent; if (data.value.status === 'registration') await loadDecks() }
  timer = setInterval(() => { void load() }, 5000); window.addEventListener('focus', focus); document.addEventListener('visibilitychange', focus)
})
onBeforeUnmount(() => { alive = false; epoch++; clearInterval(timer); window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', focus); data.value = null; decks.value = [] })
</script>
<template>
  <ArenaShell class="arena-events-page" title="TOURNAMENT BRACKET">
    <NuxtLink to="/arena/tournaments" class="arena-link">← All tournaments</NuxtLink>
    <p v-if="error" class="arena-alert error" role="alert">{{ error }} <button class="arena-link" @click="load">Refresh tournament</button></p>
    <p v-if="notice && !error" class="arena-alert" role="status">{{ notice }}</p>
    <p v-if="pending" class="arena-alert">The previous action needs confirmation. <button class="arena-button primary" :disabled="busy" @click="send">Retry same action</button></p>
    <p v-if="!data && !error" class="arena-panel" role="status">Opening the event…</p>
    <template v-if="data">
      <header class="at-event-heading"><div><span class="arena-kicker">CARDSHELF ARENA · SINGLE ELIMINATION</span><h1>{{ data.title }}</h1><p>{{ data.description }}</p></div><div><span class="at-chip">{{ data.status }}</span><span class="at-connection">{{ connected ? 'Live bracket · updates every 5 seconds' : 'Connection interrupted' }}</span></div></header>
      <section v-if="data.champion_id" class="at-champion"><span aria-hidden="true">★</span><div><span class="arena-kicker">TOURNAMENT CHAMPION</span><h2>{{ name(data.champion_id) }}</h2><p>A place at the top. A run to remember.</p></div></section>
      <div v-if="data.status === 'registration'" class="at-registration">
        <section v-if="own && ['invited', 'accepted'].includes(own.status)" class="arena-panel"><span class="arena-kicker">YOUR SEAT AT THE TABLE</span><h2>{{ own.status === 'accepted' ? 'Your registration' : 'You’re invited' }}</h2><p v-if="own.status === 'accepted'">Registered with <strong>{{ own.deck_title }}</strong>. Later workshop edits do not change this snapshot. You can replace your registration before the draw.</p><p v-if="deckError" class="arena-alert">{{ deckError }} <NuxtLink to="/membership">Membership</NuxtLink></p><form class="at-form" @submit.prevent="register"><label>Player alias<input v-model="alias" maxlength="40" required :disabled="locked"></label><label>Registered deck<select v-model="deckId" required :disabled="locked"><option value="">Choose a playable saved deck</option><option v-for="deck in decks" :key="deck.id" :value="deck.id">{{ deck.title }}</option></select></label><p v-if="!decks.length" class="arena-muted">A playable 60-card deck and Arena access are required. <NuxtLink to="/arena/decks/new">Open the workshop</NuxtLink> · <button type="button" class="arena-link" @click="loadDecks">Refresh decks</button></p><label class="arena-check"><input v-model="consent" type="checkbox" required :disabled="locked">I understand administrators can watch and may stream my alias and public match board. Both hands, face-down Prizes and deck order stay private.</label><div class="arena-actions"><button class="arena-button primary" :disabled="locked || !deckId || !consent">{{ own.status === 'accepted' ? 'Update registered deck' : 'Accept invitation' }}</button><button type="button" class="arena-link" :disabled="locked" @click="act(own.status === 'accepted' ? 'withdraw' : 'decline')">{{ own.status === 'accepted' ? 'Withdraw before draw' : 'Decline invitation' }}</button></div></form></section>
        <section v-if="data.is_admin" class="arena-panel"><span class="arena-kicker">ORGANISER CONTROLS</span><h2>Fill the bracket</h2><form class="at-form" @submit.prevent="act('invite', { email })"><label>Member email<input v-model="email" type="email" required maxlength="254" :disabled="locked" placeholder="Registered email address"></label><button class="arena-button" :disabled="locked || !email.trim()">Invite member</button></form><p class="arena-muted">Invitations appear on the member’s Tournaments page. Email is not sent.</p><hr><strong>{{ accepted.length }} accepted · {{ data.capacity }} places</strong><p>Accepted players receive random seeds. Byes fill an uneven bracket. Each pairing is one game; a draw requires a rematch.</p><button class="arena-button primary" :disabled="locked || accepted.length < 2" @click="start">Draw bracket & start</button></section>
      </div>
      <section v-if="data.is_admin && live.length" class="at-live"><div class="arena-section-heading"><div><span class="arena-kicker">COMMENTARY DESK</span><h2>Tables on air</h2></div><span>{{ live.length }} open tables</span></div><div class="at-live-grid"><NuxtLink v-for="game in live" :key="game.id" :to="'/arena/tournaments/' + data.id + '/watch/' + game.id" class="at-live-card"><span class="at-live-dot"/><div><strong>{{ name(data.nodes.find((n: any) => n.id === game.node_id)?.left_id) }} vs {{ name(data.nodes.find((n: any) => n.id === game.node_id)?.right_id) }}</strong><small>{{ game.status === 'active' ? 'Live match' : 'Players getting ready' }} · Open commentary view →</small></div></NuxtLink></div></section>
      <section v-if="rounds.length"><div class="arena-section-heading"><div><span class="arena-kicker">THE ROAD TO THE TITLE</span><h2>Tournament bracket</h2></div><span class="arena-muted">Random seeds · {{ accepted.length }} entrants</span></div><div class="at-bracket" tabindex="0" role="region" aria-label="Tournament bracket"><section v-for="round in rounds" :key="round" class="at-round"><h3>{{ tournamentRoundName(round, data.bracket_size) }}</h3><div class="at-round-pairings"><article v-for="node in data.nodes.filter((n: any) => n.round === round)" :key="node.id" class="at-pairing" :class="{ 'at-pairing-live': node.status === 'playing' }"><header><span>Match {{ node.position + 1 }}</span><span>{{ node.status === 'draw' ? 'Rematch needed' : node.status }}</span></header><div v-for="(entryId, side) in [node.left_id, node.right_id]" :key="side" class="at-entrant" :class="{ winner: entryId && node.winner_id === entryId, mine: entryId && data.own_entry_id === entryId }"><small>{{ seed(entryId) || '—' }}</small><strong>{{ !entryId && node.status === 'bye' ? 'Bye' : name(entryId) }}</strong><span v-if="entryId && node.winner_id === entryId" aria-label="Winner">✓</span></div><p v-if="node.reason" class="at-outcome">{{ node.outcome === 'forfeit' ? 'Administrator forfeit: ' : '' }}{{ node.reason }}</p><div v-if="data.status === 'running' && ['ready','playing','draw'].includes(node.status)" class="at-pairing-actions"><NuxtLink v-if="node.match_id && node.status === 'playing' && canPlay(node)" :to="'/arena/matches/' + node.match_id" class="arena-button primary">Play match</NuxtLink><button v-else-if="canPlay(node) || data.is_admin" class="arena-button primary" :disabled="locked" @click="act('open', { node_id: node.id })">{{ node.status === 'draw' ? 'Open rematch' : 'Open match' }}</button><NuxtLink v-if="data.is_admin && node.match_id" :to="'/arena/tournaments/' + data.id + '/watch/' + node.match_id" class="arena-link">Watch table →</NuxtLink><details v-if="data.is_admin" class="at-forfeit"><summary>Resolve a no-show</summary><form class="at-form" @submit.prevent="forfeit(node)"><label>Advance entrant<select v-model="decisions[node.id]" required :disabled="locked"><option value="">Choose a winner</option><option v-for="entryId in [node.left_id,node.right_id]" :key="entryId" :value="entryId">{{ name(entryId) }}</option></select></label><label>Forfeit reason<input v-model="reasons[node.id]" minlength="5" maxlength="500" required :disabled="locked"></label><button class="arena-button" :disabled="locked">Record forfeit</button></form></details></div><NuxtLink v-else-if="data.is_admin && node.match_id" :to="'/arena/tournaments/' + data.id + '/watch/' + node.match_id" class="arena-link">View finished table →</NuxtLink></article></div></section></div></section>
      <details class="arena-panel at-roster" :open="data.status === 'registration'"><summary>Entrants & invitations · {{ data.entries.length }}</summary><ul><li v-for="entry in data.entries" :key="entry.id"><span><strong>{{ entry.alias }}</strong><small v-if="data.is_admin">{{ entry.email || 'Account unavailable' }}</small></span><span class="at-chip">{{ entry.status }}</span><button v-if="data.is_admin && data.status === 'registration'" class="arena-link" :disabled="locked" :aria-label="'Remove ' + entry.alias" @click="act('remove', { entry_id: entry.id })">Remove</button></li></ul></details>
      <details v-if="data.is_admin && ['registration','running'].includes(data.status)" class="arena-panel at-cancel"><summary>Cancel this tournament</summary><form class="at-form" @submit.prevent="cancel"><label>Cancellation reason<input v-model="cancelReason" minlength="5" maxlength="500" required :disabled="locked"></label><button class="arena-button" :disabled="locked">Cancel tournament</button></form></details>
    </template>
  </ArenaShell>
</template>
<style src="~/assets/css/arena-tournaments.css"></style>
