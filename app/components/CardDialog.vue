<script setup lang="ts">
import { printingWishlisted, wishlistRevisions, wishlistDraft } from '../../shared/wishlist.mjs'
const props = defineProps<{ cardId: string | null; printingId?: string; effectsMode?: string }>(), emit = defineEmits(['close', 'saved'])
const api = useApi(), auth = useAuth(), notice = useNotice()
const card = ref<any>(null), loading = ref(false), busy = ref(false), loadError = ref('')
const drafts = reactive<Record<string, any>>({}), manual = reactive({ label: '', verified: false })
const visualPrintingId = ref(''), wishlistBusy = ref(false), wishlistError = ref('')
const visualPrinting = computed(() => card.value?.printings.find((p: any) => p.id === visualPrintingId.value))
const visualWishlisted = computed(() => printingWishlisted(card.value?.entries || [], visualPrintingId.value))
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
    visualPrintingId.value = next.printings.find((p: any) => p.id === visualPrintingId.value)?.id || next.printings.find((p: any) => p.id === props.printingId)?.id || next.printings[0]?.id || ''
    for (const key of Object.keys(drafts)) delete drafts[key]
    for (const p of next.printings) chooseCondition(p, next.entries.find((e: any) => e.printing_id === p.id && e.quantity > 0)?.condition || next.entries.find((e: any) => e.printing_id === p.id && e.wishlist)?.condition || 'NM')
  } catch (e) { if (request === sequence) loadError.value = errorMessage(e) }
  finally { if (request === sequence) loading.value = false }
}
watch(() => props.cardId, id => { card.value = null; visualPrintingId.value = ''; wishlistError.value = ''; if (id) load(); else sequence++ }, { immediate: true })
watch(() => props.printingId, id => { if (card.value?.printings.some((p: any) => p.id === id)) visualPrintingId.value = id || '' })
watch(visualPrintingId, () => { wishlistError.value = '' })
onBeforeUnmount(() => { sequence++ })
async function toggleWishlist() {
  if (busy.value || loading.value || !card.value || !visualPrinting.value) return
  const targetCardId = card.value.id, printingId = visualPrinting.value.id, request = sequence
  const wished = !visualWishlisted.value, previousEntries = card.value.entries
  const input = { printing_id: printingId, wishlist: wished, revisions: wishlistRevisions(previousEntries, printingId) }
  busy.value = true; wishlistBusy.value = true; wishlistError.value = ''
  const stillOpen = () => request === sequence && props.cardId === targetCardId && card.value?.id === targetCardId
  try {
    const result = await api('/api/collection/wishlist', { method: 'POST', body: input })
    if (stillOpen()) {
      card.value.entries = [...card.value.entries.filter((e: any) => e.printing_id !== printingId), ...result.entries]
      const nextDraft = wishlistDraft(drafts[printingId], result.entries, previousEntries)
      if (nextDraft) drafts[printingId] = nextDraft
    }
    notice.show(wished ? 'Printing added to your wishlist.' : 'Printing removed from your wishlist.')
    emit('saved')
  } catch (e: any) {
    if (stillOpen()) {
      wishlistError.value = errorMessage(e)
      if (e?.statusCode === 409 || e?.status === 409 || e?.response?.status === 409) {
        // Refresh saved state without discarding or silently rebasing unsaved ownership edits.
        try {
          const fresh = await api('/api/cards/' + encodeURIComponent(targetCardId))
          if (stillOpen()) {
            card.value.entries = fresh.entries
            wishlistError.value = 'The printing changed elsewhere. Its saved wishlist is refreshed; your unsaved ownership edits are retained. Review or reopen the card before saving ownership.'
          }
        } catch { /* Keep the conflict visible and the last confirmed data intact. */ }
      }
    }
  } finally { busy.value = false; wishlistBusy.value = false }
}
async function save(p: any) {
  if (busy.value || loading.value) return
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
  if (busy.value || loading.value) return
  const targetCardId = props.cardId
  if (!targetCardId) return
  busy.value = true
  try { await api('/api/cards/' + encodeURIComponent(targetCardId) + '/printings', { method: 'POST', body: { ...manual } }); manual.label = ''; manual.verified = false; if (props.cardId === targetCardId) await load(); notice.show('Manual printing added.') }
  catch (e) { notice.show(errorMessage(e), 'error') } finally { busy.value = false }
}
function owned(p: any) { return card.value?.entries.filter((e: any) => e.printing_id === p.id && e.quantity > 0).map((e: any) => `${e.condition} × ${e.quantity}`).join(' · ') }
</script>
<template><AppModal :open="!!cardId" :title="card?.name || 'Card details'" wide @close="emit('close')"><div v-if="loading" class="loading-panel">Loading card…</div><p v-else-if="loadError" class="alert error">{{ loadError }}</p><div v-else-if="card" class="card-detail"><div class="detail-art"><label class="printing-visual-selector">Visualise printing<select v-model="visualPrintingId" :disabled="busy"><option v-for="p in card.printings" :key="p.id" :value="p.id">{{ p.label }}</option></select></label><CardArtwork :card="card" :printing="visualPrinting" :effects-mode="effectsMode || 'subtle'" :low="false" /><p class="data-note">Decorative finish preview only. Selecting a preview does not change ownership or prices.</p>
<section v-if="visualPrinting" class="preview-wishlist" aria-label="Selected printing wishlist">
  <button type="button" class="button secondary wishlist-toggle" :class="{ 'is-wishlisted': visualWishlisted }"
    :disabled="busy || loading" :aria-pressed="visualWishlisted" :aria-busy="wishlistBusy"
    :aria-label="(visualWishlisted ? 'Remove from wishlist: ' : 'Add to wishlist: ') + card.name + ' · ' + visualPrinting.label"
    @click="toggleWishlist">
    <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z" /></svg>
    {{ wishlistBusy ? 'Saving wishlist…' : visualWishlisted ? 'Remove from wishlist' : 'Add to wishlist' }}
  </button>
  <p class="small muted">{{ visualPrinting.label }} · {{ visualWishlisted ? 'On your wishlist' : 'Not on your wishlist' }}</p>
  <p class="small muted">Saves immediately for this printing only. Owned quantities and notes are unchanged.</p>
  <p v-if="wishlistError" class="alert error" role="alert">{{ wishlistError }}</p>
</section>
<dl class="detail-facts"><dt>Set</dt><dd>{{ card.set_name }}</dd><dt>Number</dt><dd>{{ card.local_id }} · {{ card.language.toUpperCase() }}</dd><dt>Rarity</dt><dd>{{ card.rarity || 'Not supplied' }}</dd><dt>Illustrator</dt><dd>{{ card.illustrator || 'Not supplied' }}</dd></dl></div><div><CardPrices :card-id="card.id" /><h3>Printings & ownership</h3><p class="muted small">Track quantities separately by printing and condition. Binder placement does not change ownership.</p><div v-for="p in card.printings" :key="p.id" class="printing-panel"><div class="printing-heading"><strong>{{ p.label }}</strong><VariantBadges :printing="p" /><span class="badge" :class="p.verified ? 'green' : ''">{{ p.verified ? 'Verified' : p.source === 'manual' ? 'Manual' : 'Provider flag' }}</span></div><small class="muted">{{ owned(p) || 'No copies recorded' }}</small><form v-if="drafts[p.id]" class="printing-form" @submit.prevent="save(p)"><label>Condition<select :disabled="busy" :value="drafts[p.id].condition" @change="chooseCondition(p, ($event.target as HTMLSelectElement).value)"><option value="NM">Near mint</option><option value="LP">Lightly played</option><option value="MP">Moderately played</option><option value="HP">Heavily played</option><option value="DMG">Damaged</option><option value="UNKNOWN">Not assessed</option></select></label><label>Quantity<input :disabled="busy" v-model.number="drafts[p.id].quantity" type="number" required min="0" max="9999" step="1" inputmode="numeric" /></label><label class="checkbox-label"><input :disabled="busy" v-model="drafts[p.id].wishlist" type="checkbox" />Wishlist</label><details class="printing-notes"><summary>Notes</summary><textarea :disabled="busy" v-model="drafts[p.id].notes" maxlength="2000" placeholder="Location, purchase details or reminders" /></details><button class="button primary small-button" :disabled="busy">Save printing</button></form></div><p class="data-note">Provider flags are not a complete printing checklist. Edition flags with an unspecified finish are deliberately not treated as verified finish combinations.</p><details v-if="auth.state.value.user?.role === 'admin'" class="manual-printing"><summary>Add a missing printing</summary><form class="form-stack" @submit.prevent="addManual"><label>Exact printing label<input v-model="manual.label" required maxlength="120" placeholder="e.g. First Edition Holo" /></label><label class="checkbox-label"><input v-model="manual.verified" type="checkbox" />I have verified this printing exists.</label><button class="button secondary" :disabled="busy">Add printing</button></form></details></div></div></AppModal></template>
<style scoped>
.preview-wishlist{grid-column:1/-1;min-width:0;margin:0 0 20px;padding:14px 0;border-bottom:1px solid var(--line,#dfe3ec)}
.detail-facts{grid-column:1/-1}
.wishlist-toggle{width:100%;min-height:44px;justify-content:center;white-space:normal;text-align:center;gap:10px}
.wishlist-toggle svg{flex:none}.wishlist-toggle.is-wishlisted svg{fill:currentColor}
.preview-wishlist p{margin:9px 0 0;overflow-wrap:anywhere}.preview-wishlist .alert{margin-top:12px}
</style>
