<script setup lang="ts">
import { gameName } from '../../../shared/games.mjs'
import { resolvedAppearance } from '../../../shared/appearance.mjs'
import { collectionSyncAllowed } from '../../../shared/collection-sync.mjs'
const route = useRoute(), api = useApi(), notice = useNotice()
const binder = ref<any>(null), loading = ref(true), busy = ref(false), page = ref(0), wide = ref(true), finePointer = ref(false), loadError = ref('')
const binderSection = ref('cards'), valueOpened = ref(false)
function closeBinderTools(event: MouseEvent) {
  if (!(event.target as HTMLElement).closest('button, a')) return
  const details = (event.currentTarget as HTMLElement).closest('details')
  if (details) { details.open = false; details.querySelector('summary')?.focus() }
}
const tracking = computed(() => binder.value?.binder_type === 'tracking')
const managedGames = ref<any>(null)
const gameWritable = computed(() => !!managedGames.value?.games?.some((g: any) => g.code === (binder.value?.game || 'pokemon') && g.manageable))
const quickView = ref<boolean | null>(null), syncAccess = ref(false), scanAccess = ref(false), summaryTick = ref(0)
const showQuickView = computed(() => !tracking.value && syncAccess.value && gameWritable.value && (quickView.value ?? binder.value?.quick_tracking ?? false))
let syncTimer: ReturnType<typeof setInterval> | undefined, loadSequence = 0, alive = true
async function loadSyncAccess() {
  try { const [state, games] = await Promise.all([api('/api/account/membership'), api('/api/account/games')]); if (alive) { syncAccess.value = collectionSyncAllowed(state.access); scanAccess.value = state.access?.features?.some((f: any) => f.code === 'collection') === true; managedGames.value = games } }
  catch { if (alive) { syncAccess.value = false; scanAccess.value = false } }
}
function refreshOwnership() {
  if (!busy.value && !loading.value && binder.value?.binder_type === 'collection' && !settingsOpen.value && !appearanceOpen.value && !cardId.value && document.visibilityState === 'visible') { load(); loadSyncAccess() }
}
onMounted(() => { loadSyncAccess(); window.addEventListener('focus', refreshOwnership); syncTimer = setInterval(refreshOwnership, 30000) })
onBeforeUnmount(() => { alive = false; loadSequence++; clearInterval(syncTimer); window.removeEventListener('focus', refreshOwnership) })
function convertedBinder() { quickView.value = true; load() }
function inspectQuickCard(slot: any) { selectedPrintingId.value = slot.printing_id; cardId.value = slot.card_id }

const appearanceOpen = ref(false), selectedPrintingId = ref('')
const appearance = computed(() => resolvedAppearance(binder.value?.appearance, binder.value?.color))
const pickerOpen = ref(false), target = ref(0), actions = ref<number | null>(null), moving = ref<number | null>(null), cardId = ref<string | null>(null)
const settingsOpen = ref(false), sharingOpen = ref(false), deleteOpen = ref(false), deleteTitle = ref(''), form = reactive<any>({})
let pointer: MediaQueryList
const updateMedia = () => { finePointer.value = pointer.matches }
onMounted(() => { pointer = matchMedia('(pointer: fine)'); updateMedia(); pointer.addEventListener('change', updateMedia); load() })
onBeforeUnmount(() => { pointer?.removeEventListener('change', updateMedia) })
async function load() {
  const request = ++loadSequence, id = String(route.params.id)
  loading.value = true; loadError.value = ''
  try {
    const result = await api('/api/binders/' + id)
    if (!alive || request !== loadSequence || String(route.params.id) !== id) return
    binder.value = result; summaryTick.value++; page.value = Math.min(page.value, binder.value.page_count - 1)
  } catch (e) { if (alive && request === loadSequence) loadError.value = errorMessage(e) }
  finally { if (alive && request === loadSequence) loading.value = false }
}
const pageSize = computed(() => binder.value ? binder.value.columns * binder.value.rows : 9)
const pageNumbers = computed(() => binder.value ? Array.from({ length: Math.min(wide.value ? 2 : 1, binder.value.page_count - page.value) }, (_, i) => page.value + i) : [])
const slots = computed<Record<number, any>>(() => Object.fromEntries((binder.value?.slots || []).map((s: any) => [s.position, s])))
const shareUrl = computed(() => binder.value?.share_token && import.meta.client ? location.origin + '/shared/' + binder.value.share_token : '')
async function operation(body: any) {
  if (busy.value) return
  busy.value = true
  try { await api('/api/binders/' + binder.value.id + '/slots', { method: 'POST', body: { ...body, revision: binder.value.revision } }); await load(); moving.value = null }
  catch (e) { moving.value = null; notice.show(errorMessage(e), 'error'); await load() } finally { busy.value = false }
}
function trackingMarked(result: any) {
  if (!binder.value || binder.value.id !== result.binder_id) return
  if (result.replayed || result.revision > binder.value.revision + 1) { load(); return }
  if (result.revision < binder.value.revision) return
  const slot = binder.value.slots.find((s: any) => s.position === result.position && s.printing_id === result.printing_id)
  if (slot) slot.is_collected = result.is_collected
  binder.value.revision = result.revision; binder.value.progress = result.progress
}
function addTrackingCard(position: number) { if (busy.value) return; target.value = position; pickerOpen.value = true }
function selectSlot(position: number) {
  if (busy.value) return
  if (moving.value !== null) { if (moving.value === position) { moving.value = null; return }; operation({ action: 'swap', source: moving.value, target: position }); return }
  if (slots.value[position]) actions.value = position
  else { target.value = position; pickerOpen.value = true }
}
function replaceSlot() { target.value = actions.value!; actions.value = null; pickerOpen.value = true }
async function place(printing_id: string) { pickerOpen.value = false; await operation({ action: 'place', target: target.value, printing_id }) }
function drag(event: DragEvent, position: number) { event.dataTransfer?.setData('application/x-cardshelf-slot', JSON.stringify({ binder: binder.value.id, position })); if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move' }
function drop(event: DragEvent, position: number) {
  try { const payload = JSON.parse(event.dataTransfer?.getData('application/x-cardshelf-slot') || '{}'); if (payload.binder === binder.value.id && Number.isInteger(payload.position)) operation({ action: 'swap', source: payload.position, target: position }) } catch { /* Ignore unrelated drops. */ }
}
function editSettings() { Object.assign(form, binder.value); settingsOpen.value = true }
async function saveSettings() {
  busy.value = true
  try { await api('/api/binders/' + binder.value.id, { method: 'PATCH', body: { ...form, revision: form.revision } }); settingsOpen.value = false; await load(); notice.show('Binder settings saved.') }
  catch (e) { notice.show(errorMessage(e), 'error') } finally { busy.value = false }
}
async function share(enabled: boolean) {
  busy.value = true
  try { await api('/api/binders/' + binder.value.id + '/share', { method: 'POST', body: { enabled, revision: binder.value.revision } }); await load(); notice.show(enabled ? 'A new sharing link has been created.' : 'Sharing link disabled.') }
  catch (e) { notice.show(errorMessage(e), 'error') } finally { busy.value = false }
}
async function copyLink() { try { await navigator.clipboard.writeText(shareUrl.value); notice.show('Sharing link copied.') } catch { notice.show('Select and copy the link from the field.', 'error') } }
async function removeBinder() {
  busy.value = true
  try { await api('/api/binders/' + binder.value.id, { method: 'DELETE', body: { revision: binder.value.revision, confirm_title: deleteTitle.value } }); await navigateTo('/binders') }
  catch (e) { notice.show(errorMessage(e), 'error') } finally { busy.value = false }
}
function moveSelected() { moving.value = actions.value; actions.value = null }
async function clearSelected() { const position = actions.value; actions.value = null; await operation({ action: 'clear', target: position }) }
function inspectSelected() { selectedPrintingId.value = slots.value[actions.value!]?.printing_id || ''; cardId.value = slots.value[actions.value!]?.card_id || null; actions.value = null }
</script>
<template><NuxtLink to="/binders" class="text-button back-link"><AppIcon name="left" :size="16" />All binders</NuxtLink><p v-if="loadError" class="alert error">{{ loadError }}<button class="text-button" @click="load">Reload binder</button></p><div v-if="loading && !binder" class="loading-panel">Opening your binder…</div><template v-if="binder"><p v-if="managedGames && !gameWritable" class="alert info">This game is read-only under your current access. Existing records are preserved. <NuxtLink to="/games">Review Card games</NuxtLink>.</p><header class="page-heading binder-heading"><div class="binder-title-block"><BinderCover v-if="!tracking" :binder="binder" class="binder-heading-cover" /><div><span class="eyebrow">{{ binder.columns }} × {{ binder.rows }} POCKETS · {{ binder.page_count }} PAGES</span><h1>{{ binder.title }}</h1><span class="badge">{{ gameName(binder.game || 'pokemon') }}</span><span class="badge" :class="tracking ? 'green' : 'purple'">{{ tracking ? 'Tracking binder' : 'Collection binder' }}</span><UiDisclosure v-if="binder.description" title="About this binder" class="binder-description"><p class="small">{{ binder.description }}</p></UiDisclosure></div></div><div class="button-row binder-primary-actions"><NuxtLink :to="'/binders/complete/' + binder.id" class="button secondary" aria-label="Complete this binder">Find missing</NuxtLink><NuxtLink v-if="scanAccess && gameWritable && binder.game === 'pokemon'" :to="{ path: '/scan', query: { binder: binder.id } }" class="button primary">Scan a card</NuxtLink><button v-if="!tracking" class="button secondary" :disabled="busy" @click="appearanceOpen = true"><AppIcon name="settings" :size="17" />Appearance</button><details class="binder-tools"><summary class="button secondary" aria-label="Binder tools">More</summary><div class="binder-tools-actions" @click="closeBinderTools"><button v-if="!tracking && syncAccess" class="button secondary" :disabled="busy" :aria-pressed="showQuickView" @click="quickView = !showQuickView; moving = null">{{ showQuickView ? 'Layout view' : 'Quick tracking' }}</button><button class="button secondary" :disabled="busy" @click="sharingOpen = true"><AppIcon name="share" :size="17" />Share</button><NuxtLink :to="'/print/' + binder.id" class="button secondary"><AppIcon name="print" :size="17" />Print</NuxtLink><button class="button secondary" aria-label="Binder settings" :disabled="busy" @click="editSettings"><AppIcon name="settings" />Settings</button></div></details></div></header><BinderCollectionSync v-if="tracking && syncAccess && gameWritable" :binder="binder" :disabled="busy" @converted="convertedBinder" @saving="busy = $event" /><TrackingBinder :read-only="!gameWritable" v-if="tracking" :key="binder.id" :binder="binder" :disabled="busy" @marked="trackingMarked" @saving="busy = $event" @reload="load" @add="addTrackingCard" /><template v-else><div class="binder-view-switch" role="group" aria-label="Binder view"><button class="button secondary" :class="{ selected: binderSection === 'cards' }" :aria-pressed="binderSection === 'cards'" @click="binderSection = 'cards'"><AppIcon name="cards" :size="17" />Cards</button><button class="button secondary" :class="{ selected: binderSection === 'value' }" :aria-pressed="binderSection === 'value'" @click="binderSection = 'value'; valueOpened = true"><AppIcon name="grid" :size="17" />Value & history</button></div><PriceSummary v-if="valueOpened" v-show="binderSection === 'value'" :binder-id="binder.id" :refresh-key="summaryTick" expanded /><div v-show="binderSection === 'cards'"><CollectionQuickBinder v-if="showQuickView" :key="binder.id" :binder="binder" :disabled="busy || loading" @saved="load" @reload="load" @saving="busy = $event" @add="addTrackingCard" @inspect="inspectQuickCard" /><template v-else><div class="binder-toolbar"><span><strong>{{ binder.slots.length }}</strong> pockets planned <span class="toolbar-divider">/</span> {{ binder.columns * binder.rows * binder.page_count }} total</span><span class="pocket-legend"><span class="status-dot" />Owned printing<span class="empty-dot" />Planned / missing</span></div><div v-if="moving !== null" class="alert info move-banner"><AppIcon name="move" /><span>Choose another pocket to move or swap this card. You can change pages first.</span><button class="text-button" @click="moving = null">Cancel</button></div><UiDisclosure v-else class="binder-hint" title="How to arrange cards"><p>{{ finePointer ? 'Drag cards to move or swap them, or click a pocket for more options.' : 'Tap a pocket to add a card. Tap a filled pocket and choose Move to rearrange it.' }}</p></UiDisclosure><BinderBook v-model="page" v-model:spread="wide" :pages="binder.page_count" :disabled="busy"><BinderSurface :binder="binder" :class="{ 'single-page': !wide, saving: busy }"><div v-for="p in pageNumbers" :key="p" class="binder-page"><div class="binder-page-heading"><span>PAGE {{ p + 1 }}</span><small>{{ binder.columns * binder.rows }} pockets</small></div><div class="pocket-grid" :style="{ gridTemplateColumns: 'repeat(' + binder.columns + ', minmax(0, 1fr))' }"><button v-for="i in pageSize" :key="i" class="pocket" data-book-tap :class="{ filled: slots[p * pageSize + i - 1], moving: moving === p * pageSize + i - 1, 'move-target': moving !== null }" :data-position="p * pageSize + i - 1" :aria-label="'Page ' + (p + 1) + ', pocket ' + i + (slots[p * pageSize + i - 1] ? ': ' + slots[p * pageSize + i - 1].name + ', ' + slots[p * pageSize + i - 1].label : ': empty')" :disabled="busy" :draggable="finePointer && !!slots[p * pageSize + i - 1]" @dragstart="drag($event, p * pageSize + i - 1)" @dragover.prevent @drop.prevent="drop($event, p * pageSize + i - 1)" @click="selectSlot(p * pageSize + i - 1)"><template v-if="slots[p * pageSize + i - 1]"><CardArtwork :card="slots[p * pageSize + i - 1]" :printing="slots[p * pageSize + i - 1]" :effects-mode="String(appearance.effects_mode)" /><span class="pocket-status" :class="{ owned: slots[p * pageSize + i - 1].owned }"><AppIcon v-if="slots[p * pageSize + i - 1].owned" name="check" :size="12" /></span><span class="pocket-caption">{{ slots[p * pageSize + i - 1].label }}</span></template><template v-else><AppIcon name="plus" :size="22" /><small>Add card</small><span class="pocket-number">{{ i }}</span></template></button></div></div><div v-if="wide && pageNumbers.length === 1" class="binder-page blank-book-page" aria-hidden="true"><span>End of binder</span></div></BinderSurface></BinderBook><UiDisclosure title="Ownership & pockets"><p class="data-note">An owned indicator means you own this printing; it does not reserve a specific physical copy. Repeated placements never increase collection quantities.</p></UiDisclosure></template></div></template></template><CardPicker :game="binder?.game || 'pokemon'" :open="pickerOpen" @close="pickerOpen = false" @select="place" /><BinderAppearance v-if="!tracking" :open="appearanceOpen" :binder="binder" @close="appearanceOpen = false" @saved="load" /><CardDialog v-if="!tracking" :card-id="cardId" :printing-id="selectedPrintingId" :effects-mode="String(appearance.effects_mode)" @close="cardId = null" @saved="load" /><AppModal :open="actions !== null" :title="actions !== null ? slots[actions]?.name || 'Pocket options' : 'Pocket options'" @close="actions = null"><div class="action-menu"><button @click="inspectSelected"><AppIcon name="cards" />View card & ownership</button><button @click="moveSelected"><AppIcon name="move" />Move or swap this card</button><button @click="replaceSlot"><AppIcon name="refresh" />Choose a different card</button><button class="danger-text" @click="clearSelected"><AppIcon name="close" />Clear this pocket only</button></div><p class="data-note">Clearing a pocket does not remove cards from your collection.</p></AppModal><AppModal :open="settingsOpen" title="Binder settings" @close="settingsOpen = false"><form class="form-stack" @submit.prevent="saveSettings"><label>Binder name<input v-model="form.title" required maxlength="100" /></label><label>Description<textarea v-model="form.description" maxlength="1000" /></label><div v-if="!tracking" class="form-columns"><label>Columns<select v-model.number="form.columns"><option :value="2">2</option><option :value="3">3</option><option :value="4">4</option></select></label><label>Rows<select v-model.number="form.rows"><option :value="2">2</option><option :value="3">3</option><option :value="4">4</option></select></label><label>Pages<input v-model.number="form.page_count" required type="number" min="1" max="60" /></label></div><label v-if="!tracking">Cover colour<input v-model="form.color" type="color" /></label><p v-if="!tracking" class="alert info">Changing the grid keeps absolute pocket order. Occupied pockets cannot be removed by shrinking the binder.</p><button class="button primary" :disabled="busy">Save settings</button><button type="button" class="text-button danger-text" @click="settingsOpen = false; deleteOpen = true">Delete this binder</button></form></AppModal><AppModal :open="sharingOpen" title="Read-only sharing" @close="sharingOpen = false"><p v-if="tracking" class="muted">Anyone with this link can view this checklist, including its collected/missing marks and completion progress. Your detailed inventory, notes and other binders remain private.</p><p v-else class="muted">Anyone with this link can view the binder title, description, outside cover, inside background and planned cards. Your quantities, notes, account details and other binders are not shared.</p><template v-if="binder?.share_token"><label>Sharing link<input :value="shareUrl" readonly @focus="($event.target as HTMLInputElement).select()" /></label><div class="button-row spaced"><button class="button primary" @click="copyLink">Copy link</button><button class="button secondary" :disabled="busy" @click="share(true)">Rotate link</button><button class="text-button danger-text" :disabled="busy" @click="share(false)">Disable sharing</button></div></template><button v-else class="button primary" :disabled="busy" @click="share(true)">Enable sharing</button><p class="data-note">Rotating or disabling a link revokes the old URL. It cannot recall screenshots or copies already made by viewers.</p></AppModal><AppModal :open="deleteOpen" title="Delete binder" @close="deleteOpen = false"><form class="form-stack" @submit.prevent="removeBinder"><p>This permanently removes this binder and its layout. Your collection entries are not deleted.</p><label>Type “{{ binder?.title }}” to confirm<input v-model="deleteTitle" required autocomplete="off" /></label><button class="button danger" :disabled="busy || deleteTitle !== binder?.title">Delete binder</button></form></AppModal></template>

<style scoped>
@media(max-width:760px){.binder-primary-actions .binder-tools{flex-basis:100%;min-width:0}.binder-tools>summary{width:max-content}.binder-tools .binder-tools-actions{position:static;min-width:0;width:100%;max-width:100%;margin-top:8px;box-shadow:none}}
.binder-heading{gap:16px;margin-bottom:18px}.binder-heading h1{font-size:27px;overflow-wrap:anywhere}.binder-title-block{gap:14px}.binder-heading-cover{width:58px;height:78px;flex-basis:58px;padding:9px 6px 9px 14px}.binder-heading .eyebrow{font-size:9px}.binder-heading .badge{margin-top:7px}.binder-description{margin:7px 0 0;border-top:0}.binder-description :deep(summary){font-size:11px;padding:5px 0;min-height:32px}.binder-primary-actions{gap:8px;align-items:center}.binder-tools{position:relative}.binder-tools>summary{list-style:none;min-height:44px;cursor:pointer}.binder-tools>summary::-webkit-details-marker{display:none}.binder-tools-actions{position:absolute;right:0;top:calc(100% + 6px);z-index:12;min-width:220px;display:flex;flex-direction:column;gap:6px;padding:10px;border:1px solid var(--line);border-radius:12px;background:var(--paper);box-shadow:0 8px 24px #0002}.binder-tools-actions .button,.binder-tools-actions .icon-button{width:100%;margin:0;justify-content:flex-start;min-height:44px}.binder-view-switch{display:flex;gap:8px;margin:10px 0 16px}.binder-view-switch .button{min-height:44px}.binder-view-switch .selected{background:var(--accent-soft);border-color:var(--primary);color:var(--primary)}.binder-hint{display:block;margin:8px 0 12px;font-size:12px}.binder-hint p{margin:4px 0}.binder-toolbar{padding:12px 16px}
@media(max-width:600px){.binder-heading h1{font-size:23px}.binder-heading-cover{width:46px;height:64px;flex-basis:46px}.binder-heading .button,.binder-heading .icon-button{min-height:44px;font-size:11px}.binder-tools-actions{max-width:calc(100vw - 40px)}.binder-view-switch .button{font-size:12px}.binder-toolbar{gap:8px;font-size:11px}}


.binder-book :deep(.binder-stage){grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.binder-book :deep(.binder-stage.single-page){grid-template-columns:minmax(0,1fr);max-width:720px;margin-inline:auto}.blank-book-page{display:grid;place-items:center;min-height:180px;color:var(--muted);font-size:12px}.binder-book :deep(.binder-page){min-width:0}
@media(max-width:600px){.binder-book :deep(.binder-stage){padding:7px;gap:7px}.binder-book :deep(.binder-page){padding:6px}.binder-book :deep(.pocket-grid){gap:4px}.binder-book :deep(.pocket-caption){font-size:7px}.binder-book :deep(.binder-page-heading){font-size:8px;gap:4px}.binder-book :deep(.binder-page-heading small){display:none}.binder-book :deep(.pocket>small){font-size:8px}}
</style>
