<script setup lang="ts">
import ArenaCard from './ArenaCard.vue'
import ArenaCardFacts from './ArenaCardFacts.vue'
import ArenaAttachments from './ArenaAttachments.vue'
import { energySymbol } from '../../../shared/arena.mjs'
defineProps<{ unit: any; parent?: any; selected?: string; attackBlocks?: any[] }>()
const emit = defineEmits<{ select: [unit: any] }>()
</script>
<template>
  <section v-if="unit && !unit.hidden && unit.card" class="arena-card-inspector arena-card-preview" aria-label="Card details">
    <h2>{{ unit.card.name }}</h2><ArenaCard :unit="unit" disabled />
    <p v-if="unit.card.set_name || unit.card.number" class="arena-muted">{{ [unit.card.set_name, unit.card.number].filter(Boolean).join(' · ') }}</p>
    <ArenaCardFacts :unit="unit" />
    <button v-if="parent && !parent.hidden" type="button" class="arena-link arena-parent-link" @click="emit('select', parent)">← Back to {{ parent.card.name }}</button>
    <div v-for="(attack, index) in unit.card.attacks || []" :key="index" class="arena-attack-info">
      <div><strong>{{ attack.name }}</strong><b>{{ attack.printed || attack.damage }}</b></div>
      <small>{{ attack.cost?.length ? attack.cost.map(energySymbol).join(' · ') : 'No Energy cost' }}</small>
      <p v-if="attack.text">{{ attack.text }}</p><p v-if="attackBlocks?.[index]?.reason" class="arena-muted">{{ attackBlocks[index].reason }}</p>
    </div>
    <ArenaAttachments :unit="unit" :selected="selected" @select="emit('select', $event)" />
  </section>
</template>
