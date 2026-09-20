<script setup lang="ts">
import BattleCard from './BattleCard.vue'
const props = defineProps<{ player: any; alias: string; seat: string; self: boolean; activeTurn: boolean; selectedToken?: string }>()
const emit = defineEmits<{ select: [item: any, zone: string, seat: string] }>()
const openZones = [{ code: 'active', label: 'Active Pokémon' }, { code: 'bench', label: 'Bench' }]
const pileZones = [{ code: 'stadium', label: 'Stadium / resolving' }, { code: 'discard', label: 'Discard pile' }, { code: 'lost', label: 'Lost Zone' }]
</script>
<template>
  <section class="battle-side" :class="{ 'is-turn': activeTurn }" :aria-label="alias + (self ? ' — your board' : ' — opponent board')">
    <div class="battle-side-heading"><strong>{{ alias }} <small class="muted">{{ self ? 'You' : 'Opponent' }}</small></strong><div class="battle-piles"><span>Deck {{ player.deck_count }}</span><span>Hand {{ player.hand_count }}</span><span>Prizes {{ player.prize_count }}</span><span v-if="player.searching">Searching deck</span></div></div>
    <div class="battle-field"><div v-for="zone in openZones" :key="zone.code" :class="zone.code === 'active' ? 'battle-active-zone' : 'battle-bench-zone'"><span class="battle-label">{{ zone.label }}</span><div class="battle-card-strip"><BattleCard v-for="(item, i) in player[zone.code]" :key="item.token || i" :item="item" :selected="item.token === selectedToken" @select="emit('select', $event, zone.code, props.seat)"/><p v-if="!player[zone.code].length" class="muted small">Empty</p></div></div></div>
    <details v-for="zone in pileZones" :key="zone.code" class="spaced" :open="zone.code === 'stadium' && player.stadium.length > 0"><summary>{{ zone.label }} · {{ player[zone.code].length }}</summary><div class="battle-card-strip spaced"><BattleCard v-for="item in player[zone.code]" :key="item.token" :item="item" :selected="item.token === selectedToken" @select="emit('select', $event, zone.code, props.seat)"/></div></details>
    <div class="battle-hand"><span class="battle-label">{{ self ? 'Your private hand' : 'Opponent hand — identities hidden' }}</span><div v-if="self" class="battle-card-strip"><BattleCard v-for="item in player.hand" :key="item.token" :item="item" :selected="item.token === selectedToken" @select="emit('select', $event, 'hand', props.seat)"/></div><p v-else class="small muted">{{ player.hand_count }} face-down cards. No card identities are sent to your browser.</p></div>
    <section v-if="self && player.searching" class="battle-hand"><span class="battle-label">Private deck search · sorted by name, not draw order</span><div class="battle-card-strip"><BattleCard v-for="item in player.search" :key="item.token" :item="item" :selected="item.token === selectedToken" @select="emit('select', $event, 'search', props.seat)"/></div></section>
  </section>
</template>
