<script setup lang="ts">
defineProps<{ title?: string }>()
</script>
<template>
  <div class="arena-root">
    <header class="arena-header"><NuxtLink to="/arena" class="arena-brand"><span class="arena-brand-mark" aria-hidden="true">CS</span><span>CardShelf <b>ARENA</b><small>{{ title || 'POKÉMON · AUTOMATED CASUAL CORE' }}</small></span></NuxtLink><nav aria-label="Arena navigation"><NuxtLink to="/arena">Play</NuxtLink><NuxtLink to="/arena/decks/new">Deck builder</NuxtLink><NuxtLink to="/app">Collection ↗</NuxtLink></nav></header>
    <main class="arena-main"><slot /></main>
    <footer class="arena-footer">Server-checked play · Private hands · No collection transfers <span>Casual Core card pool · Not tournament certification</span></footer>
  </div>
</template>
<style src="~/assets/css/arena.css"></style>
