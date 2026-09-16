<script setup lang="ts">
const props = defineProps<{ cardId: string | null; printingId?: string; effectsMode?: string }>(), emit = defineEmits(['close', 'saved'])
const api = useApi(), auth = useAuth(), notice = useNotice()
const card = ref<any>(null), loading = ref(false), busy = ref(false), loadError = ref('')
const drafts = reactive<Record<string, any>>({}), manual = reactive({ label: '', verified: false })
const visualPrintingId = ref('')
const visualPrinting = computed(() => card.value?.printings.find((p: any) => p.id === visualPrintingId.value))
let sequence = 0
function chooseCondition(p: any, condition: string) {
  const entry = card.value?.entries.find((e: any) => e.printing_id === p.id && e.condition === condition)
  drafts[p.id] = { printing_id: p.id, condition, quantity: entry?.quantity || 0, wishlist: entry?.wishlist || false, notes: entry?.notes || '', revision: entry?.revision || 0 }
}
async function load() {
  const request = ++sequence
  if (!props.cardId) return
  loading.value = true; loadError.value = ''
  try {
    const next = await api('/api/cards/' + encodeURIComponent(props.cardId))
    if (request !== sequence) return
    card.value = next
    visualPrintingId.value = next.printings.find((p: any) => p.id === props.printingId)?.id || next.printings[0]?.id || ''
    for (const key of Object.keys(drafts)) delete drafts[key]
    for (const p of next.printings) chooseCondition(p, next.entries.find((e: any) => e.printing_id === p.id && e.quantity > 0)?.condition || 'NM')
  } catch (e) { if (request === sequence) loadError.value = errorMessage(e) }
  finally { if (request === sequence) loading.value = false }
}
watch(() => props.cardId, id => { card.value = null; if (id) load(); else sequence++ }, { immediate: true })
async function save(p: any) {
  const targetCardId = props.cardId
  const draft = { ...drafts[p.id], quantity: Number(drafts[p.id].quantity) }
  busy.value = true
  try {
    const entry = await api('/api/collection', { method: 'PUT', body: draft })
    if (props.cardId === targetCardId && card.value) {
      card.value.entries = card.value.entries.filter((e: any) => !(e.printing_id === entry.printing_id && e.condition === entry.condition))
      card.value.entries.push(entry)
      if (drafts[p.id]?.condition === entry.condition) drafts[p.id].revision = entry.revision
    }
    notice.show('Collection updated.'); emit('saved')
  } catch (e: any) { notice.show(errorMessage(e), 'error'); if (props.cardId === targetCardId && (e?.statusCode === 409 || e?.status === 409)) await load() }
  finally { busy.value = false }
}
async function addManual() {
  const targetCardId = props.cardId
  if (!targetCardId) return
  busy.value = true
  try { await api('/api/cards/' + encodeURIComponent(targetCardId) + '/printings', { method: 'POST', body: { ...manual } }); manual.label = ''; manual.verified = false; if (props.cardId === targetCardId) await load(); notice.show('Manual printing added.') }
  catch (e) { notice.show(errorMessage(e), 'error') } finally { busy.value = false }
}
function owned(p: any) { return card.value?.entries.filter((e: any) => e.printing_id === p.id && e.quantity > 0).map((e: any) => `${e.condition} × ${e.quantity}`).join(' · ') }
</script>
<template><AppModal :open="!!cardId" :title="card?.name || 'Card details'" wide @close="emit('close')"><div v-if="loading" class="loading-panel">Loading card…</div><p v-else-if="loadError" class="alert error">{{ loadError }}</p><div v-else-if="card" class="card-detail"><div class="detail-art"><label class="printing-visual-selector">Visualise printing<select v-model="visualPrintingId"><option v-for="p in card.printings" :key="p.id" :value="p.id">{{ p.label }}</option></select></label><CardArtwork :card="card" :printing="visualPrinting" :effects-mode="effectsMode || 'subtle'" :low="false" /><p class="data-note">Decorative finish preview only. Selecting a preview does not change ownership or prices.</p><dl class="detail-facts"><dt>Set</dt><dd>{{ card.set_name }}</dd><dt>Number</dt><dd>{{ card.local_id }} · {{ card.language.toUpperCase() }}</dd><dt>Rarity</dt><dd>{{ card.rarity || 'Not supplied' }}</dd><dt>Illustrator</dt><dd>{{ card.illustrator || 'Not supplied' }}</dd></dl></div><div><CardPrices :card-id="card.id" /><h3>Printings & ownership</h3><p class="muted small">Track quantities separately by printing and condition. Binder placement does not change ownership.</p><div v-for="p in card.printings" :key="p.id" class="printing-panel"><div class="printing-heading"><strong>{{ p.label }}</strong><VariantBadges :printing="p" /><span class="badge" :class="p.verified ? 'green' : ''">{{ p.verified ? 'Verified' : p.source === 'manual' ? 'Manual' : 'Provider flag' }}</span></div><small class="muted">{{ owned(p) || 'No copies recorded' }}</small><form v-if="drafts[p.id]" class="printing-form" @submit.prevent="save(p)"><label>Condition<select :value="drafts[p.id].condition" @change="chooseCondition(p, ($event.target as HTMLSelectElement).value)"><option value="NM">Near mint</option><option value="LP">Lightly played</option><option value="MP">Moderately played</option><option value="HP">Heavily played</option><option value="DMG">Damaged</option><option value="UNKNOWN">Not assessed</option></select></label><label>Quantity<input v-model.number="drafts[p.id].quantity" type="number" required min="0" max="9999" step="1" inputmode="numeric" /></label><label class="checkbox-label"><input v-model="drafts[p.id].wishlist" type="checkbox" />Wishlist</label><details class="printing-notes"><summary>Notes</summary><textarea v-model="drafts[p.id].notes" maxlength="2000" placeholder="Location, purchase details or reminders" /></details><button class="button primary small-button" :disabled="busy">Save printing</button></form></div><p class="data-note">Provider flags are not a complete printing checklist. Edition flags with an unspecified finish are deliberately not treated as verified finish combinations.</p><details v-if="auth.state.value.user?.role === 'admin'" class="manual-printing"><summary>Add a missing printing</summary><form class="form-stack" @submit.prevent="addManual"><label>Exact printing label<input v-model="manual.label" required maxlength="120" placeholder="e.g. First Edition Holo" /></label><label class="checkbox-label"><input v-model="manual.verified" type="checkbox" />I have verified this printing exists.</label><button class="button secondary" :disabled="busy">Add printing</button></form></details></div></div></AppModal></template>
