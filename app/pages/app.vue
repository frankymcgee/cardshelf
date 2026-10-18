<script setup lang="ts">
const api = useApi(), auth = useAuth()
const data = ref<any>(null), loading = ref(true), loadError = ref('')
let sequence = 0, alive = true
async function load() {
  const current = ++sequence; loading.value = true; loadError.value = ''
  try { const result = await api('/api/dashboard'); if (alive && current === sequence) data.value = result }
  catch (e) { if (alive && current === sequence) loadError.value = errorMessage(e) }
  finally { if (alive && current === sequence) loading.value = false }
}
onMounted(load)
onBeforeUnmount(() => { alive = false; sequence++ })
const stats = computed(() => [{ label: 'Cards owned', value: data.value?.counts.copies || 0, icon: 'cards', note: 'Physical copies recorded' }, { label: 'Unique printings', value: data.value?.counts.owned_printings || 0, icon: 'grid', note: 'Across your collection' }, { label: 'On your wishlist', value: data.value?.counts.wishlist || 0, icon: 'star', note: 'Printings you are tracking' }, { label: 'Your binders', value: data.value?.counts.binders || 0, icon: 'binder', note: 'Independent layout plans' }])
</script>
<template>
  <div class="collection-workspace">
    <header class="page-heading compact-heading">
      <div><h1>My collection</h1><p>{{ auth.state.value.user?.name?.split(' ')[0] ? 'Hi ' + auth.state.value.user.name.split(' ')[0] + '. ' : '' }}Your collection at a glance.</p></div>
      <div class="button-row"><NuxtLink to="/scan" class="button primary"><AppIcon name="plus" :size="17" />Scan</NuxtLink><button class="icon-button bordered" aria-label="Refresh overview" :disabled="loading" @click="load"><AppIcon name="refresh" /></button></div>
    </header>
    <nav class="workspace-shortcuts" aria-label="Collection shortcuts"><NuxtLink to="/cards"><AppIcon name="cards" :size="18" />Cards<AppIcon name="arrow" :size="15" /></NuxtLink><NuxtLink to="/binders"><AppIcon name="binder" :size="18" />Binders<AppIcon name="arrow" :size="15" /></NuxtLink><NuxtLink to="/cards?ownership=wishlist"><AppIcon name="star" :size="18" />Wishlist<AppIcon name="arrow" :size="15" /></NuxtLink></nav>
    <p v-if="loadError" class="alert error" role="alert">Could not load your collection overview. {{ loadError }} <button class="text-button" :disabled="loading" @click="load">Retry</button></p>
    <p v-if="loading && !data" class="loading-panel" role="status">Loading your collection overview…</p>
    <section class="stats-grid compact-stats" aria-label="Collection totals"><article v-for="stat in stats" :key="stat.label" class="stat-card"><span class="stat-label">{{ stat.label }}</span><strong>{{ !data ? '—' : stat.value.toLocaleString() }}</strong></article></section>
    <template v-if="data">
      <PriceSummary :refresh-key="data?.counts.copies || 0" />
      <div class="section-heading"><h2>Your binders</h2><div class="button-row"><NuxtLink to="/binders" class="text-button">View all<AppIcon name="arrow" :size="16" /></NuxtLink><NuxtLink to="/binders?new=1" class="button secondary small-button"><AppIcon name="plus" :size="16" />New binder</NuxtLink></div></div>
      <div v-if="data.binders.length" class="binder-list dashboard-binders"><NuxtLink v-for="binder in data.binders.slice(0, 4)" :key="binder.id" :to="'/binders/' + binder.id" class="binder-card"><BinderCover :binder="binder" /><div class="binder-card-info"><strong>{{ binder.title }}</strong><span>{{ binder.filled }} / {{ binder.columns * binder.rows * binder.page_count }} pockets planned</span></div></NuxtLink></div>
      <section v-else class="empty-state horizontal"><div class="empty-icon"><AppIcon name="binder" :size="32" /></div><div><h3>No binders yet</h3><p>Create a binder for your first set or favourites.</p></div><NuxtLink to="/binders?new=1" class="text-button">Create a binder<AppIcon name="arrow" :size="17" /></NuxtLink></section>
      <UiDisclosure class="collection-progress" title="Set progress" :hint="data.progress.length + ' sets'">
        <p class="small muted">Unique card designs owned across {{ data.counts.catalogue_cards?.toLocaleString() || 0 }} imported cards.</p>
        <div v-if="data.progress.length" class="progress-list"><div v-for="set in data.progress" :key="set.id" class="progress-row"><div><NuxtLink :to="{ path: '/cards', query: { set: set.id } }">{{ set.name }}</NuxtLink><span class="badge">{{ set.language.toUpperCase() }}</span><small v-if="set.imported < set.card_count" class="amber-text">Partial import · {{ set.imported }}/{{ set.card_count }}</small></div><div class="progress-track"><div :style="{ width: (set.owned / Math.max(1, set.imported) * 100) + '%' }" /></div><span>{{ set.owned }} / {{ set.imported }}</span></div></div>
        <div v-else class="empty-inline"><p>No set progress yet.</p><NuxtLink v-if="auth.state.value.user?.role === 'admin'" to="/settings#catalogue" class="text-button">Import a set<AppIcon name="arrow" :size="16" /></NuxtLink><p v-else>Ask your administrator to import the sets you collect.</p></div>
      </UiDisclosure>
    </template>
    <AdSenseSlot :content-ready="!!data && data.counts.catalogue_cards > 0" auto-only />
  </div>
</template>
<style scoped>
.compact-heading{margin-bottom:20px}.compact-heading h1{font-size:28px}.compact-heading p{margin-top:6px}
.workspace-shortcuts{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-bottom:20px}.workspace-shortcuts a{display:flex;align-items:center;gap:10px;border:1px solid var(--line);border-radius:10px;background:var(--paper);padding:13px;font-size:13px;font-weight:600;min-height:46px}.workspace-shortcuts a>svg:last-child{margin-left:auto;color:var(--muted)}
.compact-stats{gap:10px;margin-bottom:20px}.compact-stats .stat-card{padding:15px 18px}.compact-stats .stat-label{font-size:11px}.compact-stats .stat-card>strong{font-size:25px;margin:6px 0 0}
.dashboard-binders{grid-template-columns:repeat(4,minmax(0,1fr));gap:18px}.dashboard-binders :deep(.binder-cover){height:145px}.collection-progress{margin-top:24px}
@media(max-width:600px){.compact-heading{align-items:flex-start;gap:12px}.compact-heading h1{font-size:23px}.compact-heading p{font-size:11px;line-height:1.5}.compact-heading .button-row{flex-wrap:nowrap}.compact-heading .button{font-size:11px;padding:10px}.workspace-shortcuts{gap:7px;margin-bottom:16px}.workspace-shortcuts a{padding:11px 8px;gap:6px;font-size:11px}.workspace-shortcuts a>svg:last-child{display:none}.compact-stats{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-bottom:16px}.compact-stats .stat-card{padding:12px 14px}.compact-stats .stat-card>strong{font-size:23px}.dashboard-binders{grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.dashboard-binders :deep(.binder-cover){height:130px}}


@media(max-width:600px){.compact-stats{grid-template-columns:repeat(4,minmax(0,1fr));gap:6px}.compact-stats .stat-card{padding:10px 8px}.compact-stats .stat-label{font-size:10px;min-height:28px;line-height:1.35}.compact-stats .stat-card>strong{font-size:22px}.compact-heading p{max-width:190px}}
</style>
