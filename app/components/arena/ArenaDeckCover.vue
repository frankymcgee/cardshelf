<script setup lang="ts">
import { trainingDeck } from '../../../lib/arena/training.mjs'
import ArenaCard from './ArenaCard.vue'
defineProps<{ cards?: any[]; training?: boolean }>()
const teaching = [trainingDeck('ember')[1]!.card, trainingDeck('ember')[0]!.card, trainingDeck('tide')[0]!.card]
</script>
<template>
  <div class="aw-deck-cover" aria-hidden="true">
    <ArenaCard v-for="(card, i) in (training ? teaching : cards?.length ? cards : [null, null, null])" :key="card?.id || i" :card="card || undefined" :back="!card" disabled />
  </div>
</template>
