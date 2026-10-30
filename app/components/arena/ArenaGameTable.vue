<script setup lang="ts">
import ArenaCard from './ArenaCard.vue'
import ArenaCardFacts from './ArenaCardFacts.vue'
import { arenaGame } from '../../../shared/arena-games.mjs'
const props = defineProps<{ table: any; aliases: string[]; locked: boolean }>()
const emit = defineEmits<{ action: [action: any] }>()
const selected = ref(''), choice = ref('')
const config = computed(() => arenaGame(props.table.game))
const own = computed(() => props.table.players[props.table.seat])
const players = computed(() => [1 - props.table.seat, props.table.seat])
const visible = computed(() => props.table.players.flatMap((p: any, seat: number) => [...(seat === props.table.seat ? p.hand : []), ...p.field, ...p.discard]).filter((u: any) => !u.hidden))
const current = computed(() => visible.value.find((u: any) => u.id === selected.value))
const moves = computed(() => props.table.legal.filter((m: any) => m.card === selected.value || !m.card))
const key = (action: any) => JSON.stringify(action)
const step = computed(() => (props.table.step || '').replaceAll('_', ' '))
watch(() => props.table, () => { if (!current.value) selected.value = ''; choice.value = '' })
function act(action: any) { if (!props.locked && props.table.legal.some((m: any) => key(m.action) === key(action))) emit('action', action) }
function chooseMove() { const move = moves.value.find((m: any) => key(m.action) === choice.value); if (move) act(move.action) }
</script>
<template>
  <section class="game-table" :aria-label="config?.name + ' table'">
    <header class="game-table-heading"><div><span class="arena-kicker">{{ config?.name }}</span><h2>{{ config?.format }}</h2><p>Turn {{ table.turn_number }} · {{ step }}<template v-if="table.waiting_for !== null"> · {{ aliases[table.waiting_for] }} to act</template></p></div><details><summary>Supported rules</summary><p>{{ config?.coverage }}</p><p>{{ config?.rules }}</p></details></header>
    <div v-if="table.phase === 'setup'" class="arena-alert">{{ table.first === null ? 'The toss winner chooses who starts.' : 'Keep your opening hand or take a mulligan. After keeping, put one card on the bottom for each mulligan.' }}<span v-if="own.bottom"> Choose {{ own.bottom }} more card(s) to put on the bottom.</span></div>
    <div v-if="table.payment" class="arena-alert" role="status">Pay {{ table.payment.remaining }} remaining generic mana for {{ table.payment.unit.card.name }}. Choose a mana colour below.</div>
    <section v-if="table.stack.length" class="game-stack" aria-label="Spell stack"><h3>Stack · last spell resolves first</h3><p v-for="(entry, index) in [...table.stack].reverse()" :key="entry.unit.id">{{ index === 0 ? 'Next: ' : '' }}{{ entry.unit.card.name }} · {{ aliases[entry.seat] }}</p></section>
    <div class="game-table-layout"><div class="game-fields">
      <section v-for="index in players" :key="index" class="game-player" :class="{ 'game-player-own': index === table.seat }" :aria-label="aliases[index] + ' field'">
        <header><div><strong>{{ aliases[index] }}</strong><span>{{ table.players[index].hand_count }} in hand · {{ table.players[index].deck_count }} in {{ table.game === 'mtg' ? 'library' : 'deck' }}</span></div><b class="game-life">{{ table.players[index].life }} <small>{{ table.game === 'mtg' ? 'life' : 'LP' }}</small></b></header>
        <p v-if="table.game === 'mtg'" class="game-mana">Mana pool: <span v-for="(amount, color) in table.players[index].mana" :key="color">{{ color }} {{ amount }} </span></p>
        <div class="game-field-cards"><article v-for="unit in table.players[index].field" :key="unit.id" class="game-unit" :class="{ tapped: unit.tapped, chosen: table.combat?.attackers?.includes(unit.id) || table.combat?.blocks?.[unit.id] }"><ArenaCard :unit="unit" :selected="selected === unit.id" @select="selected = unit.id"/><small>{{ unit.face_down || unit.hidden ? 'Face down · ' : '' }}{{ unit.position || (unit.tapped ? 'Tapped' : 'Ready') }}<template v-if="table.combat?.attackers?.includes(unit.id)"> · Attacking</template><template v-if="table.combat?.blocks?.[unit.id]"> · Blocking</template></small></article><p v-if="!table.players[index].field.length" class="arena-muted">{{ table.game === 'mtg' ? 'Battlefield' : 'Monster and Spell zones' }} · no cards in play</p></div>
        <details class="game-graveyard"><summary>{{ table.game === 'mtg' ? 'Graveyard' : 'GY' }} · {{ table.players[index].discard.length }}</summary><div class="game-field-cards"><ArenaCard v-for="unit in table.players[index].discard" :key="unit.id" :unit="unit" @select="selected = unit.id" /></div></details>
      </section>
      <section v-if="!table.spectator" class="game-hand" aria-label="Your hand"><h3>Your hand · {{ own.hand.length }}</h3><div class="game-hand-cards"><ArenaCard v-for="unit in own.hand" :key="unit.id" :unit="unit" :selected="selected === unit.id" @select="selected = unit.id"/></div></section>
    </div><aside v-if="!table.spectator" class="arena-panel game-controls" aria-label="Game controls">
      <h3>{{ current?.card.name || 'Your next move' }}</h3><ArenaCardFacts v-if="current" :unit="current"/><p v-else class="arena-muted">Select a card to inspect it and see its available moves.</p>
      <div v-if="moves.length <= 12" class="game-actions"><button v-for="move in moves" :key="key(move.action)" class="arena-button" :disabled="locked" @click="act(move.action)">{{ move.label }}</button></div>
      <div v-else><label>Available move<select v-model="choice" :disabled="locked"><option value="">Choose a move and its targets</option><option v-for="move in moves" :key="key(move.action)" :value="key(move.action)">{{ move.label }}</option></select></label><button class="arena-button primary" :disabled="locked || !choice" @click="chooseMove">Confirm move</button></div>
      <p v-if="!table.legal.length && table.phase !== 'finished'" class="arena-muted" role="status">Waiting for {{ aliases[1 - table.seat] }}.</p>
    </aside></div>
  </section>
</template>
<style scoped>
.game-table{border:1px solid #3e605e;background:linear-gradient(145deg,#153b37,#10212b);border-radius:22px;padding:clamp(12px,2vw,28px)}.game-table-heading,.game-player>header{display:flex;justify-content:space-between;gap:18px;flex-wrap:wrap}.game-table-heading h2{margin:6px 0}.game-table-heading details{max-width:420px}.game-table-heading summary,.game-graveyard summary{cursor:pointer;min-height:44px;padding:10px 0}.game-table-layout{display:grid;grid-template-columns:minmax(0,1fr) minmax(240px,320px);gap:22px}.game-fields{min-width:0}.game-player{border:1px solid #41635e;background:#0b191d66;border-radius:16px;padding:16px;margin:16px 0}.game-player-own{border-color:#81a278}.game-player header span{display:block;font-size:.8rem;margin-top:5px;color:#c0d4cf}.game-life{font-size:1.8rem;color:#e3f0b7}.game-life small{font-size:.8rem}.game-field-cards{display:flex;flex-wrap:wrap;gap:16px;margin-top:14px;min-height:90px}.game-field-cards .arena-card,.game-hand-cards .arena-card{width:108px;flex:0 0 108px}.game-unit{width:112px;display:flex;flex-direction:column;gap:8px}.game-unit small{font-size:.7rem;text-align:center}.game-unit.tapped .arena-card{transform:rotate(12deg);filter:brightness(.75)}.game-unit.chosen{outline:2px solid #e4c36b;border-radius:8px}.game-mana{font-size:.8rem;word-spacing:4px}.game-hand{margin-top:22px}.game-hand-cards{display:flex;overflow-x:auto;gap:12px;padding:12px 4px 20px;max-width:100%}.game-controls{align-self:start;position:sticky;top:12px;max-height:85dvh;overflow:auto;margin-top:16px}.game-actions{display:flex;flex-direction:column;gap:8px}.game-actions button{text-align:left;white-space:normal}.game-stack{border-left:3px solid #e4c36b;padding:8px 18px;background:#0b161a77}.game-stack h3{font-size:1rem}.game-table :deep(select){max-width:100%}
@media(max-width:850px){.game-table-layout{grid-template-columns:minmax(0,1fr)}.game-controls{position:static;max-height:none;order:-1}.game-field-cards .arena-card,.game-hand-cards .arena-card{width:88px;flex-basis:88px}.game-unit{width:92px}.game-player{padding:12px}.game-actions{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr))}}
</style>
