<script setup lang="ts">
const props = defineProps<{ kind: 'deck' | 'hand' | 'prizes'; count: number; alias: string; self?: boolean }>()
// This component accepts public counts only, never the contents of a hidden zone.
const visibleBacks = (count: number, limit: number) => Number.isSafeInteger(count) ? Math.min(limit, Math.max(0, count)) : 0
</script>
<template>
  <div v-if="kind === 'hand'" class="arena-opponent-hand" role="img" :aria-label="alias + ' hand: ' + count + ' face-down cards'">
    <span v-for="i in visibleBacks(count, 12)" :key="i" class="arena-opponent-back" aria-hidden="true">CS</span>
    <span v-if="count > 12" class="arena-opponent-extra" aria-hidden="true">+{{ count - 12 }}</span>
    <span v-if="!count" class="arena-table-empty-note" aria-hidden="true">No cards in hand</span>
  </div>
  <div v-else-if="kind === 'deck'" class="arena-deck-stack" :class="{ 'is-empty': !count }" role="img" :aria-label="alias + ' deck: ' + count + ' face-down cards'">
    <span class="arena-stack-mark" aria-hidden="true">CS</span><b aria-hidden="true">{{ count }}</b><small aria-hidden="true">DECK</small>
  </div>
  <section v-else class="arena-prize-area arena-table-prizes" data-zone="prizes" :aria-label="alias + ' Prize cards: ' + count + ' remaining'">
    <strong>{{ count }} <small>PRIZES</small></strong>
    <div class="arena-prize-pips" aria-hidden="true"><i v-for="i in visibleBacks(count, 6)" :key="i" /></div>
    <small>{{ !count ? 'No Prize cards' : self ? 'Choose when prompted' : 'Face down' }}</small>
  </section>
</template>
