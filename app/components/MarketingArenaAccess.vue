<script setup lang="ts">
withDefaults(defineProps<{ showPlans?: boolean }>(), { showPlans: true })
</script>
<template>
  <section class="m-arena-access" aria-label="Arena access">
    <div><span class="m-eyebrow">ARENA ACCESS</span><h2>A table for Collector members.</h2><p>Arena requires Collector or Collector Plus membership, or an explicit Complimentary account assignment, and must be enabled on CardShelf. Free accounts and general collecting invitations do not automatically include Arena.</p></div>
    <div class="m-actions"><NuxtLink to="/arena" class="m-button">Open Arena<AppIcon name="arrow" :size="17" /></NuxtLink><NuxtLink v-if="showPlans" to="/pricing" class="m-text-link">Explore plans & access</NuxtLink><NuxtLink v-else to="/pokemon-arena" class="m-text-link">See what’s in Arena</NuxtLink></div>
  </section>
</template>
