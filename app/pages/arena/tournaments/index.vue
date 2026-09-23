<script setup lang="ts">
import ArenaShell from '~/components/arena/ArenaShell.vue'
definePageMeta({ layout: false })
useSeoMeta({ title: 'Arena tournaments · CardShelf', robots: 'noindex, nofollow' })
const api = useApi(), auth = useAuth(), data = ref<any>(null), error = ref(''), busy = ref(false), pending = ref<any>(null)
const title = ref(''), description = ref(''), capacity = ref(16)
let alive = true
const key = () => 'cardshelf-tournament-create:' + auth.state.value.user?.id
function store() { try { pending.value ? sessionStorage.setItem(key(), JSON.stringify(pending.value)) : sessionStorage.removeItem(key()) } catch {} }
async function load() { try { const next = await api('/api/arena/tournaments'); if (alive) { data.value = next; if (!pending.value) error.value = '' } } catch (e: any) { if (alive) { error.value = errorMessage(e); if ([401, 403].includes(e?.statusCode || e?.status)) data.value = null } } }
async function create() {
  if (busy.value) return; busy.value = true; error.value = ''
  pending.value ||= { title: title.value.trim(), description: description.value.trim(), capacity: capacity.value, request_id: crypto.randomUUID() }; store()
  try { const result = await api('/api/arena/tournaments', { method: 'POST', body: pending.value }); pending.value = null; store(); if (alive) await navigateTo('/arena/tournaments/' + result.id) }
  catch (e: any) { if (alive) { error.value = errorMessage(e); if ([400, 401, 403, 404, 409, 422, 429].includes(e?.statusCode || e?.status)) { pending.value = null; store() } } }
  finally { busy.value = false }
}
onMounted(async () => { try { const old = JSON.parse(sessionStorage.getItem(key()) || 'null'); if (old?.request_id) pending.value = old } catch {} await load() })
onBeforeUnmount(() => { alive = false })
</script>
<template>
  <ArenaShell class="arena-events-page" title="TOURNAMENTS">
    <section class="at-hero"><div><span class="arena-kicker">A PLACE IN THE FINAL</span><h1>Your next<br><em>championship run.</em></h1><p>Accept your invitation. Bring your deck. Make every round count.</p><span class="at-chip">Random draw · Single elimination · 2–64 players</span></div><div class="at-trophy" aria-hidden="true">★<span>CARDSHELF<br>ARENA CUP</span></div></section>
    <p v-if="error" class="arena-alert error" role="alert">{{ error }}</p>
    <p v-if="!data && !error" role="status" class="arena-panel">Loading your events…</p>
    <section v-if="data?.is_admin" class="arena-panel at-create"><div><span class="arena-kicker">EVENT ORGANISER</span><h2>Create a tournament</h2><p>Invite registered members in CardShelf, then draw the bracket when your entrants are ready.</p></div><form @submit.prevent="create"><label>Event name<input v-model="title" required maxlength="100" :disabled="busy || !!pending" placeholder="Friday night Arena Cup"></label><label>Event description<input v-model="description" maxlength="1000" :disabled="busy || !!pending" placeholder="A friendly evening at the table"></label><label>Maximum entrants<input v-model.number="capacity" type="number" min="2" max="64" required :disabled="busy || !!pending"></label><p v-if="pending" class="arena-alert">Confirming the previous creation. Retry uses the same request.</p><button class="arena-button primary" :disabled="busy">{{ pending ? 'Retry event creation' : 'Create tournament' }}</button></form></section>
    <section v-if="data"><div class="arena-section-heading"><div><span class="arena-kicker">THE EVENT CALENDAR</span><h2>{{ data.is_admin ? 'Your tournaments' : 'Your invitations & events' }}</h2></div><button class="arena-link" @click="load">Refresh events</button></div><div class="at-event-grid"><NuxtLink v-for="event in data.events" :key="event.id" :to="'/arena/tournaments/' + event.id" class="at-event-card"><div><span class="at-chip">{{ event.status }}</span><span v-if="event.invitation_status === 'invited'" class="at-invited">You’re invited</span></div><h3>{{ event.title }}</h3><p>{{ event.description || 'One bracket. One champion.' }}</p><footer><span>{{ event.entrants }}/{{ event.capacity }} registered</span><strong>Open event →</strong></footer></NuxtLink></div><p v-if="!data.events.length" class="arena-panel arena-muted">No tournament invitations yet. Your administrator can invite you using your registered email address.</p></section>
  </ArenaShell>
</template>
<style src="~/assets/css/arena-tournaments.css"></style>
