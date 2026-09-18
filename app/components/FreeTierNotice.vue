<script setup lang="ts">
const api = useApi(), auth = useAuth(), route = useRoute()
const isFree = ref(false)
let sequence = 0, alive = true
async function load() {
  const request = ++sequence; isFree.value = false
  if (!auth.state.value.user) return
  try { const data = await api('/api/account/games'); if (alive && request === sequence) isFree.value = data.tier === 'free' }
  catch { /* Unknown entitlement never becomes an advertising decision. */ }
}
onMounted(load)
watch(() => [route.path, auth.state.value.user?.id], load)
onBeforeUnmount(() => { alive = false; sequence++ })
</script>
<template><aside v-if="isFree" class="alert info free-tier-notice"><strong>Free membership</strong><span>Browse every supported card game and available source prices. Private collection tools require Collector or Collector Pro.</span><NuxtLink to="/explore" class="text-button">Free card browser</NuxtLink><NuxtLink to="/membership" class="text-button">Membership options</NuxtLink></aside></template>
