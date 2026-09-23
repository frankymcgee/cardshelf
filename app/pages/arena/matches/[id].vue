<script setup lang="ts">
import ArenaAudioControls from '../../../components/arena/ArenaAudioControls.vue'
import ArenaShell from '../../../components/arena/ArenaShell.vue'
import ArenaCard from '../../../components/arena/ArenaCard.vue'
import ArenaCardPreview from '../../../components/arena/ArenaCardPreview.vue'
import ArenaActionTray from '../../../components/arena/ArenaActionTray.vue'
import ArenaModal from '../../../components/arena/ArenaModal.vue'
import ArenaBoard from '../../../components/arena/ArenaBoard.vue'
import ArenaEffects from '../../../components/arena/ArenaEffects.vue'
import ArenaPromptModal from '../../../components/arena/ArenaPromptModal.vue'
import ArenaCoach from '../../../components/arena/ArenaCoach.vue'
import ArenaMatchStatus from '../../../components/arena/ArenaMatchStatus.vue'
import ArenaTurnActions from '../../../components/arena/ArenaTurnActions.vue'
import ArenaHistory from '../../../components/arena/ArenaHistory.vue'
import { arenaConflict, arenaMoneylessResult } from '../../../../shared/arena.mjs'
definePageMeta({ layout: false, key: (to: { path: string }) => to.path })
useSeoMeta({ title: 'Battle arena · CardShelf', robots: 'noindex, nofollow' })
const api = useApi(), route = useRoute(), auth = useAuth()
const data = ref<any>(null), error = ref(''), connected = ref(false), busy = ref(false), pending = ref<any>(null)
const selected = ref(''), invitation = ref(''), showLog = ref(false), discardSeat = ref<number | null>(null), previewOpen = ref(false)
const autoplay = ref(false), focusZone = ref(''), showHelp = ref(false), focusMode = ref(false)
const table = computed<any>(() => data.value?.table), seat = computed(() => data.value?.seat ?? 0)
const aliases = computed(() => [data.value?.host_alias || 'Player one', data.value?.guest_alias || 'Player two'])
const finished = computed(() => ['finished', 'cancelled'].includes(data.value?.status))
const locked = computed(() => busy.value || !!pending.value || !connected.value || finished.value)
// Inspect only units already disclosed by the server; hidden setup cards have no children.
function publicCards(units: any[]): any[] { return units.filter(unit => unit && !unit.hidden && unit.card).flatMap(unit => [unit, ...publicCards([...(unit.tools || []), ...(unit.energy || []), ...(unit.under || [])])]) }
const cards = computed<any[]>(() => table.value ? publicCards([...table.value.players.flatMap((p: any, index: number) => [...(index === seat.value ? p.hand : []), p.active, ...p.bench, ...p.discard, ...(p.resolving || [])]), table.value.stadium?.unit]) : [])
const current = computed<any>(() => cards.value.find((c: any) => c.id === selected.value))
const attachmentParent = computed<any>(() => cards.value.find((unit: any) => [...(unit.tools || []), ...(unit.energy || []), ...(unit.under || [])].some((child: any) => child.id === selected.value)))
const stadiumMoves = computed<any[]>(() => (table.value?.legal || []).filter((move: any) => move.action?.type === 'stadium'))
const moves = computed<any[]>(() => (table.value?.legal || []).filter((m: any) => m.card === selected.value || (selected.value === table.value?.stadium?.unit?.id && m.action?.type === 'stadium')))
const globalMoves = computed<any[]>(() => (table.value?.legal || []).filter((m: any) => !m.card && m.action?.type !== 'stadium'))
const own = computed<any>(() => table.value?.players[seat.value])
const pendingForOther = computed(() => table.value?.waiting_for !== null && table.value?.waiting_for !== undefined && table.value.waiting_for !== seat.value)
const lostReply = computed(() => !!pending.value && !busy.value)
const noMoveHint = computed(() => table.value?.prompt ? 'Complete the required decision first.' : table.value?.turn !== seat.value && table.value?.phase !== 'setup' ? 'Wait for your turn.' : 'This card has no available move right now.')
let alive = true, reading = false, epoch = 0, timer: ReturnType<typeof setInterval> | undefined
const key = () => 'cardshelf-arena-action:' + auth.state.value.user?.id + ':' + String(route.params.id)
function store() { try { if (pending.value) sessionStorage.setItem(key(), JSON.stringify(pending.value)); else sessionStorage.removeItem(key()) } catch { /* Idempotency still applies while this page remains open. */ } }
function clearSelection() { selected.value = ''; previewOpen.value = false }
function accept(next: any) {
  if (!alive || next.id !== String(route.params.id) || data.value && next.revision < data.value.revision) return
  const newDecision = next.table?.prompt && next.revision !== data.value?.revision
  data.value = next; connected.value = true
  if (!pending.value) error.value = '' // A fresh read clears a recovered connection error, not an uncertain write.
  // Never keep a preview of a card that has left this player's disclosed view.
  if (selected.value && !current.value) clearSelection()
  if (newDecision || !next.table) { previewOpen.value = false; discardSeat.value = null; showLog.value = false; showHelp.value = false }
  if (next.invite_code) invitation.value = next.invite_code
  if (next.status !== 'waiting') invitation.value = ''
  if (finished.value) autoplay.value = false
}
async function load() {
  if (!alive || reading || busy.value || document.hidden) return
  reading = true; const stamp = epoch
  try { const next = await api('/api/arena/matches/' + encodeURIComponent(String(route.params.id))); if (alive && stamp === epoch) accept(next) }
  catch (e: any) { if (alive && stamp === epoch) { error.value = errorMessage(e); connected.value = false; autoplay.value = false; if ([401, 403, 404].includes(e?.statusCode || e?.status)) { data.value = null; clearSelection(); discardSeat.value = null; pending.value = null; store() } } }
  finally { reading = false }
}
async function send() {
  if (!alive || busy.value || !pending.value) return
  busy.value = true; error.value = ''; const task = pending.value, stamp = ++epoch
  try {
    const next = await api('/api/arena/matches/' + encodeURIComponent(task.id) + '/actions', { method: 'POST', body: task.body })
    if (!alive || stamp !== epoch) return
    pending.value = null; store()
    if (next.left) { await navigateTo('/arena'); return }
    accept(next)
  } catch (e: any) {
    if (!alive || stamp !== epoch) return
    error.value = errorMessage(e); connected.value = false; autoplay.value = false
    if (arenaConflict(e) || [400, 401, 403, 404, 422].includes(e?.statusCode || e?.status)) { pending.value = null; store(); if ([401, 403, 404].includes(e?.statusCode || e?.status)) { data.value = null; clearSelection(); discardSeat.value = null } }
    else error.value += ' The result is uncertain. Retry this same action instead of repeating it.'
  } finally { busy.value = false }
}
async function act(action: any) {
  if (locked.value || !data.value) return
  pending.value = { id: data.value.id, body: { revision: data.value.revision, request_id: crypto.randomUUID(), action } }; store(); await send()
}
function select(unit: any) {
  if (!unit || unit.hidden || !cards.value.some(card => card.id === unit.id)) return
  selected.value = unit.id; discardSeat.value = null
}
function inspectDiscard(unit: any) { select(unit); previewOpen.value = !!current.value }
function openDiscard(index: number) {
  if (!table.value || ![0, 1].includes(index)) return
  previewOpen.value = false; discardSeat.value = index
}
function concede() { if (window.confirm('Concede this game? Your collection and subscription will not change.')) void act({ type: 'concede' }) }
async function copyCode() { try { await navigator.clipboard.writeText(invitation.value) } catch { error.value = 'Select and copy the invitation manually.' } }
async function tick() {
  if (document.hidden || !alive || busy.value || pending.value) return
  if (data.value?.mode !== 'pvp' && table.value && !locked.value) {
    if (autoplay.value && (table.value.prompt || table.value.legal.length)) { await act({ type: 'autoplay' }); return }
    if (table.value.waiting_for === 1 || table.value.phase === 'playing' && table.value.turn === 1 || table.value.phase === 'setup' && !table.value.players[1].ready) { await act({ type: 'cpu_step' }); return }
  }
  await load()
}
function focus() { if (!document.hidden) void load() }
onMounted(async () => {
  try { const saved = JSON.parse(sessionStorage.getItem(key()) || 'null'); if (saved?.id === String(route.params.id) && typeof saved.body?.request_id === 'string' && saved.body?.action && Number.isInteger(saved.body.revision)) pending.value = saved } catch { /* Ignore damaged local retry metadata. */ }
  await load(); timer = setInterval(() => { void tick() }, 2000); window.addEventListener('focus', focus); document.addEventListener('visibilitychange', focus)
})
onBeforeUnmount(() => { alive = false; epoch++; clearInterval(timer); window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', focus); data.value = null; clearSelection(); discardSeat.value = null })
</script>
<template>
  <ArenaShell :title="data ? aliases.join(' VS ') : 'PRIVATE TABLE'" :focused="focusMode && !!table" :table="!!table">
    <div class="arena-match-view" :class="{ 'arena-match-has-selection': !!current, 'arena-match-focused': focusMode && !!table }">
    <div class="arena-table-top"><div><span class="arena-kicker">{{ data?.mode === 'pvp' ? 'PRIVATE MATCH' : data?.mode === 'tutorial' ? 'GUIDED TRAINING' : 'COMPUTER PRACTICE' }}</span><h1>{{ data ? aliases.join(' vs ') : 'Opening your table…' }}</h1><span class="arena-connection" :class="{ online: connected }">{{ connected ? 'Connected · server-checked actions' : 'Reconnecting · actions paused' }}</span></div><div class="arena-match-toolbar"><button v-if="table" type="button" class="arena-button quiet" :aria-pressed="focusMode" @click="focusMode = !focusMode">{{ focusMode ? 'Exit focus' : 'Focus table' }}</button><details class="arena-table-tools"><summary class="arena-button quiet">Table tools</summary><div class="arena-tools-panel"><div class="arena-toolbar"><button class="arena-button quiet" @click="showHelp = !showHelp">How to play</button><button class="arena-button quiet" :disabled="!table" @click="showLog = !showLog">History</button><button class="arena-button quiet" :disabled="busy" @click="load">Refresh</button></div><ArenaAudioControls :events="table?.events" :match-id="String(route.params.id)" :result="table?.result" :seat="seat" :available="!!data && connected" :selected="selected" /></div></details></div></div>
    <div v-if="error" role="alert" class="arena-alert error">{{ error }} <NuxtLink v-if="!data" to="/membership">Membership</NuxtLink></div>
    <div v-if="lostReply" class="arena-alert"><strong>Confirm the previous action first.</strong> Its request ID is saved in this tab; retrying cannot play the action twice.<button class="arena-button primary" @click="send">Retry same action</button></div>
    <ArenaModal :open="showHelp" label="How to play" @close="showHelp = false"><section class="arena-help"><h2>Choose cards. Let the game resolve the rules.</h2><p>Tap a card in your hand or on either field to select it. Selection does not play it. Choose Inspect for a larger preview, including attacks, Abilities, attached Energy, Tools and evolution cards. Available moves appear in the action tray. Attack buttons calculate Energy, Weakness, Resistance, supported effects and Knock Outs on the server. An attack normally ends the turn automatically.</p><p>Complete required decisions for Prize cards, searches, costs and replacement Pokémon. Back to table lets you inspect the field without confirming or cancelling a pending decision; choose Resume decision to continue. The game never exposes the opponent's hand or draw order. This automated format accepts only cards whose entire effect is implemented; it is not a tournament legality certificate.</p><p v-if="data?.mode !== 'pvp'">Auto play lets the same rule-based computer control your decisions in practice. Turn it off to take over. It is disabled in human-versus-human matches.</p></section></ArenaModal>
    <template v-if="data">
      <section v-if="!table" class="arena-panel arena-lobby"><span class="arena-kicker">{{ data.status }}</span><h2>Your private table</h2><p>Your deck: <strong>{{ data.own_deck.title }}</strong>. Your opponent does not receive your deck list.</p>
        <template v-if="data.status === 'waiting' && seat === 0"><p>Generate a one-day invitation and send it privately to another Collector, Collector Plus or Complimentary member.</p><div v-if="invitation" class="arena-invite"><code>{{ invitation }}</code><button class="arena-button" @click="copyCode">Copy</button></div><button class="arena-button primary" :disabled="locked" @click="act({ type: 'invite' })">{{ invitation ? 'Replace invitation' : 'Generate invitation' }}</button><p class="arena-muted">A new code invalidates the previous one. Codes are shown only when generated, not after a reload or lost-response retry.</p></template>
        <template v-if="data.status === 'approval'"><p>{{ seat === 0 ? data.guest_alias + ' is asking to join.' : 'Waiting for host approval.' }}</p><div v-if="seat === 0" class="arena-actions"><button class="arena-button primary" :disabled="locked" @click="act({ type: 'approve' })">Approve opponent</button><button class="arena-button" :disabled="locked" @click="act({ type: 'reject' })">Reject</button></div></template>
        <template v-if="data.status === 'ready'"><div class="arena-ready-row"><span>{{ aliases[0] }} · {{ data.host_ready ? 'Ready' : 'Preparing' }}</span><span>{{ aliases[1] }} · {{ data.guest_ready ? 'Ready' : 'Preparing' }}</span></div><div class="arena-actions"><button class="arena-button primary" :disabled="locked" @click="act({ type: (seat === 0 ? data.host_ready : data.guest_ready) ? 'unready' : 'ready' })">{{ (seat === 0 ? data.host_ready : data.guest_ready) ? 'Not ready' : 'Ready to play' }}</button><button v-if="seat === 0" class="arena-button" :disabled="locked || !data.host_ready || !data.guest_ready" @click="act({ type: 'start' })">Shuffle and start</button></div></template>
        <button v-if="!finished" class="arena-link danger" :disabled="locked" @click="act({ type: seat === 0 ? 'cancel' : 'leave' })">{{ seat === 0 ? 'Cancel lobby' : 'Leave lobby' }}</button><p v-else>This lobby is closed.</p>
      </section>
      <template v-if="table">
        <div v-if="data.mode === 'tutorial' && !finished" class="arena-tutorial-wrap"><ArenaCoach :progress="table.progress" :phase="table.phase" @focus="focusZone = $event"/><p class="arena-muted">Training uses original demonstration cards and a disclosed scripted opening. It does not add cards to your collection.</p></div>
        <p v-if="data.mode === 'practice' && data.opponent_deck" class="arena-opponent-note"><strong>CPU deck: {{ data.opponent_deck.title }}</strong><span>{{ data.opponent_deck.reason }}</span><small v-if="data.opponent_deck.training">Original teaching cards · training practice</small></p>
        <section v-if="finished" class="arena-result"><span class="arena-result-medal" aria-hidden="true">{{ table.result === seat ? 'V' : 'CS' }}</span><div><span class="arena-kicker">MATCH COMPLETE</span><h2>{{ table.result === 'draw' || table.result === 0 || table.result === 1 ? arenaMoneylessResult(table.result, seat) : 'Match complete' }}</h2><p>{{ table.result_reason }}</p><NuxtLink to="/arena" class="arena-button primary">Play again</NuxtLink></div></section>
        <ArenaMatchStatus :table="table" :status="data.status" :connected="connected" :busy="busy" :uncertain="!!pending" />

        <ArenaPromptModal v-if="!finished" :prompt="table.prompt" :revision="data.revision" :locked="locked" @choose="act({ type: 'choose', choices: $event })" />
        <div class="arena-play-layout"><div class="arena-board-wrap"><ArenaEffects :table="table" :match-id="data.id" :revision="data.revision" :available="connected"><ArenaBoard :table="table" :stadium-moves="stadiumMoves" :locked="locked" @action="act" :aliases="aliases" :selected="selected" :focus-zone="focusZone" @select="select" @discard="openDiscard">
          <template #actions>
            <aside class="arena-inspector arena-table-actions" aria-label="Selected card and legal actions">
              <div class="arena-turn-bar arena-match-controls" data-zone="turn"><div class="arena-actions"><ArenaTurnActions :table="table" :moves="globalMoves" :match-id="data.id" :revision="data.revision" :locked="locked" @action="act" /><label v-if="data.mode !== 'pvp' && !finished" class="arena-auto"><input v-model="autoplay" type="checkbox" :disabled="busy || !!pending || !connected">Auto play my turns</label><button v-if="!finished" class="arena-link danger" :disabled="locked" @click="concede">Concede</button></div></div>
              <p v-if="pendingForOther" class="arena-resolution-note" role="status">Waiting for your opponent to complete a required decision. The game will continue after it resolves.</p>
              <ArenaActionTray v-if="current" :unit="current" :moves="moves" :locked="locked" :hint="noMoveHint" @action="act" @inspect="previewOpen = true" @clear="clearSelection" />
              <section v-else class="arena-table-instructions"><span class="arena-kicker">YOUR NEXT MOVE</span><strong>Select a card</strong><p>Choose a hand or field card to see its moves. Use Inspect for a closer look.</p></section>
            </aside>
          </template>
        </ArenaBoard></ArenaEffects></div></div>
        <ArenaModal :open="previewOpen && !!current" label="Card preview" @close="previewOpen = false"><ArenaCardPreview v-if="current" :unit="current" :parent="attachmentParent" :selected="selected" :attack-blocks="own?.active?.id === current.id ? table.attack_blocks : undefined" @select="select" /></ArenaModal>
        <ArenaModal :open="discardSeat !== null" :label="(aliases[discardSeat ?? 0] || 'Player') + ' · Discard'" @close="discardSeat = null"><template v-if="discardSeat !== null"><h2>{{ aliases[discardSeat] }} · Discard</h2><div class="arena-discard-grid"><ArenaCard v-for="unit in table.players[discardSeat].discard" :key="unit.id" :unit="unit" @select="inspectDiscard" /></div><p v-if="!table.players[discardSeat].discard.length">No discarded cards.</p></template></ArenaModal>
        <ArenaModal :open="showLog" label="Match history" @close="showLog = false"><ArenaHistory v-if="showLog" :key="data.id" :events="table.events" :seat="seat" :aliases="aliases" /></ArenaModal>
      </template>
    </template>
    </div>
  </ArenaShell>
</template>

<style scoped>
.arena-match-toolbar{display:flex;align-items:flex-start;gap:10px;flex-wrap:wrap;max-width:100%}.arena-match-toolbar>.arena-button{min-height:44px}.arena-match-controls{margin-top:12px}.arena-match-focused .arena-play-layout{grid-template-columns:minmax(0,1fr)}.arena-match-focused .arena-inspector{position:static}.arena-match-focused .arena-desktop-preview,.arena-match-focused .arena-inspector-empty{display:none}.arena-help{line-height:1.7;max-width:760px}.arena-help p{margin:14px 0}

.arena-table-tools{position:relative;max-width:100%}.arena-table-tools>summary{cursor:pointer;list-style:none;min-height:44px;display:flex;align-items:center}.arena-table-tools>summary::-webkit-details-marker{display:none}.arena-tools-panel{position:absolute;right:0;top:calc(100% + 8px);z-index:25;width:min(360px,calc(100vw - 32px));max-height:65dvh;overflow-y:auto;overscroll-behavior:contain;padding:18px;border-radius:16px;border:1px solid #475960;background:#172b36;color:#eff8f6;box-shadow:0 16px 50px #0008}.arena-tools-panel .arena-toolbar{display:flex;flex-wrap:wrap;gap:8px}.arena-tools-panel .arena-toolbar button{min-height:44px}
@media(max-width:650px){.arena-tools-panel{position:relative;right:auto;top:8px;width:100%;max-height:65dvh}.arena-table-tools[open]{width:100%}.arena-table-top:has(.arena-table-tools[open]){flex-wrap:wrap}}
</style>
