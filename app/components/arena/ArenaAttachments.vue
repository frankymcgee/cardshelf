<script setup lang="ts">
import ArenaCard from './ArenaCard.vue'
const props = defineProps<{ unit: any; selected?: string }>()
const emit = defineEmits<{ select: [unit: any] }>()
const groups = computed(() => [
  { name: 'Attached Tools', cards: props.unit?.tools || [] },
  { name: 'Attached Energy', cards: props.unit?.energy || [] },
  { name: 'Evolution stack', cards: props.unit?.under || [] },
  { name: 'Multipart Pokémon pieces', cards: props.unit?.parts || [] }
].map(group => ({ ...group, cards: group.cards.filter((unit: any) => !unit.hidden && unit.card) })).filter(group => group.cards.length))
</script>
<template>
  <section v-if="groups.length" class="arena-attachments" aria-label="Attached cards"><div v-for="group in groups" :key="group.name"><h3>{{ group.name }} <small>{{ group.cards.length }}</small></h3><div class="arena-attachment-list"><div v-for="attached in group.cards" :key="attached.id" class="arena-attachment-item"><ArenaCard :unit="attached" :selected="selected === attached.id" :label="'Inspect ' + attached.card.name" @select="emit('select', $event)"/><button class="arena-link" @click="emit('select', attached)">{{ attached.card.name }}<small>Inspect card</small></button></div></div></div></section>
</template>
