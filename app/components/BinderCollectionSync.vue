<script setup lang="ts">
const props = defineProps<{ binder: any; disabled?: boolean }>()
const emit = defineEmits<{ converted: []; saving: [value: boolean] }>()
const api = useApi(), notice = useNotice()
const open = ref(false), loading = ref(false), saving = ref(false), error = ref(''), preview = ref<any>(null)
const importMarks = ref(true), confirmPrintings = ref(false), confirmed = ref(false)
let pending: any = null, sequence = 0, alive = true
onBeforeUnmount(() => { alive = false; sequence++ })
watch(() => props.binder.id, () => { sequence++; open.value = false; preview.value = null; pending = null })
async function review() {
  open.value = true; loading.value = true; error.value = ''; pending = null; preview.value = null
  confirmed.value = false; confirmPrintings.value = false
  const id = props.binder.id, request = ++sequence
  try {
    const result = await api('/api/binders/' + id + '/collection-sync')
    if (!alive || id !== props.binder.id || request !== sequence) return
    preview.value = result; importMarks.value = !result.design_checklist
  } catch (e) { if (alive && request === sequence) error.value = errorMessage(e) }
  finally { if (alive && request === sequence) loading.value = false }
}
function close() { if (!saving.value) { open.value = false; sequence++; pending = null } }
async function convert() {
  if (saving.value || !preview.value || !confirmed.value || props.disabled) return
  const id = props.binder.id
  pending ||= { request_id: crypto.randomUUID(), revision: preview.value.revision, preview_token: preview.value.preview_token,
    import_marks: importMarks.value, confirm: true, confirm_displayed_printings: confirmPrintings.value }
  saving.value = true; emit('saving', true); error.value = ''
  try {
    const result = await api('/api/binders/' + id + '/collection-sync', { method: 'POST', body: { ...pending } })
    if (!alive || id !== props.binder.id) return
    pending = null; open.value = false; emit('converted')
    notice.show(result.added ? 'Collection sync enabled. ' + result.added + ' new printing(s) recorded with condition Unknown.' : 'Collection sync enabled. Existing ownership was preserved.')
  } catch (e: any) {
    if (!alive || id !== props.binder.id) return
    error.value = errorMessage(e)
    const status = e?.statusCode || e?.status || e?.response?.status
    if (status >= 400 && status < 500) { pending = null; preview.value = null }
    // An uncertain network/5xx response keeps its exact request for an idempotent retry.
  } finally { saving.value = false; if (alive) emit('saving', false) }
}
</script>
<template>
  <section class="panel collection-sync-prompt">
    <div><h3>Keep the quick checklist. Add collection sync.</h3><p>Use this same binder for ownership, prices and customisation. Cards you already own are reused, not counted again.</p></div>
    <button class="button primary" :disabled="disabled || saving" @click="review">Enable collection sync</button>
    <AppModal :open="open" title="Convert to a collection-backed binder" :dismissible="!saving" @close="close">
      <p v-if="loading" class="muted">Reviewing your checklist and existing ownership…</p>
      <p v-if="error" class="alert error" role="alert">{{ error }}</p>
      <template v-if="preview">
        <p>The binder keeps its name, pages and pocket positions. Its default view remains quick tracking, with a separate layout view for customisation.</p>
        <p class="alert info">Collected/missing will now reflect your shared collection, across all collection-backed binders. This does not reserve physical copies.</p>
        <label class="checkbox-label"><input v-model="importMarks" type="checkbox" :disabled="saving || !!pending">Import existing collected marks into ownership</label>
        <p v-if="importMarks" class="data-note">{{ preview.would_add }} new printings would receive one Unknown-condition copy; {{ preview.already_owned }} already-owned printings would keep their exact quantities, conditions and notes. Missing marks never remove owned cards.</p>
        <p v-else class="data-note">No quantities will change. Existing collection ownership determines the new checklist; old independent marks will no longer determine its completion.</p>
        <p v-if="preview.design_checklist" class="alert warning">This checklist currently means “any printing of this design”. Ownership must identify the actual printing. Review the labels below before importing marks, or leave importing off and add the correct printing later.</p>
        <div v-if="preview.marked.length" class="conversion-review table-scroll"><table><thead><tr><th>Marked card</th><th>Displayed printing</th><th>Already owned</th></tr></thead><tbody>
          <tr v-for="item in preview.marked" :key="item.printing_id"><td>{{ item.name }} #{{ item.local_id }}</td><td>{{ item.label }}</td><td>{{ item.owned_quantity }}</td></tr>
        </tbody></table></div>
        <label v-if="preview.design_checklist && importMarks && preview.marked.length" class="checkbox-label"><input v-model="confirmPrintings" type="checkbox" :disabled="saving || !!pending">I own the displayed printings of these marked cards.</label>
        <label class="checkbox-label conversion-confirm"><input v-model="confirmed" type="checkbox" :disabled="saving || !!pending">Convert this binder and revoke its existing public sharing link. I understand this cannot be undone with a simple toggle.</label>
        <button class="button primary full" :disabled="saving || !confirmed || (preview.design_checklist && importMarks && preview.marked.length > 0 && !confirmPrintings)" @click="convert">{{ saving ? 'Enabling sync…' : pending ? 'Retry the same conversion' : 'Convert and enable sync' }}</button>
        <p class="data-note">No subscription charge is created. Deleting the converted binder later will not delete the cards from your collection.</p>
      </template>
      <button v-else-if="!loading" class="button secondary" @click="review">Load a fresh preview</button>
    </AppModal>
  </section>
</template>
<style scoped>
.collection-sync-prompt{padding:20px;display:flex;align-items:center;justify-content:space-between;gap:18px;flex-wrap:wrap;margin:18px 0}.collection-sync-prompt>div{flex:1;min-width:220px}.collection-sync-prompt h3{margin-bottom:8px}.collection-sync-prompt p{font-size:13px;margin-bottom:0;color:var(--muted)}.conversion-review{max-height:260px;overflow:auto;margin:16px 0;border:1px solid var(--line);border-radius:8px}.conversion-confirm{margin:20px 0;align-items:flex-start}.conversion-confirm input{margin-top:3px}
</style>
