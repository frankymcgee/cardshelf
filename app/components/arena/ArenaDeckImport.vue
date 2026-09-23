<script setup lang="ts">
const props = defineProps<{ hasCards: boolean; locked: boolean }>()
const emit = defineEmits<{ apply: [draft: any] }>()
const api = useApi(), text = ref(''), preview = ref<any>(null), selections = ref<Record<string, string>>({})
const working = ref(false), error = ref(''), replace = ref(false)
let alive = true
watch(text, () => { preview.value = null; selections.value = {}; replace.value = false; error.value = '' })
function choose() { if (preview.value) preview.value.complete = false; replace.value = false }
async function readFile(event: Event) {
  const input = event.target as HTMLInputElement, file = input.files?.[0]
  if (!file || working.value || props.locked) return
  error.value = ''; working.value = true
  try {
    if (file.size > 32000) throw new Error('Choose a deck file smaller than 32 KB.')
    const content = await file.text()
    if (alive) text.value = content
  } catch (e) { if (alive) error.value = errorMessage(e) }
  finally { working.value = false; input.value = '' }
}
async function review() {
  if (working.value || props.locked) return
  working.value = true; error.value = ''; replace.value = false
  try {
    const result = await api('/api/arena/decks/preview-import', { method: 'POST', body: { text: text.value,
      selections: Object.entries(selections.value).filter(([, id]) => id).map(([line, card_id]) => ({ line: Number(line), card_id })) } })
    if (alive) preview.value = result
  } catch (e) { if (alive) { preview.value = null; error.value = errorMessage(e) } }
  finally { working.value = false }
}
function apply() {
  if (!preview.value?.complete || working.value || props.locked || (props.hasCards && !replace.value)) return
  emit('apply', preview.value); preview.value = null; text.value = ''; replace.value = false
}
onBeforeUnmount(() => { alive = false })
</script>
<template>
  <details class="aw-import arena-panel">
    <summary>Import a deck list<span>Paste text or choose a CardShelf JSON export</span></summary>
    <div class="aw-import-content">
      <p class="arena-muted">Use one entry per line: <code>4 en:sv03-125</code> or <code>4 Exact Card Name</code>. Names with multiple printings need a choice. External set abbreviations are not converted automatically.</p>
      <label>Deck list<textarea v-model="text" maxlength="32000" rows="5" :disabled="working || locked" placeholder="4 Exact Card Name&#10;56 Exact Energy Name" spellcheck="false" /></label>
      <div class="arena-actions"><button type="button" class="arena-button" :disabled="working || locked || !text.trim()" @click="review">{{ working ? 'Checking catalogue…' : 'Review import' }}</button><label class="aw-file-label">Choose deck file<input type="file" accept=".json,.txt,application/json,text/plain" :disabled="working || locked" @change="readFile"></label></div>
      <p v-if="error" class="arena-alert error" role="alert">{{ error }}</p>
      <section v-if="preview" aria-label="Import review" class="aw-import-review" aria-live="polite">
        <h3>{{ preview.total }} cards to review</h3>
        <ul><li v-for="row in preview.rows" :key="row.line"><div><strong>{{ row.quantity }} × {{ row.status === 'ready' ? row.candidates[0].card.name : row.label }}</strong><span :class="['aw-import-status', row.status]">{{ row.status === 'ready' ? 'Matched' : row.status }}</span></div><small v-if="row.status === 'ready'">{{ row.candidates[0].card.set_name }} · {{ row.candidates[0].card.id }}</small><p v-if="row.reason">{{ row.reason }}</p>
          <label v-if="row.status === 'ambiguous'">Printing for line {{ row.line }}<select v-model="selections[row.line]" :disabled="working || locked" @change="choose"><option :value="undefined">Choose a printing</option><option v-for="candidate in row.candidates" :key="candidate.card.id" :value="candidate.card.id">{{ candidate.card.set_name }} · {{ candidate.card.id }}{{ candidate.supported ? '' : ' · unsupported' }}</option></select></label>
          <small v-if="row.more">More printings exist. Replace this line with the exact catalogue ID if yours is not listed.</small>
        </li></ul>
        <p v-if="!preview.complete" class="arena-muted">Resolve the listed issues, then choose Review import again. Every entry must match a supported card.</p>
        <template v-else><p>{{ preview.validation?.playable ? 'This list is ready to play once saved.' : 'This list can be saved as a draft.' }}</p><ul v-if="preview.validation?.errors?.length" class="aw-validation-list"><li v-for="message in preview.validation.errors" :key="message">{{ message }}</li></ul><label v-if="hasCards" class="arena-check"><input v-model="replace" type="checkbox" :disabled="working || locked">Replace the cards in my current draft</label><button type="button" class="arena-button primary" :disabled="working || locked || (hasCards && !replace)" @click="apply">Apply to draft</button><small>Your saved deck changes only when you choose Save deck.</small></template>
      </section>
    </div>
  </details>
</template>
