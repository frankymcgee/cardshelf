<script setup lang="ts">
import ArenaCard from './ArenaCard.vue'
defineProps<{ zone: 'active' | 'bench'; alias: string; active?: any; bench: any[]; selected?: string; hit?: string }>()
const emit = defineEmits<{ select: [unit: any] }>()
</script>
<template>
  <section class="arena-table-card-zone" :class="'arena-table-' + zone" :data-field-zone="zone" :aria-label="alias + (zone === 'active' ? ' Active Pokémon' : ' Bench')">
    <span class="arena-table-zone-label">{{ zone === 'active' ? 'Active Pokémon' : 'Bench' }}</span>
    <div v-if="zone === 'bench'" class="arena-bench-row">
      <div v-for="i in 5" :key="i" class="arena-bench-spot">
        <ArenaCard v-if="bench[i - 1]" :unit="bench[i - 1]" :selected="selected === bench[i - 1].id" :hit="hit === bench[i - 1].id" @select="emit('select', $event)" />
        <span v-else class="arena-empty-slot">BENCH {{ i }}</span>
      </div>
    </div>
    <div v-else class="arena-active-spot" data-zone="active">
      <ArenaCard v-if="active" :unit="active" :selected="selected === active.id" :hit="hit === active.id" @select="emit('select', $event)" />
      <span v-else class="arena-empty-slot">ACTIVE POKÉMON</span>
    </div>
  </section>
</template>
