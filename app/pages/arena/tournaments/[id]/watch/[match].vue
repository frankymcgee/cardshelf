<script setup lang="ts">
import ArenaShell from '~/components/arena/ArenaShell.vue'
import ArenaBoard from '~/components/arena/ArenaBoard.vue'
import ArenaEffects from '~/components/arena/ArenaEffects.vue'
import ArenaModal from '~/components/arena/ArenaModal.vue'
import ArenaCard from '~/components/arena/ArenaCard.vue'
import ArenaCardPreview from '~/components/arena/ArenaCardPreview.vue'
import ArenaHistory from '~/components/arena/ArenaHistory.vue'
import { tournamentRoundName } from '../../../../../../shared/arena-tournaments.mjs'
definePageMeta({ layout: false, key: (to: { path: string }) => to.path })
useSeoMeta({ title: 'Arena commentary desk · CardShelf', robots: 'noindex, nofollow' })
const api = useApi(), route = useRoute(), data = ref<any>(null), error = ref(''), connected = ref(false), stream = ref(false)
const selected = ref(''), showHistory = ref(false), discardSeat = ref<number | null>(null)
const aliases = computed(() => [data.value?.host_alias || 'Player one', data.value?.guest_alias || 'Player two'])
const table = computed(() => data.value?.table)
function disclosed(units: any[]): any[] { return units.filter(u => u && !u.hidden && u.card).flatMap(u => [u, ...disclosed([...(u.energy || []), ...(u.tools || []), ...(u.under || [])])]) }
const cards = computed<any[]>(() => table.value ? disclosed([...table.value.players.flatMap((p: any) => [p.active, ...p.bench, ...p.discard, ...(p.resolving || [])]), table.value.stadium?.unit]) : [])
const current = computed(() => cards.value.find(c => c.id === selected.value))
const parent = computed(() => cards.value.find(u => [...(u.energy || []), ...(u.tools || []), ...(u.under || [])].some(c => c.id === selected.value)))
const headline = computed(() => data.value?.status === 'cancelled' ? 'Table closed by organiser' : table.value?.phase === 'finished' ? table.value.result === 'draw' ? 'Draw · rematch required' : aliases.value[table.value.result] + ' wins' : table.value?.phase === 'setup' ? 'Opening setup' : table.value ? aliases.value[table.value.turn] + ' to play' : 'Players getting ready')
let alive = true, reading = false, timer: ReturnType<typeof setInterval> | undefined
function clear() { data.value = null; selected.value = ''; showHistory.value = false; discardSeat.value = null }
async function load() {
  if (!alive || reading || document.hidden) return; reading = true
  try {
    const next = await api('/api/arena/tournaments/' + encodeURIComponent(String(route.params.id)) + '/spectate/' + encodeURIComponent(String(route.params.match)))
    if (alive && next.id === String(route.params.match) && (!data.value || next.revision >= data.value.revision)) { data.value = next; connected.value = true; error.value = ''; if (!current.value) selected.value = '' }
  } catch (e: any) { if (alive) { connected.value = false; error.value = errorMessage(e); if ([401, 403, 404].includes(e?.statusCode || e?.status)) clear() } }
  finally { reading = false }
}
function inspect(unit: any) { if (unit && cards.value.some(c => c.id === unit.id)) { selected.value = unit.id; discardSeat.value = null } }
function focus() { if (!document.hidden) void load() }
onMounted(async () => { await load(); timer = setInterval(() => { void load() }, 2000); window.addEventListener('focus', focus); document.addEventListener('visibilitychange', focus) })
onBeforeUnmount(() => { alive = false; clearInterval(timer); window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', focus); clear() })
</script>
<template>
  <ArenaShell class="arena-events-page arena-commentary-page" title="COMMENTARY DESK" :focused="stream && !!data" :table="!!table">
    <header class="at-caster-heading"><NuxtLink :to="'/arena/tournaments/' + route.params.id" class="arena-link">← Bracket</NuxtLink><div><span class="arena-kicker">{{ data?.tournament_title || 'ADMINISTRATOR COMMENTARY' }}</span><h1>{{ data ? tournamentRoundName(data.round, data.bracket_size) + ' · Match ' + (data.position + 1) : 'Opening commentary desk…' }}</h1></div><button v-if="data" class="arena-button" :aria-pressed="stream" @click="stream = !stream">{{ stream ? 'Exit stream view' : 'Stream view' }}</button></header>
    <p v-if="error" class="arena-alert error" role="alert">{{ error }}</p>
    <template v-if="data">
      <div class="at-broadcast-status" role="status"><span :class="['at-live-dot', { disconnected: !connected }]"/>{{ connected ? 'LIVE PUBLIC BOARD' : 'CONNECTION INTERRUPTED · LAST RECEIVED BOARD' }}<span>Read only · Both hands stay private</span></div>
      <section class="at-scoreboard" aria-label="Tournament scoreboard"><div v-for="(alias, seat) in aliases" :key="seat" :class="{ playing: table?.phase === 'playing' && table?.turn === seat }"><span class="arena-kicker">PLAYER {{ seat + 1 }}</span><h2>{{ alias }}</h2><p v-if="table">{{ table.players[seat].prize_count }} Prizes remaining · {{ table.players[seat].hand_count }} in hand · {{ table.players[seat].deck_count }} in deck</p><p v-else>{{ (seat === 0 ? data.host_ready : data.guest_ready) ? 'Ready to play' : 'Preparing' }}</p></div><strong>{{ headline }}</strong></section>
      <div v-if="table" class="at-spectator-table"><ArenaEffects :table="table" :match-id="data.id" :revision="data.revision" :available="connected"><ArenaBoard :table="table" :aliases="aliases" :selected="selected" locked spectator @select="inspect" @discard="discardSeat = $event"><template #actions><div class="at-caster-tools"><span>Inspect any revealed card for commentary.</span><button class="arena-button" @click="showHistory = true">Match history</button><button class="arena-link" @click="load">Refresh board</button></div></template></ArenaBoard></ArenaEffects></div>
      <section v-else class="arena-panel"><h2>The table is ready</h2><p>Both players must ready up. The first player then shuffles and starts the match. The public field appears after opening setup is revealed.</p></section>
      <p v-if="!stream" class="arena-muted">Capture this window in your streaming software. Stream view removes the main navigation. This page grants no player controls and never receives hands, face-down Prize identities, deck lists or decision choices.</p>
      <ArenaModal :open="!!current" label="Public card details" @close="selected = ''"><ArenaCardPreview v-if="current" :unit="current" :parent="parent" :selected="selected" @select="inspect" /></ArenaModal>
      <ArenaModal :open="discardSeat !== null && !!table" :label="aliases[discardSeat ?? 0] + ' · Public discard'" @close="discardSeat = null"><template v-if="discardSeat !== null && table"><div class="arena-discard-grid"><ArenaCard v-for="unit in table.players[discardSeat].discard" :key="unit.id" :unit="unit" @select="inspect" /></div><p v-if="!table.players[discardSeat].discard.length">No discarded cards.</p></template></ArenaModal>
      <ArenaModal :open="showHistory && !!table" label="Public match history" @close="showHistory = false"><ArenaHistory v-if="showHistory && table" :events="table.events" :seat="0" :aliases="aliases" /></ArenaModal>
    </template>
  </ArenaShell>
</template>
<style src="~/assets/css/arena-tournaments.css"></style>
