<script setup lang="ts">
const props = defineProps<{ open: boolean }>()
const emit = defineEmits(['close', 'created'])
const api = useApi(), notice = useNotice()
const sets = ref<any[]>([]), loading = ref(false), busy = ref(false), preview = ref<any>(null), acknowledge = ref(false)
const game = ref('pokemon')
const language = ref('en'), series = ref(''), search = ref('')
const form = reactive({ binder_type: 'tracking', title: '', description: '', color: '#5546d8', columns: 3, rows: 3,
  set_ids: [] as string[], selection: 'designs', owned_only: false, new_page_per_set: true })
const tracking = computed(() => form.binder_type === 'tracking')
const seriesOptions = computed(() => [...new Set(sets.value.filter(s => (s.game || 'pokemon') === game.value && s.language === language.value && s.series).map(s => s.series as string))].sort())
const visibleSets = computed(() => sets.value.filter(s => (s.game || 'pokemon') === game.value && s.language === language.value && (!series.value || s.series === series.value) &&
  (!search.value || (s.name + ' ' + s.provider_id).toLowerCase().includes(search.value.toLowerCase()))))
let loadSequence = 0, previewSequence = 0, requestId = ''
watch(() => props.open, async open => {
  const request = ++loadSequence
  previewSequence++; preview.value = null; requestId = ''
  if (!open) return
  loading.value = true
  try { const data = await api('/api/catalogue/facets'); if (request === loadSequence) sets.value = data.sets }
  catch (e) { if (request === loadSequence) notice.show(errorMessage(e), 'error') }
  finally { if (request === loadSequence) loading.value = false }
})
watch(form, () => { preview.value = null; acknowledge.value = false; requestId = ''; previewSequence++ })
watch(tracking, value => { if (value) form.owned_only = false })
watch(game, () => { form.set_ids = []; series.value = ''; language.value = 'en' })
watch(language, () => { form.set_ids = []; series.value = '' })
onBeforeUnmount(() => { loadSequence++; previewSequence++ })
function selectVisible() { form.set_ids = visibleSets.value.slice(0, 50).map(s => s.id); if (!form.title) form.title = (series.value || visibleSets.value[0]?.name || 'My collection').slice(0, 85) }
async function previewLayout() {
  if (busy.value) return
  busy.value = true
  const request = ++previewSequence
  try {
    const data = await api('/api/binders/generate/preview', { method: 'POST', body: { ...form } })
    if (request !== previewSequence) return
    preview.value = data; acknowledge.value = false; requestId = crypto.randomUUID()
  } catch (e) { notice.show(errorMessage(e), 'error') }
  finally { busy.value = false }
}
async function create() {
  if (!preview.value || busy.value) return
  busy.value = true
  try {
    const result = await api('/api/binders/generate', { method: 'POST', body: { ...form, preview_token: preview.value.token,
      acknowledge_partial: acknowledge.value, request_id: requestId } })
    notice.show(`${result.binders.length} binder${result.binders.length === 1 ? '' : 's'} created. ${tracking.value ? 'All checklist cards start missing.' : 'Ownership is unchanged.'}`)
    emit('created'); emit('close'); await navigateTo('/binders/' + result.binders[0].id)
  } catch (e: any) {
    notice.show(errorMessage(e), 'error')
    if (e?.statusCode === 409 || e?.status === 409) { preview.value = null; requestId = '' }
  } finally { busy.value = false }
}
</script>
<template>
  <AppModal :open="open" title="Create binders from sets or a series" wide :dismissible="!busy" @close="emit('close')">
    <p class="muted small">Choose a quick checklist or a detailed collection layout. Existing binders and inventory quantities are not changed.</p>
    <p v-if="loading" class="loading-panel">Loading your imported sets…</p>
    <p v-else-if="!sets.length" class="alert info">Import a set in Data & settings before generating a binder.</p>
    <form v-else class="form-stack" @submit.prevent="previewLayout">
      <fieldset :disabled="busy" class="generator-fields">
        <GamePicker v-model="game" :disabled="busy" />
        <BinderTypePicker v-model="form.binder_type" :disabled="busy" />
        <div class="form-columns"><label>Language<select v-model="language"><option value="en">English</option><option v-if="game === 'pokemon'" value="ja">Japanese</option></select></label><label>Collection series<select v-model="series"><option value="">All imported series</option><option v-for="s in seriesOptions" :key="s" :value="s">{{ s }}</option></select></label></div>
        <label>Find a set<input v-model="search" placeholder="Set name or ID" /></label>
        <div class="button-row"><button type="button" class="text-button" @click="selectVisible">Select displayed sets (maximum 50)</button><button type="button" class="text-button" @click="form.set_ids = []">Clear selection</button></div>
        <div class="generator-set-list"><label v-for="s in visibleSets" :key="s.id" class="checkbox-label"><input v-model="form.set_ids" type="checkbox" :value="s.id" /><span>{{ s.name }} <small class="muted">{{ s.imported_count }}/{{ s.card_count }} cards imported</small><span v-if="s.imported_count < s.card_count" class="badge amber">Partial</span></span></label><p v-if="!visibleSets.length" class="muted small">No imported sets match this filter.</p></div>
        <small class="muted">{{ form.set_ids.length }} selected. Only sets imported on this server are included.</small>
        <label>Binder name<input v-model="form.title" required maxlength="85" placeholder="e.g. Sword & Shield collection" /></label><label>Description<textarea v-model="form.description" maxlength="1000" /></label>
        <div class="form-columns"><label>Columns<select v-model.number="form.columns"><option :value="2">2</option><option :value="3">3</option><option :value="4">4</option></select></label><label>Rows<select v-model.number="form.rows"><option :value="2">2</option><option :value="3">3</option><option :value="4">4</option></select></label><label v-if="!tracking">Cover colour<input v-model="form.color" type="color" /></label></div>
        <label>Checklist layout<select v-model="form.selection"><option value="designs">One pocket per card design</option><option value="printings">One pocket per known printing</option></select></label>
        <p v-if="tracking" class="data-note">Design checklists accept any printing of the card; printing checklists track each displayed finish separately. All cards start grey and uncollected, independently of your inventory. Known printings are not a verified master checklist.</p>
        <p v-else class="data-note">One per design uses a preferred available printing. Choose known printings when finish or rarity matters. Known printings are not a verified master checklist. Owned-only layouts consider your owned printings first.</p>
        <label v-if="!tracking" class="checkbox-label"><input v-model="form.owned_only" type="checkbox" />Owned cards only (one pocket per design or printing, not per duplicate copy)</label>
        <label class="checkbox-label"><input v-model="form.new_page_per_set" type="checkbox" />Start each set on a new page</label>
      </fieldset>
      <button class="button secondary" :disabled="busy || !form.set_ids.length || form.set_ids.length > 50">{{ busy ? 'Working…' : 'Preview layout' }}</button>
    </form>
    <section v-if="preview" class="generation-preview"><h3>{{ preview.volume_count }} {{ tracking ? 'tracking' : 'collection' }} binder(s) · {{ preview.total_pages }} pages · {{ preview.slot_count }} cards</h3>
      <p class="muted small">{{ tracking ? 'Every checklist card will start missing.' : preview.owned_slots + ' positions match owned printings.' }} Large layouts split into volumes of at most 60 pages.</p>
      <p v-for="b in preview.volumes" :key="b.title" class="small"><strong>{{ b.title }}</strong> — {{ b.page_count }} pages, {{ b.slot_count }} cards</p>
      <div class="table-scroll"><table><thead><tr><th>Volume / page / pocket</th><th>Card</th><th>{{ tracking && form.selection === 'designs' ? 'Checklist' : 'Printing' }}</th></tr></thead><tbody><tr v-for="s in preview.sample" :key="s.volume + ':' + s.position"><td>{{ s.volume }} / {{ s.page }} / {{ s.pocket }}</td><td>#{{ s.local_id }} {{ s.name }}</td><td>{{ tracking && form.selection === 'designs' ? 'Any printing' : s.label }}</td></tr></tbody></table></div>
      <p class="muted small">Sample only; creation includes all {{ preview.slot_count }} cards.</p>
      <label v-if="preview.partial" class="checkbox-label alert warning"><input v-model="acknowledge" type="checkbox" />I understand some sets are partially imported. Unimported cards will not be included.</label>
      <button class="button primary full" :disabled="busy || (preview.partial && !acknowledge)" @click="create">{{ busy ? 'Creating…' : 'Create ' + preview.volume_count + ' binder(s)' }}</button>
    </section>
  </AppModal>
</template>
