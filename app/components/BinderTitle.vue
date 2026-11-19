<script setup lang="ts">
const props = defineProps<{ binder: { title: string; title_logo_url?: string | null }; compact?: boolean }>()
const brokenLogo = ref<string | null>(null)
const logo = computed(() => props.binder.title_logo_url)
const volume = computed(() => props.binder.title.match(/ · (\d+\/\d+)$/)?.[1])
</script>

<template>
  <span class="binder-title" :class="{ compact }">
    <template v-if="logo && logo !== brokenLogo">
      <img :src="logo" :alt="binder.title" @error="brokenLogo = logo" />
      <small v-if="volume" aria-hidden="true">{{ volume }}</small>
    </template>
    <template v-else>{{ binder.title }}</template>
  </span>
</template>

<style scoped>
.binder-title { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 4px; max-width: 100%; }
.binder-title img { display: block; width: auto; max-width: min(100%, 220px); max-height: 64px; object-fit: contain; }
.binder-title.compact img { max-height: 40px; }
.binder-title small { font-size: .65em; }
</style>
