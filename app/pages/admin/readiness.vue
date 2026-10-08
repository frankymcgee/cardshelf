<script setup lang="ts">
const api = useApi(), data = ref<any>(null), loading = ref(false), error = ref('')
const labels: Record<string, string> = { blocked: 'Needs attention', review: 'Review needed', pass: 'Check passed', configured: 'Configuration checks passed' }
let sequence = 0, alive = true
async function load() {
  const current = ++sequence; loading.value = true; error.value = ''; data.value = null
  try { const result = await api('/api/admin/readiness'); if (alive && current === sequence) data.value = result }
  catch (e) { if (alive && current === sequence) error.value = errorMessage(e) }
  finally { if (alive && current === sequence) loading.value = false }
}
onMounted(load)
onBeforeUnmount(() => { alive = false; sequence++; data.value = null })
useSeoMeta({ title: 'Release readiness · CardShelf', robots: 'noindex, nofollow' })
</script>
<template>
  <header class="page-heading"><div><span class="eyebrow">PLATFORM OPERATION</span><h1>Release readiness</h1><p>Check saved configuration and recent operational evidence before a public release.</p></div><button class="button secondary" :disabled="loading" @click="load">Refresh checks</button></header>
  <p v-if="loading" role="status" class="loading-panel">Checking release configuration…</p>
  <p v-if="error" role="alert" class="alert error">{{ error }} <button class="text-button" @click="load">Try again</button></p>
  <template v-if="data">
    <section class="panel readiness-summary"><h2>{{ labels[data.status] }}</h2><p>CardShelf {{ data.version }} · Checked {{ new Date(data.checked_at).toLocaleString() }}</p><p>These checks inspect stored settings and recorded events. They do not test external connections, make payments, send emails or prove feature completeness.</p></section>
    <section aria-labelledby="readiness-config"><h2 id="readiness-config">Configuration checks</h2><div class="readiness-grid"><article v-for="check in data.checks" :key="check.id" class="panel readiness-check" :data-status="check.status"><span class="badge">{{ labels[check.status] }}</span><h3>{{ check.label }}</h3><p>{{ check.detail }}</p><NuxtLink :to="check.to" class="text-button">Open settings →</NuxtLink></article></div></section>
    <section class="panel readiness-acceptance"><h2>Acceptance checks still required</h2><p>Complete these on the deployed release and retain the results. A green configuration check does not complete them.</p><article v-for="check in data.acceptance" :key="check.id"><h3>{{ check.label }}</h3><p>{{ check.detail }}</p></article></section>
  </template>
</template>
<style scoped>
.readiness-summary,.readiness-acceptance{padding:24px;margin:24px 0}.readiness-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.readiness-check{padding:22px;min-width:0;overflow-wrap:anywhere}.readiness-check h3{margin:14px 0 8px}.readiness-check p,.readiness-acceptance p{line-height:1.7;color:var(--muted)}.readiness-check[data-status=blocked]{border-left:4px solid var(--danger)}.readiness-check[data-status=review]{border-left:4px solid var(--warning)}.readiness-check[data-status=pass]{border-left:4px solid var(--primary)}.readiness-acceptance article+article{margin-top:24px}@media(max-width:650px){.readiness-grid{grid-template-columns:1fr}}
</style>
