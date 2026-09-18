<script setup lang="ts">
import { gameName } from '../../shared/games.mjs'
const api = useApi(), notice = useNotice()
const state = ref<any>(null), error = ref(''), busy = ref(false), selected = ref('pokemon'), confirmed = ref(false)
async function load() {
  try { state.value = await api('/api/account/games'); selected.value = state.value.selected; error.value = ''; confirmed.value = false }
  catch (e) { error.value = errorMessage(e) }
}
onMounted(load)
async function save() {
  if (busy.value || !state.value || !confirmed.value) return
  busy.value = true
  try { await api('/api/account/games', { method: 'POST', body: { game: selected.value, revision: state.value.revision, confirm_read_only: true } }); await load(); notice.show('Your selected game has been saved. Existing collections are unchanged.') }
  catch (e) { error.value = errorMessage(e) } finally { busy.value = false }
}
</script>
<template>
  <section class="panel game-access-panel">
    <h2>Your card games</h2><p v-if="error" class="alert warning">{{ error }}</p>
    <template v-if="state">
      <p v-if="state.mode === 'unlimited'">All supported games are included in your Collector Pro or protected full-access membership.</p>
      <p v-else-if="state.mode === 'single'">Collector manages one game at a time: <strong>{{ gameName(state.selected) }}</strong>. Other games remain available in the free public catalogue.</p>
      <p v-else>Free card information and source prices are available for every supported game. Collector adds private tracking for one game; Collector Pro supports all games and detailed collection tools.</p>
      <div class="game-access-grid"><article v-for="game in state.games" :key="game.code"><h3>{{ game.name }}</h3><span class="badge" :class="game.manageable ? 'green' : ''">{{ game.manageable ? 'Collection management included' : 'Public lookup / existing records read-only' }}</span><NuxtLink :to="'/explore?game=' + game.code" class="text-button">Browse cards</NuxtLink></article></div>
      <form v-if="state.mode === 'single'" class="form-stack" @submit.prevent="save"><GamePicker v-model="selected" :disabled="busy" /><label class="checkbox-label"><input v-model="confirmed" type="checkbox" :disabled="busy">I understand my other games will be read-only. No cards or binders will be deleted.</label><button class="button primary" :disabled="busy || !confirmed">{{ busy ? 'Saving…' : 'Select managed game' }}</button></form>
      <p class="data-note">Existing binders remain readable and can be deleted; collection exports remain available. A downgrade never deletes another game’s data. A game selection does not change billing.</p>
      <NuxtLink v-if="state.mode !== 'unlimited'" to="/membership" class="text-button">Review membership options</NuxtLink>
    </template>
  </section>
</template>
