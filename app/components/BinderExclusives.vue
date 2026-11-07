<script setup lang="ts">
const props = defineProps<{ open: boolean; binder: any }>()
const emit = defineEmits<{ close: []; saved: []; saving: [value: boolean] }>()
const api = useApi(), notice = useNotice(), sets = ref<any[]>([]), busy = ref(false), loading = ref(false), error = ref('')
const preview = ref<any>(null), pending = ref<any>(null)
const form = reactive({ action: 'add', set_ids: [] as string[] })
let sequence = 0, loadSequence = 0
watch(() => props.open, async open => {
  const request = ++loadSequence; sequence++; preview.value = null; pending.value = null; error.value = ''; loading.value = false
  if (!open) return
  form.action = 'add'
  form.set_ids = [...new Set<string>((props.binder.slots || []).map((s: any) => s.set_id).filter(Boolean))]
  if (!form.set_ids.length) form.set_ids = [...(props.binder.exclusive_set_ids || [])]
  loading.value = true
  try {
    const result = await api('/api/catalogue/facets')
    if (request === loadSequence) sets.value = result.sets.filter((s: any) => s.game === props.binder.game)
  } catch (e) { if (request === loadSequence) error.value = errorMessage(e) }
  finally { if (request === loadSequence) loading.value = false }
})
watch(form, () => { preview.value = null; pending.value = null; error.value = ''; sequence++ })
watch(() => props.binder?.revision, () => { preview.value = null; pending.value = null })
onBeforeUnmount(() => { sequence++; loadSequence++ })
async function prepare() {
  if (busy.value) return
  const request = ++sequence; busy.value = true; error.value = ''
  try {
    const result = await api('/api/binders/' + props.binder.id + '/exclusives/preview', { method: 'POST', body: { ...form } })
    if (request !== sequence) return
    preview.value = result
    pending.value = { ...form, set_ids: [...form.set_ids], revision: result.revision, preview_token: result.preview_token, request_id: crypto.randomUUID() }
  } catch (e) { if (request === sequence) error.value = errorMessage(e) }
  finally { busy.value = false }
}
async function apply() {
  if (busy.value || !pending.value) return
  busy.value = true; emit('saving', true); error.value = ''
  try {
    const result = await api('/api/binders/' + props.binder.id + '/exclusives', { method: 'POST', body: { ...pending.value } })
    notice.show(`${result.added} added · ${result.removed} removed. Pockets are in card-number order with no gaps.`)
    pending.value = null; preview.value = null; emit('saved'); emit('close')
  } catch (e: any) {
    error.value = errorMessage(e)
    if ([400, 403, 404, 409].includes(e?.statusCode || e?.status || e?.response?.status)) { pending.value = null; preview.value = null }
  } finally { busy.value = false; emit('saving', false) }
}
</script>
<template><AppModal :open="open" title="Product-exclusive cards" wide :dismissible="!busy" @close="emit('close')"><p class="data-note">Add or remove confirmed product-exclusive printings from this binder. Cards stay grouped by set and sorted by card number. Gaps close automatically; pages grow when needed. Ownership, wishlist and saved tracking marks are preserved.</p><p v-if="loading" class="loading-panel">Loading imported sets…</p><form v-else class="form-stack" @submit.prevent="prepare"><fieldset :disabled="busy"><label>Bulk action<select v-model="form.action"><option value="add">Add product-exclusive cards</option><option value="remove">Remove product-exclusive cards</option></select></label><p class="small muted">Choose up to 50 sets to update. Unconfirmed distribution and promotional printings are left as they are.</p><div class="exclusive-sets"><label v-for="s in sets" :key="s.id" class="checkbox-label"><input v-model="form.set_ids" type="checkbox" :value="s.id" />{{ s.name }} · {{ s.language.toUpperCase() }}</label></div><p v-if="!sets.length" class="data-note">Import sets in Game imports first.</p></fieldset><button class="button secondary" :disabled="busy || !form.set_ids.length || form.set_ids.length > 50">{{ busy ? 'Working…' : 'Preview pocket changes' }}</button></form><p v-if="error" class="alert error" role="alert">{{ error }}</p><section v-if="preview" class="exclusive-preview"><h3>{{ preview.added }} to add · {{ preview.removed }} to remove · {{ preview.moved }} to move</h3><p>{{ preview.slot_count }} planned pockets · {{ preview.page_count }} pages</p><p class="data-note">Completion scope stays {{ preview.printing_scope === 'regular' ? 'Regular set variants: extras do not count towards completion.' : 'Include promos and product exclusives.' }}</p><div class="table-scroll"><table><thead><tr><th>Pocket</th><th>Card</th><th>Printing</th></tr></thead><tbody><tr v-for="s in preview.sample" :key="s.position"><td>{{ s.previous_position === null ? 'New' : s.previous_position + 1 }} → {{ s.position + 1 }}</td><td>{{ s.set_name }} · #{{ s.local_id }} {{ s.name }}</td><td>{{ s.label }}</td></tr></tbody></table></div><details v-if="preview.removed_sample.length"><summary>Cards removed from pockets</summary><p v-for="s in preview.removed_sample" :key="s.position">#{{ s.local_id }} {{ s.name }} · {{ s.label }}</p></details><p class="data-note">Preview shows up to 24 remaining and 24 removed pockets. Apply updates every planned pocket.</p><button class="button primary" :disabled="busy || !(preview.added || preview.removed || preview.moved)" @click="apply">{{ busy ? 'Applying…' : 'Apply pocket changes' }}</button></section></AppModal></template>
<style scoped>fieldset{border:0;padding:0;min-width:0}.exclusive-sets{max-height:220px;overflow:auto;display:flex;flex-direction:column;gap:10px;margin:16px 0}.exclusive-preview{margin-top:24px}.exclusive-preview h3{font-size:17px}.exclusive-preview table{font-size:12px}</style>
