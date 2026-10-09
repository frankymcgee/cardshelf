<script setup lang="ts">
import { gameName } from '../../../shared/games.mjs'
import { binderTypeLabel } from '../../../shared/binder-types.mjs'
const api = useApi(), notice = useNotice(), route = useRoute()
const binders = ref<any[]>([]), loading = ref(true), open = ref(route.query.new === '1'), busy = ref(false)
const gameFilter = ref('')
const filter = ref('all'), generatorOpen = ref(false)
const loadError = ref('')
let sequence = 0, alive = true
const form = reactive({ game: 'pokemon', binder_type: 'tracking', title: '', description: '', columns: 3, rows: 3, page_count: 10, color: '#5546d8' })
const colors = ['#5546d8', '#237b73', '#d47544', '#3467a5', '#88456e', '#303948']
const visible = computed(() => binders.value.filter(b => (!gameFilter.value || b.game === gameFilter.value) && (filter.value === 'all' || b.binder_type === filter.value)))
async function load() {
  const current = ++sequence; loading.value = true; loadError.value = ''
  try { const result = await api('/api/binders'); if (alive && current === sequence) binders.value = result }
  catch (e) { if (alive && current === sequence) loadError.value = errorMessage(e) }
  finally { if (alive && current === sequence) loading.value = false }
}
onMounted(load)
onBeforeUnmount(() => { alive = false; sequence++ })
async function create() {
  if (busy.value) return
  busy.value = true
  try { const binder = await api('/api/binders', { method: 'POST', body: { ...form } }); await navigateTo('/binders/' + binder.id) }
  catch (e) { notice.show(errorMessage(e), 'error') } finally { busy.value = false }
}
</script>
<template>
  <header class="page-heading"><div><span class="eyebrow">A PLACE FOR EVERY CARD</span><h1>Your binders</h1><p>A quick checklist or a detailed collection. Choose the way you collect.</p></div>
    <div class="button-row"><button class="button primary" @click="generatorOpen = true">From set / series</button><button class="button secondary" @click="open = true"><AppIcon name="plus" :size="18" />Blank binder</button></div>
  </header>
  <GamePicker v-model="gameFilter" all />
  <div class="binder-type-filter" role="group" aria-label="Filter binders"><button v-for="f in ['all','tracking','collection']" :key="f" class="button secondary small-button" :aria-pressed="filter === f" :class="{ chosen: filter === f }" @click="filter = f">{{ f === 'all' ? 'All binders' : f === 'tracking' ? 'Tracking' : 'Collection' }}</button></div>
  <p v-if="loadError" class="alert error" role="alert">Could not load your binders. {{ loadError }} <button class="text-button" :disabled="loading" @click="load">Retry</button></p>
  <p v-if="loading" class="loading-panel" role="status">Loading binders…</p>
  <div v-else-if="visible.length" class="binder-list full-list"><NuxtLink v-for="binder in visible" :key="binder.id" :to="'/binders/' + binder.id" class="binder-card">
    <BinderCover :binder="binder" />
    <div class="binder-card-info"><strong>{{ binder.title }}</strong><small>{{ gameName(binder.game || 'pokemon') }}</small><span v-if="binder.binder_type === 'tracking'">{{ binder.collected || 0 }} / {{ binder.filled }} collected · {{ binder.filled ? Math.round((binder.collected || 0) / binder.filled * 100) : 0 }}%</span><span v-else>{{ binder.page_count }} pages · {{ binder.filled }} / {{ binder.columns * binder.rows * binder.page_count }} pockets</span><small v-if="binder.share_token" class="purple-text">Read-only sharing enabled</small></div>
  </NuxtLink></div>
  <section v-else-if="!loadError" class="empty-state tall"><div class="empty-icon"><AppIcon name="binder" :size="46" /></div><h2>{{ binders.length ? 'No binders of this type yet.' : 'Your next collection starts here.' }}</h2><p>Generate a checklist from your imported sets, or start with empty pockets.</p><div class="button-row"><button class="button primary" @click="generatorOpen = true">Create from a set</button><button class="button secondary" @click="open = true">Start blank</button></div></section>
  <p class="data-note">Tracking binders have independent collected/missing marks. Collection binders use your detailed inventory. Neither reserves physical copies, and switching between binders never adds inventory quantities.</p>
  <SeriesBinderBuilder :open="generatorOpen" @close="generatorOpen = false" @created="load" />
  <AppModal :open="open" title="Create a new binder" :dismissible="!busy" @close="open = false"><form class="form-stack" @submit.prevent="create">
    <GamePicker v-model="form.game" :disabled="busy" />
    <p class="data-note">Collector can manage the game selected under Card games; Collector Plus can manage all supported games. Existing binders in other games remain readable.</p>
    <BinderTypePicker v-model="form.binder_type" :disabled="busy" />
    <label>Binder name<input v-model="form.title" required maxlength="100" placeholder="e.g. My first master set" :disabled="busy" /></label>
    <label>Description<textarea v-model="form.description" maxlength="1000" :disabled="busy" /></label>
    <div class="form-columns"><label>Columns<select v-model.number="form.columns" :disabled="busy"><option :value="2">2</option><option :value="3">3</option><option :value="4">4</option></select></label><label>Rows<select v-model.number="form.rows" :disabled="busy"><option :value="2">2</option><option :value="3">3</option><option :value="4">4</option></select></label><label>Pages<input v-model.number="form.page_count" required type="number" min="1" max="60" :disabled="busy" /></label></div>
    <div v-if="form.binder_type === 'collection'"><label>Cover colour</label><div class="color-options"><button v-for="color in colors" :key="color" type="button" :disabled="busy" :style="{ background: color }" :class="{ selected: form.color === color }" :aria-label="'Choose ' + color" @click="form.color = color"><AppIcon v-if="form.color === color" name="check" :size="16" /></button></div></div>
    <p class="muted small">{{ form.columns * form.rows }} pockets per page · {{ form.columns * form.rows * form.page_count }} total pockets</p>
    <p v-if="form.binder_type === 'tracking'" class="alert info">Add cards to empty pockets, then tap + Mark collected. For a complete ready-made checklist, use From set / series instead. Tracking layouts stay fixed after creation.</p>
    <button class="button primary full" :disabled="busy">{{ busy ? 'Creating…' : 'Create ' + (form.binder_type === 'tracking' ? 'tracking' : 'collection') + ' binder' }}<AppIcon name="arrow" :size="18" /></button>
  </form></AppModal>
</template>
<style scoped>
.binder-type-filter{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:24px}.binder-type-filter .chosen{background:#253247;color:white;border-color:#253247}
</style>
