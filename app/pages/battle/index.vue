<script setup lang="ts">
import { BATTLE_DISCLAIMER } from '../../../shared/battle.mjs'
const api = useApi(), auth = useAuth(), access = ref<any>(null), decks = ref<any[]>([]), matches = ref<any[]>([])
const busy = ref(false), error = ref(''), selected = ref(''), alias = ref(''), invitation = ref(''), consent = ref(false), created = ref<any>(null)
const pending = ref<{ path: string; body: any } | null>(null)
async function load() {
  error.value = ''
  try { access.value = await api('/api/battle'); if (access.value.allowed) { const [d, m] = await Promise.all([api('/api/battle/decks'), api('/api/battle/matches')]); decks.value = d.decks; matches.value = m.matches } }
  catch (e) { error.value = errorMessage(e) }
}
async function submit(join: boolean) {
  if (busy.value) return
  const deck = decks.value.find((d: any) => d.id === selected.value)
  if (!pending.value) { if (!deck || !consent.value) return; pending.value = { path: '/api/battle/' + (join ? 'join' : 'matches'), body: { deck_id: deck.id, deck_revision: deck.revision, alias: alias.value, request_id: crypto.randomUUID(), confirm_assisted: true, ...(join ? { invite_code: invitation.value.trim() } : {}) } } }
  busy.value = true; error.value = ''
  try { const task = pending.value, result = await api(task.path, { method: 'POST', body: task.body }); pending.value = null
    if (task.path.endsWith('/join')) await navigateTo('/battle/matches/' + result.id)
    else { created.value = result; await load() }
  } catch (e: any) { error.value = errorMessage(e); if ([400, 401, 403, 409].includes(e?.statusCode || e?.status)) pending.value = null }
  finally { busy.value = false }
}
async function copyCode() { try { await navigator.clipboard.writeText(created.value.invite_code) } catch { error.value = 'Select and copy the invitation code manually.' } }
onMounted(() => { alias.value = auth.state.value.user?.name?.slice(0, 40) || ''; load() })
useSeoMeta({ title: 'Battle beta · CardShelf', robots: 'noindex, nofollow' })
</script>
<template><div class="battle-ui">
  <header class="battle-top"><div><span class="eyebrow">POKÉMON · PRIVATE PLAYTEST</span><h1>A table for your next battle.</h1><p class="muted">Build a deck. Invite a friend. Play on a shared, private table.</p></div><NuxtLink v-if="access?.is_admin" to="/admin/battle" class="button secondary">Beta administration</NuxtLink></header>
  <p class="battle-intro">{{ BATTLE_DISCLAIMER }} Deck and match actions never change your physical collection, prices or binders.</p>
  <p v-if="error" class="alert error" role="alert">{{ error }}</p>
  <p v-if="!access && !error" class="loading-panel">Checking battle access…</p>
  <section v-if="access && !access.allowed" class="panel battle-card-panel"><h2>{{ access.enabled ? 'Invitation-only beta' : 'Battle beta is not enabled yet' }}</h2><p>An administrator must enable this private beta and explicitly approve participating accounts. No subscription purchase is required or created by this playtest.</p><NuxtLink v-if="access.is_admin" to="/admin/battle" class="button primary">Configure battle beta</NuxtLink></section>
  <template v-if="access?.allowed"><div class="battle-two"><section class="panel battle-card-panel"><div class="section-heading"><h2>Your decks</h2><NuxtLink to="/battle/decks/new" class="button primary">Build a deck</NuxtLink></div><ul class="battle-list"><li v-for="deck in decks" :key="deck.id" class="battle-row"><div><strong>{{ deck.title }}</strong><small>{{ deck.total }} / 60 cards · Pokémon</small></div><NuxtLink :to="'/battle/decks/' + deck.id" class="button secondary">Edit</NuxtLink></li></ul><p v-if="!decks.length" class="battle-empty">Create your first 60-card deck from the imported English Pokémon catalogue.</p></section>
  <section class="panel battle-card-panel"><h2>Create or join a private match</h2><form class="battle-form" @submit.prevent="submit(false)"><fieldset :disabled="busy || !!pending"><label>Saved deck<select v-model="selected" required><option value="">Choose a deck</option><option v-for="d in decks" :key="d.id" :value="d.id" :disabled="d.total !== 60">{{ d.title }} · {{ d.total }} cards</option></select></label><label class="spaced">Player alias<input v-model="alias" required maxlength="40" autocomplete="off"></label><label class="battle-check spaced"><input v-model="consent" type="checkbox" required><span>I accept casual assisted play, will review deck/rule exceptions with my opponent, and agree to share this alias with them.</span></label></fieldset><button class="button primary" :disabled="busy || !selected || !consent || !!pending">Create match</button><label>Or paste a private invitation code<input v-model="invitation" maxlength="32" autocomplete="off" spellcheck="false" :disabled="busy || !!pending"></label><button type="button" class="button secondary" :disabled="busy || !selected || !consent || invitation.trim().length !== 32 || !!pending" @click="submit(true)">Ask to join</button><button v-if="pending" type="button" class="button secondary" :disabled="busy" @click="submit(false)">Retry the same request</button></form><p class="data-note">Both players need beta approval. Decks are snapshotted when joining; editing a saved deck does not change an existing match. The host approves the opponent before either player can start.</p></section></div>
  <section v-if="created" class="panel battle-card-panel spaced"><h2>Your private lobby is ready</h2><p>Send the invitation code only to your opponent. It expires after 24 hours; the host can replace it.</p><div v-if="created.invite_code" class="battle-code">{{ created.invite_code }}</div><p v-else class="small muted">This was an earlier successful request. Open the lobby to generate a fresh invitation.</p><div class="battle-actions"><button v-if="created.invite_code" class="button secondary" @click="copyCode">Copy invitation</button><NuxtLink :to="'/battle/matches/' + created.id" class="button primary">Open lobby</NuxtLink></div></section>
  <section class="panel battle-card-panel spaced"><div class="section-heading"><h2>Your matches</h2><button class="button secondary" :disabled="busy" @click="load">Refresh</button></div><ul class="battle-list"><li v-for="match in matches" :key="match.id" class="battle-row"><div><strong>{{ match.host_alias }} vs {{ match.guest_alias || 'Awaiting opponent' }}</strong><small>{{ match.status }} · You are {{ match.seat }}</small></div><NuxtLink :to="'/battle/matches/' + match.id" class="button secondary">{{ ['finished', 'cancelled'].includes(match.status) ? 'Review' : 'Open table' }}</NuxtLink></li></ul><p v-if="!matches.length" class="battle-empty">No matches yet.</p></section></template>
</div></template>
<style src="~/assets/css/battle.css"></style>
