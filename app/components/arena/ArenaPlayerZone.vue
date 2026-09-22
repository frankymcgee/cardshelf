<script setup lang="ts">
import { computed } from 'vue'
import ArenaCardStack from './ArenaCardStack.vue'
import ArenaFieldZone from './ArenaFieldZone.vue'
import ArenaDiscardPile from './ArenaDiscardPile.vue'
const props = defineProps<{ player: any; alias: string; seat: number; self: boolean; turn: boolean; setup: boolean; turnNumber: number; selected?: string; hit?: string; targets?: string[]; over?: string }>()
const emit = defineEmits<{ select: [unit: any]; discard: [seat: number] }>()
// DOM order and visual order agree. Do not mutate/reverse the server's Bench array.
const zones = computed<('active' | 'bench')[]>(() => props.self ? ['active', 'bench'] : ['bench', 'active'])
</script>
<template>
  <section class="arena-field arena-table-side" :class="{ 'is-opponent': !self, 'is-your-turn': turn }" :data-side="self ? 'self' : 'opponent'" :aria-label="alias + ' play area'">
    <div class="arena-player-strip">
      <span class="arena-avatar" aria-hidden="true">{{ alias?.slice(0, 1).toUpperCase() }}</span>
      <strong>{{ alias }} <small>{{ self ? 'YOU' : 'OPPONENT' }}</small></strong>
      <Transition name="arena-count"><span :key="player.hand_count" class="arena-hand-count">{{ player.hand_count }} in hand</span></Transition>
      <span v-if="turn" class="arena-turn-chip">TURN {{ turnNumber }}</span>
      <span v-else-if="setup" class="arena-turn-chip">{{ player.ready ? 'READY' : 'PREPARING' }}</span>
    </div>
    <ArenaCardStack v-if="!self" kind="hand" :count="player.hand_count" :alias="alias" />
    <div class="arena-table-lanes">
      <div class="arena-table-battle-line">
        <ArenaFieldZone v-for="zone in zones" :key="zone" :zone="zone" :seat="seat" :targets="targets" :over="over" :alias="alias" :active="player.active" :bench="player.bench" :selected="selected" :hit="hit" @select="emit('select', $event)" />
      </div>
      <div class="arena-table-reserve" :aria-label="alias + ' deck and discard'">
        <ArenaCardStack kind="deck" :count="player.deck_count" :alias="alias" />
        <ArenaDiscardPile :count="player.discard_count" :alias="alias" @inspect="emit('discard', seat)" />
      </div>
      <ArenaCardStack kind="prizes" :count="player.prize_count" :alias="alias" :self="self" />
    </div>
  </section>
</template>
