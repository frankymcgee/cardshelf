<script setup lang="ts">
definePageMeta({ key: (to: { path: string }) => to.path })
import BattleSide from '../../../components/battle/BattleSide.vue'
import BattleCardText from '../../../components/battle/BattleCardText.vue'
import { BATTLE_CONDITIONS, BATTLE_DISCLAIMER, battleConflict } from '../../../../shared/battle.mjs'
const api = useApi(), route = useRoute(), data = ref<any>(null), error = ref(''), loadError = ref(''), busy = ref(false), connected = ref(false), lastContact = ref('')
const pending = ref<any>(null), invitation = ref(''), selectedToken = ref(''), selectedSeat = ref('')
const destination = ref('discard'), target = ref(''), damage = ref(0), conditions = ref<string[]>([]), drawCount = ref(1)
const table = computed(() => data.value?.table), seat = computed(() => data.value?.seat || 'host'), otherSeat = computed(() => seat.value === 'host' ? 'guest' : 'host')
const own = computed(() => table.value?.players?.[seat.value]), opponent = computed(() => table.value?.players?.[otherSeat.value])
const locked = computed(() => busy.value || !!pending.value || !connected.value || !data.value)
const finished = computed(() => ['finished', 'cancelled'].includes(data.value?.status))
const selected = computed(() => {
  const player = table.value?.players?.[selectedSeat.value]
  if (!player || !selectedToken.value) return null
  for (const zone of ['hand', 'active', 'bench', 'stadium', 'discard', 'lost', 'search']) for (const item of player[zone] || []) {
    if (item.token === selectedToken.value) return { item, zone, child: false }
    const child = item.attachments?.find((c: any) => c.token === selectedToken.value)
    if (child) return { item: child, zone, child: true }
  }
  return null
})
const fieldTargets = computed<any[]>(() => [...(own.value?.active || []), ...(own.value?.bench || [])].filter((c: any) => c.token !== selectedToken.value))
const isMine = computed(() => selectedSeat.value === seat.value)
const canCounters = computed(() => !!selected.value && !selected.value.child && ['active', 'bench'].includes(selected.value.zone) && table.value?.phase === 'playing')
const aliasFor = (who: string) => data.value?.[who + '_alias'] || who
let alive = true, reading = false, epoch = 0, timer: ReturnType<typeof setInterval> | undefined
function accept(result: any) {
  if (!alive || result.id !== String(route.params.id)) return
  if (!data.value || result.revision >= data.value.revision) data.value = result
  connected.value = true; lastContact.value = new Date().toLocaleTimeString()
  if (result.invite_code) invitation.value = result.invite_code
  if (result.status !== 'waiting') invitation.value = ''
}
async function load(force = false) {
  if (!alive || reading || (!force && (busy.value || document.hidden))) return
  const currentEpoch = epoch, id = String(route.params.id); reading = true
  try { const next = await api('/api/battle/matches/' + id); if (currentEpoch === epoch) { accept(next); loadError.value = '' } }
  catch (e: any) { if (alive && currentEpoch === epoch) { connected.value = false; loadError.value = errorMessage(e); if ([401, 403, 404].includes(e?.statusCode || e?.status)) { data.value = null; selectedToken.value = ''; invitation.value = ''; pending.value = null } } }
  finally { reading = false }
}
async function send() {
  if (busy.value || !pending.value) return
  const task = pending.value, currentEpoch = ++epoch; busy.value = true; error.value = ''
  try { const result = await api('/api/battle/matches/' + task.id + '/actions', { method: 'POST', body: task.body }); if (!alive || currentEpoch !== epoch) return
    pending.value = null
    if (result.left) { await navigateTo('/battle'); return }
    accept(result)
  } catch (e: any) {
    if (!alive || currentEpoch !== epoch) return
    error.value = errorMessage(e)
    if (battleConflict(e) || [400, 401, 403, 404].includes(e?.statusCode || e?.status)) { pending.value = null; connected.value = false; if ([401, 403, 404].includes(e?.statusCode || e?.status)) data.value = null; await load(true) }
    else { connected.value = false; error.value += ' The result is uncertain. Retry this same action; do not submit another copy.' }
  } finally { busy.value = false }
}
async function act(action: any) {
  if (locked.value || finished.value) return
  pending.value = { id: data.value.id, body: { revision: data.value.revision, request_id: crypto.randomUUID(), action } }; await send()
}
function select(item: any, _zone: string, owner: string) { selectedToken.value = item.token; selectedSeat.value = owner; target.value = '' }
function move() {
  if (!selected.value) return
  const a: any = { type: 'move', token: selectedToken.value, to: destination.value }
  if (destination.value === 'attach') a.target = target.value
  act(a)
}
function concede() { if (window.confirm('Concede this match? It will end immediately, without changing your collection.')) act({ type: 'concede' }) }
function cancelLobby() { if (window.confirm('Cancel this private lobby?')) act({ type: 'cancel' }) }
function leaveLobby() { if (window.confirm('Leave this lobby? The invitation will be invalidated.')) act({ type: 'leave' }) }
async function copyCode() { try { await navigator.clipboard.writeText(invitation.value) } catch { error.value = 'Select and copy the invitation code manually.' } }
const selectedCounterSignature = computed(() => selected.value ? JSON.stringify([selectedToken.value, selected.value.item.damage, selected.value.item.conditions]) : '')
watch(selectedCounterSignature, () => { damage.value = selected.value?.item.damage || 0; conditions.value = [...(selected.value?.item.conditions || [])] })
function focus() { if (!document.hidden) load(true) }
onMounted(() => { load(true); timer = setInterval(() => load(), 2000); window.addEventListener('focus', focus); document.addEventListener('visibilitychange', focus) })
onBeforeUnmount(() => { alive = false; epoch++; if (timer) clearInterval(timer); window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', focus); data.value = null; pending.value = null; invitation.value = '' })
useSeoMeta({ title: 'Private battle table · CardShelf', robots: 'noindex, nofollow' })
</script>
<template><div class="battle-ui">
<header class="battle-top"><div><NuxtLink to="/battle" class="text-button">Back to Battle</NuxtLink><h1>{{ data ? data.host_alias + ' vs ' + (data.guest_alias || '…') : 'Private battle table' }}</h1><p class="battle-connected">{{ connected ? 'Synced ' + lastContact : 'Waiting for a server update' }} · refreshes every 2 seconds while visible</p></div><button class="button secondary" :disabled="busy" @click="load(true)">Refresh table</button></header>
<p v-if="error" class="alert error" role="alert">{{ error }}</p><p v-if="loadError" class="alert error" role="alert">{{ loadError }}</p><div v-if="pending && !busy" class="battle-disconnected"><p>The last action has not been confirmed. Its request ID is retained so a retry cannot apply it twice.</p><button class="button primary" @click="send">Retry the same action</button></div>
<p v-if="!data && !error" class="loading-panel">Opening your private table…</p>
<template v-if="data"><p class="battle-intro">{{ BATTLE_DISCLAIMER }} This table has no wager, prizes of monetary value, ranking or collection-transfer feature.</p>
<section v-if="!table" class="panel battle-card-panel"><span class="battle-label">{{ data.status }}</span><h2>Private lobby</h2><p>Your saved deck: <strong>{{ data.own_deck?.title }}</strong>. Only your deck checks are shown; your opponent's list stays private.</p><div class="battle-validation"><p v-for="warning in data.own_deck?.validation?.warnings || []" :key="warning">{{ warning }}</p></div>
<template v-if="data.status === 'waiting' && seat === 'host'"><p>Share an invitation code with an approved tester. You will see their alias and can approve or reject them before starting.</p><div v-if="invitation" class="battle-code">{{ invitation }}</div><div class="battle-actions"><button class="button primary" :disabled="locked" @click="act({ type: 'invite' })">{{ invitation ? 'Replace invitation code' : 'Generate invitation code' }}</button><button v-if="invitation" class="button secondary" @click="copyCode">Copy invitation</button></div><p class="small muted">Generating a new code immediately invalidates the old one. Codes are not stored in browser history or displayed again after reloading.</p></template>
<div v-if="data.status === 'approval'" class="battle-actions"><template v-if="seat === 'host'"><p><strong>{{ data.guest_alias }}</strong> is asking to join.</p><button class="button primary" :disabled="locked" @click="act({ type: 'approve' })">Approve opponent</button><button class="button secondary" :disabled="locked" @click="act({ type: 'reject' })">Reject</button></template><p v-else>Waiting for the host to approve your seat.</p></div>
<template v-if="data.status === 'lobby'"><p>{{ data.host_alias }}: {{ data.host_ready ? 'Ready' : 'Not ready' }} · {{ data.guest_alias }}: {{ data.guest_ready ? 'Ready' : 'Not ready' }}</p><div class="battle-actions"><button class="button primary" :disabled="locked" @click="act({ type: data[seat + '_ready'] ? 'unready' : 'ready' })">{{ data[seat + '_ready'] ? 'Not ready' : 'I reviewed my deck — ready' }}</button><button v-if="seat === 'host'" class="button secondary" :disabled="locked || !data.host_ready || !data.guest_ready" @click="act({ type: 'start' })">Shuffle and start</button></div></template>
<div v-if="!finished" class="battle-actions"><button v-if="seat === 'host'" class="text-button" :disabled="locked" @click="cancelLobby">Cancel lobby</button><button v-else class="text-button" :disabled="locked" @click="leaveLobby">Leave lobby</button></div></section>
<template v-if="table"><section v-if="finished" class="battle-results"><span class="battle-label">MATCH FINISHED</span><h2>{{ table.result === 'draw' ? 'Agreed draw' : aliasFor(table.result) + ' wins' }}</h2><p>The result was player-reported, not automatically verified. Hidden cards remain private.</p><NuxtLink to="/battle" class="button primary">Create a rematch</NuxtLink></section>
<section v-if="table.phase === 'setup'" class="panel battle-card-panel spaced"><h2>Opening setup</h2><p>{{ aliasFor(table.coin_winner) }} won the starting toss. Place a Basic Active Pokémon and optional Basic bench cards from your hand, then lock your opening field. Opponents see those cards face down until both players finish.</p><div v-if="!table.first_chosen && table.coin_winner === seat" class="battle-actions"><button class="button primary" :disabled="locked" @click="act({ type: 'choose_first', first: seat })">Go first</button><button class="button secondary" :disabled="locked" @click="act({ type: 'choose_first', first: otherSeat })">Go second</button></div><div class="battle-actions"><button class="button secondary" :disabled="locked || own.setup_ready" @click="act({ type: 'mulligan' })">No Basic in hand — mulligan</button><button class="button secondary" :disabled="locked || own.setup_ready" @click="act({ type: 'reset_setup' })">Reset unconfirmed opening field</button><button class="button primary" :disabled="locked || own.setup_ready || !own.active.length || !table.first_chosen" @click="act({ type: 'setup_ready' })">{{ own.setup_ready ? 'Opening field locked' : 'Finish setup' }}</button></div><p class="small muted">Mulligans reveal your original no-Basic hand in the log. Six hidden Prize cards are dealt after both fields are locked. Any excess mulligan bonus can then be drawn explicitly.</p></section>
<section v-if="table.phase === 'playing'" class="panel battle-card-panel spaced"><div class="section-heading"><h2>Turn {{ table.turn_number }} · {{ aliasFor(table.turn) }}</h2><span class="badge">Player-resolved effects</span></div><div class="battle-actions"><label>Cards to draw<input v-model.number="drawCount" type="number" min="1" max="10" :disabled="locked" style="max-width:95px"></label><button class="button primary" :disabled="locked || own.searching" @click="act({ type: 'draw', count: drawCount })">Draw</button><button v-if="own.bonus_remaining" class="button secondary" :disabled="locked || own.searching" @click="act({ type: 'bonus', count: Math.min(own.bonus_remaining, 10) })">Draw mulligan bonus ({{ own.bonus_remaining }})</button><button class="button secondary" :disabled="locked" @click="act({ type: own.searching ? 'end_search' : 'search' })">{{ own.searching ? 'Finish search & shuffle' : 'Search your deck' }}</button><button class="button secondary" :disabled="locked" @click="act({ type: 'shuffle' })">Shuffle deck</button><button class="button secondary" :disabled="locked" @click="act({ type: 'coin' })">Flip coin</button><button class="button secondary" :disabled="locked" @click="act({ type: 'die' })">Roll die</button><button class="button primary" :disabled="locked || table.turn !== seat || own.searching || opponent.searching" @click="act({ type: 'end_turn' })">End turn</button></div><p class="small muted">The turn marker is advisory for card movement and effects. Draw, Energy attachments, attacks, Knock Outs, Prize awards and between-turn checks are manual. Deck searches are publicly logged and finish with a server shuffle.</p><div class="battle-prizes"><button v-for="n in own.prize_count" :key="n" :disabled="locked" @click="act({ type: 'take_prize', index: n - 1 })">Take Prize {{ n }}</button></div></section>
<div class="battle-table-layout spaced"><div><BattleSide :player="opponent" :alias="aliasFor(otherSeat)" :seat="otherSeat" :self="false" :active-turn="table.phase === 'playing' && table.turn === otherSeat" :selected-token="selectedToken" @select="select"/><BattleSide :player="own" :alias="aliasFor(seat)" :seat="seat" :self="true" :active-turn="table.phase === 'playing' && table.turn === seat" :selected-token="selectedToken" @select="select"/></div>
<aside class="panel battle-inspector" aria-label="Selected card controls"><p v-if="!selected" class="muted small">Select a card to read its text, move your card or adjust public damage and conditions. Attachments travel with their field stack.</p><template v-if="selected"><span class="battle-label">{{ isMine ? 'Your card' : 'Opponent card' }} · {{ selected.zone }}</span><BattleCardText :card="selected.item.card"/>
<template v-if="!finished && isMine"><div v-if="table.phase === 'setup' && selected.zone === 'hand'" class="battle-actions"><button class="button primary" :disabled="locked || own.setup_ready" @click="act({ type: 'move', token: selectedToken, to: 'active' })">Place Active</button><button class="button secondary" :disabled="locked || own.setup_ready" @click="act({ type: 'move', token: selectedToken, to: 'bench' })">Place on bench</button></div><div v-if="table.phase === 'playing'"><label>Move to<select v-model="destination" :disabled="locked"><option value="hand">Hand</option><option value="active">Active spot</option><option value="bench">Bench</option><option value="stadium">Stadium / resolving</option><option value="attach">Attach to a Pokémon</option><option value="discard">Discard pile</option><option value="lost">Lost Zone</option><option value="deck">Top of deck</option></select></label><label v-if="destination === 'attach' || selected.zone === 'hand'">Attachment / evolution target<select v-model="target" :disabled="locked"><option value="">Choose your field Pokémon</option><option v-for="c in fieldTargets" :key="c.token" :value="c.token">{{ c.card.name }}</option></select></label><div class="battle-actions"><button class="button primary" :disabled="locked || (destination === 'attach' && !target)" @click="move">Move card</button><button v-if="selected.zone === 'hand' && selected.item.card.category === 'Pokemon'" class="button secondary" :disabled="locked || !target" @click="act({ type: 'evolve', token: selectedToken, target })">Evolve / overlay</button><button v-if="selected.zone === 'bench' && !selected.child" class="button secondary" :disabled="locked || !own.active.length" @click="act({ type: 'swap', token: selectedToken })">Switch with Active</button><button v-if="['hand', 'search'].includes(selected.zone)" class="button secondary" :disabled="locked" @click="act({ type: 'reveal', token: selectedToken })">Reveal to opponent</button></div><p class="battle-read-only">Moving a field stack to hand, deck, discard or Lost Zone moves every attached card too. Select an attachment to move only that card. Moving to deck puts cards on top; shuffle separately when required.</p></div></template>
<form v-if="canCounters && !finished" @submit.prevent="act({ type: 'counters', token: selectedToken, target_seat: selectedSeat, damage, conditions })"><label>Damage (multiples of 10)<input v-model.number="damage" type="number" min="0" max="9990" step="10" :disabled="locked"></label><label v-for="condition in BATTLE_CONDITIONS" :key="condition" class="battle-check"><input v-model="conditions" type="checkbox" :value="condition" :disabled="locked">{{ condition }}</label><button class="button secondary" :disabled="locked">Update public counters</button><p class="battle-read-only">Either player can update public damage/conditions; every change is logged. This does not resolve attacks automatically.</p></form></template></aside></div>
<section class="panel battle-card-panel"><h2>Shared action log</h2><ol class="battle-log" aria-label="Battle actions"><li v-for="entry in table.log" :key="entry.n"><strong>{{ aliasFor(entry.seat) }}:</strong> {{ entry.text }}<details v-if="entry.cards?.length"><summary>Deliberately revealed cards</summary><p v-for="(card, i) in entry.cards" :key="i">{{ card.name }} · {{ card.set_name }} #{{ card.number }}</p></details></li></ol></section>
<section v-if="!finished" class="panel battle-card-panel spaced"><h2>End the match</h2><div v-if="table.result_offer" class="battle-intro">{{ aliasFor(table.result_offer.by) }} proposes {{ table.result_offer.result === 'draw' ? 'a draw' : aliasFor(table.result_offer.result) + ' wins' }}.<div class="battle-actions"><button v-if="table.result_offer.by !== seat" class="button primary" :disabled="locked" @click="act({ type: 'accept_result' })">Accept result</button><button class="button secondary" :disabled="locked" @click="act({ type: 'decline_result' })">Dismiss proposal</button></div></div><div class="battle-actions"><button v-if="table.phase === 'playing'" class="button secondary" :disabled="locked" @click="act({ type: 'offer_result', result: seat })">Propose that I won</button><button v-if="table.phase === 'playing'" class="button secondary" :disabled="locked" @click="act({ type: 'offer_result', result: 'draw' })">Offer draw</button><button class="text-button" :disabled="locked" @click="concede">Concede immediately</button></div></section>
</template></template></div></template>
<style src="~/assets/css/battle.css"></style>
