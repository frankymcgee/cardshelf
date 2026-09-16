<script setup lang="ts">
const props = defineProps<{ open: boolean }>();
const emit = defineEmits(['close', 'created']);
const api = useApi(), notice = useNotice();
const sets = ref<any[]>([]), loading = ref(false), busy = ref(false), preview = ref<any>(null), acknowledge = ref(false);
const language = ref('en'), series = ref(''), search = ref('');
const form = reactive({ title: '', description: '', color: '#5546d8', columns: 3, rows: 3,
  set_ids: [] as string[], selection: 'designs', owned_only: false, new_page_per_set: true });
const seriesOptions = computed(() => [...new Set(sets.value.filter(s => s.language === language.value && s.series).map(s => s.series as string))].sort());
const visibleSets = computed(() => sets.value.filter(s => s.language === language.value && (!series.value || s.series === series.value) &&
  (!search.value || (s.name + ' ' + s.provider_id).toLowerCase().includes(search.value.toLowerCase()))));
let sequence = 0, requestId = '';
watch(() => props.open, async open => {
  sequence++;
  if (!open) return;
  loading.value = true;
  const request = sequence;
  try { const data = await api('/api/catalogue/facets'); if (request === sequence) sets.value = data.sets; }
  catch (e) { notice.show(errorMessage(e), 'error'); }
  finally { if (request === sequence) loading.value = false; }
});
watch(form, () => { preview.value = null; acknowledge.value = false; requestId = ''; sequence++; });
watch(language, () => { form.set_ids = []; series.value = ''; });
onBeforeUnmount(() => { sequence++; });
function selectVisible() { form.set_ids = visibleSets.value.slice(0, 50).map(s => s.id); if (!form.title) form.title = (series.value || visibleSets.value[0]?.name || 'My collection').slice(0,85); }
async function previewLayout() {
  busy.value = true;
  const request = ++sequence;
  try {
    const data = await api('/api/binders/generate/preview', { method: 'POST', body: { ...form } });
    if (request !== sequence) return;
    preview.value = data; acknowledge.value = false; requestId = crypto.randomUUID();
  } catch (e) { notice.show(errorMessage(e), 'error'); }
  finally { busy.value = false; }
}
async function create() {
  if (!preview.value || busy.value) return;
  busy.value = true;
  try {
    const result = await api('/api/binders/generate', { method: 'POST', body: { ...form, preview_token: preview.value.token,
      acknowledge_partial: acknowledge.value, request_id: requestId } });
    notice.show(`${result.binders.length} binder${result.binders.length === 1 ? '' : 's'} created. Ownership is unchanged.`);
    emit('created'); emit('close');
    await navigateTo('/binders/' + result.binders[0].id);
  } catch (e: any) {
    notice.show(errorMessage(e), 'error');
    if (e?.statusCode === 409 || e?.status === 409) { preview.value = null; requestId = ''; }
  } finally { busy.value = false; }
}
</script>
<template>
  <AppModal :open="open" title="Create binders from sets or a series" wide @close="!busy && emit('close')">
    <p class="muted small">Use imported sets to plan a full collection, or include only cards you own. Existing binders and quantities are not changed.</p>
    <p v-if="loading" class="loading-panel">Loading your imported sets…</p>
    <p v-else-if="!sets.length" class="alert info">Import a set in Data & settings before generating a binder.</p>
    <form v-else class="form-stack" @submit.prevent="previewLayout">
      <fieldset :disabled="busy" class="generator-fields">
        <div class="form-columns">
          <label>Language<select v-model="language"><option value="en">English</option><option value="ja">Japanese</option></select></label>
          <label>Collection series<select v-model="series"><option value="">All imported series</option><option v-for="s in seriesOptions" :key="s" :value="s">{{ s }}</option></select></label>
        </div>
        <label>Find a set<input v-model="search" placeholder="Set name or ID" /></label>
        <div class="button-row"><button type="button" class="text-button" @click="selectVisible">Select displayed sets (maximum 50)</button><button type="button" class="text-button" @click="form.set_ids = []">Clear selection</button></div>
        <div class="generator-set-list">
          <label v-for="s in visibleSets" :key="s.id" class="checkbox-label"><input v-model="form.set_ids" type="checkbox" :value="s.id" />
            <span>{{ s.name }} <small class="muted">{{ s.imported_count }}/{{ s.card_count }} cards imported</small><span v-if="s.imported_count < s.card_count" class="badge amber">Partial</span></span>
          </label>
          <p v-if="!visibleSets.length" class="muted small">No imported sets match this filter.</p>
        </div>
        <small class="muted">{{ form.set_ids.length }} selected. A series includes only sets already imported on this server, not every set available upstream.</small>
        <label>Binder name<input v-model="form.title" required maxlength="85" placeholder="e.g. Sword & Shield collection" /></label>
        <label>Description<textarea v-model="form.description" maxlength="1000" /></label>
        <div class="form-columns">
          <label>Columns<select v-model.number="form.columns"><option :value="2">2</option><option :value="3">3</option><option :value="4">4</option></select></label>
          <label>Rows<select v-model.number="form.rows"><option :value="2">2</option><option :value="3">3</option><option :value="4">4</option></select></label>
          <label>Cover colour<input v-model="form.color" type="color" /></label>
        </div>
        <label>Printing layout<select v-model="form.selection"><option value="designs">One pocket per card design</option><option value="printings">One pocket per known printing</option></select></label>
        <p class="data-note">One per design prefers Normal, then Holo, then Reverse Holo. Known printings are not a verified master checklist. Owned-only layouts consider your owned printings first.</p>
        <label class="checkbox-label"><input v-model="form.owned_only" type="checkbox" />Owned cards only (one pocket per design or printing, not per duplicate copy)</label>
        <label class="checkbox-label"><input v-model="form.new_page_per_set" type="checkbox" />Start each set on a new page</label>
      </fieldset>
      <button class="button secondary" :disabled="busy || !form.set_ids.length">{{ busy ? 'Working…' : 'Preview layout' }}</button>
    </form>
    <section v-if="preview" class="generation-preview">
      <h3>{{ preview.volume_count }} binder(s) · {{ preview.total_pages }} pages · {{ preview.slot_count }} planned pockets</h3>
      <p class="muted small">{{ preview.owned_slots }} positions match owned printings. Large layouts split into numbered volumes of at most 60 pages each.</p>
      <p v-for="b in preview.volumes" :key="b.title" class="small"><strong>{{ b.title }}</strong> — {{ b.page_count }} pages, {{ b.slot_count }} cards</p>
      <div class="table-scroll"><table><thead><tr><th>Volume / page / pocket</th><th>Card</th><th>Printing</th></tr></thead><tbody>
        <tr v-for="s in preview.sample" :key="s.volume + ':' + s.position"><td>{{ s.volume }} / {{ s.page }} / {{ s.pocket }}</td><td>#{{ s.local_id }} {{ s.name }}</td><td>{{ s.label }}</td></tr>
      </tbody></table></div>
      <p class="muted small">Sample only; creation includes all {{ preview.slot_count }} planned pockets.</p>
      <label v-if="preview.partial" class="checkbox-label alert warning"><input v-model="acknowledge" type="checkbox" />I understand some sets are partially imported. This layout will not include their unimported cards.</label>
      <button class="button primary full" :disabled="busy || (preview.partial && !acknowledge)" @click="create">{{ busy ? 'Creating…' : 'Create ' + preview.volume_count + ' binder(s)' }}</button>
    </section>
  </AppModal>
</template>
