<script setup lang="ts">
import { DISTRIBUTIONS } from '../../shared/printing-distribution.mjs'
const props = defineProps<{ cardId: string; printing: any; disabled?: boolean }>()
const emit = defineEmits<{ saved: [] }>()
const api = useApi(), notice = useNotice(), busy = ref(false)
const form = reactive({ distribution: 'unknown', note: '', evidence_url: '' })
watch([() => props.printing.id, () => props.printing.distribution_revision], () => {
  const p = props.printing
  Object.assign(form, { distribution: p.distribution || 'unknown', note: p.distribution_note || '', evidence_url: p.distribution_url || '' })
}, { immediate: true })
async function save(reset = false) {
  if (busy.value || props.disabled) return
  busy.value = true
  try {
    await api('/api/cards/' + encodeURIComponent(props.cardId) + '/printings/' + props.printing.id + '/distribution', {
      method: 'PATCH', body: { ...form, distribution: reset ? null : form.distribution, revision: props.printing.distribution_revision }
    })
    emit('saved'); notice.show('Printing distribution saved.')
  } catch (e) { notice.show(errorMessage(e), 'error') }
  finally { busy.value = false }
}
</script>
<template><details class="distribution-editor"><summary>Correct distribution · {{ printing.label }}</summary><form class="form-stack" @submit.prevent="save()"><label>Distribution<select v-model="form.distribution" :disabled="busy || disabled"><option v-for="(label, value) in DISTRIBUTIONS" :key="value" :value="value">{{ label }}</option></select></label><label>Product or evidence note<input v-model="form.note" :required="form.distribution !== 'unknown'" maxlength="1000" :disabled="busy || disabled" placeholder="e.g. Build & Battle deck exclusive" /></label><label>Evidence URL<input v-model="form.evidence_url" type="url" :required="form.distribution !== 'unknown'" maxlength="1000" :disabled="busy || disabled" placeholder="https://…" /></label><p class="data-note">Verify the exact card, finish and language against a product listing or checklist. Stamps, prices and the number of variants alone do not establish distribution.</p><div class="button-row"><button class="button secondary" :disabled="busy || disabled">Save distribution</button><button v-if="printing.distribution_override !== null && printing.distribution_override !== undefined" type="button" class="text-button" :disabled="busy || disabled" @click="save(true)">Use sourced classification</button></div></form></details></template>
<style scoped>.distribution-editor{margin:12px 0}.distribution-editor>summary{cursor:pointer;min-height:44px;align-content:center}.distribution-editor form{padding:10px 0}</style>
