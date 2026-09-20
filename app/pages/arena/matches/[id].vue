<script setup lang="ts">
import ArenaAudioControls from '../../../components/arena/ArenaAudioControls.vue'
import ArenaShell from '../../../components/arena/ArenaShell.vue'
import ArenaCard from '../../../components/arena/ArenaCard.vue'
import ArenaBoard from '../../../components/arena/ArenaBoard.vue'
import ArenaDecision from '../../../components/arena/ArenaDecision.vue'
import ArenaCoach from '../../../components/arena/ArenaCoach.vue'
import { energySymbol, arenaConflict, arenaMoneylessResult } from '../../../../shared/arena.mjs'
definePageMeta({ layout: false, key: (to: { path: string }) => to.path })
useSeoMeta({ title: 'Battle arena · CardShelf', robots: 'noindex, nofollow' })
const api = useApi(), route = useRoute(), auth = useAuth()
const data = ref<any>(null), error = ref(''), connected = ref(false), busy = ref(false), pending = ref<any>(null)
const selected = ref(''), invitation = ref(''), showLog = ref(false), discardSeat = ref<number | null>(null)
const autoplay = ref(false), focusZone = ref(''), flash = ref<any>(null), showHelp = ref(false)
const table = computed<any>(() => data.value?.table), seat = computed(() => data.value?.seat ?? 0)
const aliases = computed(() => [data.value?.host_alias || 'Player one', data.value?.guest_alias || 'Player two'])
const finished = computed(() => ['finished', 'cancelled'].includes(data.value?.status))
const locked = computed(() => busy.value || !!pending.value || !connected.value || finished.value)
const cards = computed<any[]>(() => table.value ? table.value.players.flatMap((p: any) => [...p.hand, p.active, ...p.bench, ...p.discard, ...p.resolving].filter((c: any) => c && !c.hidden)) : [])
const current = computed<any>(() => cards.value.find((c: any) => c.id === selected.value))
const moves = computed<any[]>(() => (table.value?.legal || []).filter((m: any) => m.card === selected.value))
const globalMoves = computed<any[]>(() => (table.value?.legal || []).filter((m: any) => !m.card))
const own = computed<any>(() => table.value?.players[seat.value])
const pendingForOther = computed(() => table.value?.waiting_for !== null && table.value?.waiting_for !== undefined && table.value.waiting_for !== seat.value)
const lostReply = computed(() => !!pending.value && !busy.value)
let alive = true, reading = false, epoch = 0, lastEvent = -1, timer: ReturnType<typeof setInterval> | undefined, flashTimer: ReturnType<typeof setTimeout> | undefined
const key = () => 'cardshelf-arena-action:' + auth.state.value.user?.id + ':' + String(route.params.id)
function store() { try { if (pending.value) sessionStorage.setItem(key(), JSON.stringify(pending.value)); else sessionStorage.removeItem(key()) } catch { /* Idempotency still applies while this page remains open. */ } }
function accept(next: any) {
  if (!alive || next.id !== String(route.params.id) || data.value && next.revision < data.value.revision) return
  data.value = next; connected.value = true
  if (next.invite_code) invitation.value = next.invite_code
  if (next.status !== 'waiting') invitation.value = ''
  const events = next.table?.events || [], recent = events.filter((e: any) => e.n > lastEvent)
  if (lastEvent >= 0) { const hit = [...recent].reverse().find((e: any) => ['attack', 'knockout', 'result', 'coin'].includes(e.kind)); if (hit) { flash.value = hit; clearTimeout(flashTimer); flashTimer = setTimeout(() => { flash.value = null }, 1700) } }
  lastEvent = events.at(-1)?.n ?? lastEvent
  if (finished.value) autoplay.value = false
}
async function load() {
  if (!alive || reading || busy.value || document.hidden) return
  reading = true; const stamp = epoch
  try { const next = await api('/api/arena/matches/' + encodeURIComponent(String(route.params.id))); if (alive && stamp === epoch) accept(next) }
  catch (e: any) { if (alive && stamp === epoch) { error.value = errorMessage(e); connected.value = false; autoplay.value = false; if ([401, 403, 404].includes(e?.statusCode || e?.status)) { data.value = null; selected.value = ''; pending.value = null; store() } } }
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
    if (arenaConflict(e) || [400, 401, 403, 404, 422].includes(e?.statusCode || e?.status)) { pending.value = null; store(); if ([401, 403, 404].includes(e?.statusCode || e?.status)) data.value = null }
    else error.value += ' The result is uncertain. Retry this same action instead of repeating it.'
  } finally { busy.value = false }
}
async function act(action: any) {
  if (locked.value || !data.value) return
  pending.value = { id: data.value.id, body: { revision: data.value.revision, request_id: crypto.randomUUID(), action } }; store(); await send()
}
function focusControls() {
  if (typeof window.matchMedia !== 'function' || !window.matchMedia('(max-width: 850px)').matches) return
  setTimeout(() => { if (alive) document.querySelector('.arena-inspector')?.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }) }, 0)
}
function select(unit: any) { selected.value = unit.id; discardSeat.value = null; focusControls() }
watch(() => table.value?.prompt ? JSON.stringify([table.value.prompt.kind, table.value.prompt.options.map((o: any) => o.id)]) : '', value => { if (value) focusControls() })
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
onBeforeUnmount(() => { alive = false; epoch++; clearInterval(timer); clearTimeout(flashTimer); window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', focus); data.value = null })
</script>
<template>
  <ArenaShell :title="data ? aliases.join(' VS ') : 'PRIVATE TABLE'">
    <div class="arena-table-top"><div><span class="arena-kicker">{{ data?.mode === 'pvp' ? 'PRIVATE MATCH' : data?.mode === 'tutorial' ? 'GUIDED TRAINING' : 'COMPUTER PRACTICE' }}</span><h1>{{ data ? aliases.join(' vs ') : 'Opening your table…' }}</h1><span class="arena-connection" :class="{ online: connected }">{{ connected ? 'Connected · server-checked actions' : 'Reconnecting · actions paused' }}</span></div><details class="arena-table-tools"><summary class="arena-button quiet">Table tools</summary><div class="arena-tools-panel"><div class="arena-toolbar"><button class="arena-button quiet" @click="showHelp = !showHelp">How to play</button><button class="arena-button quiet" @click="showLog = !showLog">History</button><button class="arena-button quiet" :disabled="busy" @click="load">Refresh</button></div><ArenaAudioControls :events="table?.events" :match-id="String(route.params.id)" :result="table?.result" :seat="seat" :available="!!data && connected" :selected="selected" /></div></details></div>
    <div v-if="error" role="alert" class="arena-alert error">{{ error }} <NuxtLink v-if="!data" to="/membership">Membership</NuxtLink></div>
    <div v-if="lostReply" class="arena-alert"><strong>Confirm the previous action first.</strong> Its request ID is saved in this tab; retrying cannot play the action twice.<button class="arena-button primary" @click="send">Retry same action</button></div>
    <section v-if="showHelp" class="arena-panel arena-help"><h2>Choose cards. Let the game resolve the rules.</h2><p>Select a card in your hand or on your field. Available moves appear in the action panel. Attack buttons calculate Energy, Weakness, Resistance, supported effects and Knock Outs on the server. An attack normally ends the turn automatically.</p><p>Complete highlighted decisions for Prize cards, searches, costs and replacement Pokémon. The game never exposes the opponent's hand or draw order. This automated format accepts only cards whose entire effect is implemented; it is not a tournament legality certificate.</p><p v-if="data?.mode !== 'pvp'">Auto play lets the same rule-based computer control your decisions in practice. Turn it off to take over. It is disabled in human-versus-human matches.</p></section>
    <template v-if="data">
      <section v-if="!table" class="arena-panel arena-lobby"><span class="arena-kicker">{{ data.status }}</span><h2>Your private table</h2><p>Your deck: <strong>{{ data.own_deck.title }}</strong>. Your opponent does not receive your deck list.</p>
        <template v-if="data.status === 'waiting' && seat === 0"><p>Generate a one-day invitation and send it privately to another Collector, Collector Plus or Complimentary member.</p><div v-if="invitation" class="arena-invite"><code>{{ invitation }}</code><button class="arena-button" @click="copyCode">Copy</button></div><button class="arena-button primary" :disabled="locked" @click="act({ type: 'invite' })">{{ invitation ? 'Replace invitation' : 'Generate invitation' }}</button><p class="arena-muted">A new code invalidates the previous one. Codes are shown only when generated, not after a reload or lost-response retry.</p></template>
        <template v-if="data.status === 'approval'"><p>{{ seat === 0 ? data.guest_alias + ' is asking to join.' : 'Waiting for host approval.' }}</p><div v-if="seat === 0" class="arena-actions"><button class="arena-button primary" :disabled="locked" @click="act({ type: 'approve' })">Approve opponent</button><button class="arena-button" :disabled="locked" @click="act({ type: 'reject' })">Reject</button></div></template>
        <template v-if="data.status === 'ready'"><div class="arena-ready-row"><span>{{ aliases[0] }} · {{ data.host_ready ? 'Ready' : 'Preparing' }}</span><span>{{ aliases[1] }} · {{ data.guest_ready ? 'Ready' : 'Preparing' }}</span></div><div class="arena-actions"><button class="arena-button primary" :disabled="locked" @click="act({ type: (seat === 0 ? data.host_ready : data.guest_ready) ? 'unready' : 'ready' })">{{ (seat === 0 ? data.host_ready : data.guest_ready) ? 'Not ready' : 'Ready to play' }}</button><button v-if="seat === 0" class="arena-button" :disabled="locked || !data.host_ready || !data.guest_ready" @click="act({ type: 'start' })">Shuffle and start</button></div></template>
        <button v-if="!finished" class="arena-link danger" :disabled="locked" @click="act({ type: seat === 0 ? 'cancel' : 'leave' })">{{ seat === 0 ? 'Cancel lobby' : 'Leave lobby' }}</button><p v-else>This lobby is closed.</p>
      </section>
      <template v-if="table">
        <div v-if="data.mode === 'tutorial' && !finished" class="arena-tutorial-wrap"><ArenaCoach :progress="table.progress" :phase="table.phase" @focus="focusZone = $event"/><p class="arena-muted">Training uses original demonstration cards and a disclosed scripted opening. It does not add cards to your collection.</p></div>
        <section v-if="finished" class="arena-result"><span class="arena-result-medal" aria-hidden="true">{{ table.result === seat ? 'V' : 'CS' }}</span><div><span class="arena-kicker">MATCH COMPLETE</span><h2>{{ arenaMoneylessResult(table.result, seat) }}</h2><p>{{ table.result_reason }}</p><NuxtLink to="/arena" class="arena-button primary">Play again</NuxtLink></div></section>
        <div class="arena-turn-bar" data-zone="turn"><div><span class="arena-kicker">{{ table.phase === 'setup' ? 'OPENING SETUP' : 'TURN ' + table.turn_number }}</span><strong>{{ table.phase === 'setup' ? aliases[table.toss] + ' won the toss' : pendingForOther ? 'Opponent is choosing…' : table.prompt ? 'Your decision is needed' : table.turn === seat ? 'Your move' : aliases[table.turn] + ' is playing' }}</strong></div><div class="arena-actions"><button v-for="move in globalMoves" :key="JSON.stringify(move.action)" class="arena-button" :class="move.action.type === 'ready' ? 'primary' : ''" :disabled="locked" @click="act(move.action)">{{ move.label }}</button><label v-if="data.mode !== 'pvp' && !finished" class="arena-auto"><input v-model="autoplay" type="checkbox" :disabled="busy || !!pending || !connected">Auto play my turns</label><button v-if="!finished" class="arena-link danger" :disabled="locked" @click="concede">Concede</button></div></div>
        <div class="arena-play-layout"><div class="arena-board-wrap"><ArenaBoard :table="table" :aliases="aliases" :selected="selected" :hit="flash?.target" :focus-zone="focusZone" @select="select" @discard="discardSeat = $event"/><Transition name="arena-flash"><div v-if="flash" :key="flash.n" class="arena-event-flash" aria-live="polite"><strong>{{ flash.kind === 'attack' ? flash.attack : flash.kind === 'knockout' ? 'KNOCK OUT' : flash.kind === 'coin' ? (flash.heads ? 'HEADS' : 'TAILS') : 'MATCH COMPLETE' }}</strong><span>{{ flash.kind === 'attack' ? flash.damage + ' DAMAGE' : flash.text }}</span></div></Transition></div>
          <aside class="arena-inspector" aria-label="Selected card and legal actions"><ArenaDecision v-if="table.prompt" :prompt="table.prompt" :locked="locked" @choose="act({ type: 'choose', choices: $event })"/>
            <section v-if="discardSeat !== null" class="arena-panel"><div class="arena-zone-caption"><h2>{{ aliases[discardSeat] }} · Discard</h2><button class="arena-link" @click="discardSeat = null">Close</button></div><div class="arena-discard-grid"><ArenaCard v-for="unit in table.players[discardSeat].discard" :key="unit.id" :unit="unit" @select="select"/></div><p v-if="!table.players[discardSeat].discard.length">No discarded cards.</p></section>
            <section v-else-if="current" class="arena-panel arena-card-inspector"><span class="arena-kicker">SELECTED CARD</span><h2>{{ current.card.name }}</h2><ArenaCard :unit="current" disabled/><p class="arena-muted">{{ current.card.set_name }} · {{ current.card.number }}</p><p>{{ current.card.program?.text }}</p><div v-for="(attack, index) in current.card.attacks || []" :key="index" class="arena-attack-info"><div><strong>{{ attack.name }}</strong><b>{{ attack.printed || attack.damage }}</b></div><small>{{ attack.cost.length ? attack.cost.map(energySymbol).join(' · ') : 'No Energy cost' }}</small><p v-if="attack.text">{{ attack.text }}</p><p v-if="own?.active?.id === current.id && table.attack_blocks[index]?.reason" class="arena-muted">{{ table.attack_blocks[index].reason }}</p></div><div class="arena-legal-moves"><button v-for="move in moves" :key="JSON.stringify(move.action)" class="arena-button" :class="move.action.type === 'attack' ? 'attack' : 'primary'" :disabled="locked" @click="act(move.action)">{{ move.label }}</button></div><p v-if="!moves.length && !finished" class="arena-muted">{{ table.prompt ? 'Complete the decision above first.' : table.turn !== seat && table.phase !== 'setup' ? 'Wait for your turn.' : 'This card has no available move right now.' }}</p></section>
            <section v-else class="arena-panel arena-inspector-empty"><span class="arena-empty-reticle" aria-hidden="true">+</span><h2>Select a card</h2><p>Your legal moves appear here. Choose your Active Pokémon to see its attacks, or a hand card to play it.</p><p v-if="table.phase === 'setup'">Place a Basic Active and optional Bench Pokémon, then confirm Ready. The toss winner also chooses who goes first.</p></section>
          </aside></div>
        <section v-if="showLog" class="arena-panel arena-history"><h2>Match history</h2><ol><li v-for="event in table.events" :key="event.n"><small>{{ event.seat === null ? 'TABLE' : aliases[event.seat] }}</small><span>{{ event.text }}</span><details v-if="event.revealed?.length"><summary>Revealed cards</summary><span v-for="(card, i) in event.revealed" :key="i">{{ card.name }} · </span></details></li></ol></section>
      </template>
    </template>
  </ArenaShell>
</template>

<style scoped>
.arena-table-tools{position:relative;max-width:100%}.arena-table-tools>summary{cursor:pointer;list-style:none;min-height:44px;display:flex;align-items:center}.arena-table-tools>summary::-webkit-details-marker{display:none}.arena-tools-panel{position:absolute;right:0;top:calc(100% + 8px);z-index:25;width:min(360px,calc(100vw - 32px));max-height:65dvh;overflow-y:auto;overscroll-behavior:contain;padding:18px;border-radius:16px;border:1px solid #475960;background:#172b36;color:#eff8f6;box-shadow:0 16px 50px #0008}.arena-tools-panel .arena-toolbar{display:flex;flex-wrap:wrap;gap:8px}.arena-tools-panel .arena-toolbar button{min-height:44px}
@media(max-width:650px){.arena-tools-panel{position:relative;right:auto;top:8px;width:100%;max-height:65dvh}.arena-table-tools[open]{width:100%}.arena-table-top:has(.arena-table-tools[open]){flex-wrap:wrap}}
</style>
