<script setup lang="ts">
const props = defineProps<{ binder: any; disabled?: boolean }>()
const emit = defineEmits<{ saved: []; reload: []; add: [position: number]; inspect: [slot: any]; saving: [value: boolean] }>()
const api = useApi(), notice = useNotice()
const search = ref(''), filter = ref('all'), page = ref(0), selection = ref<number | null>(null), saving = ref(false), error = ref('')
let pending: any = null, alive = true
onBeforeUnmount(() => { alive = false })
const slots = computed<any[]>(() => props.binder.slots || [])
const collected = computed(() => slots.value.filter(slot => slot.owned).length)
const percent = computed(() => slots.value.length ? Math.round(collected.value / slots.value.length * 100) : 0)
const size = computed(() => props.binder.columns * props.binder.rows)
const filtered = computed(() => !!search.value.trim() || filter.value !== 'all')
const matches = computed(() => {
  const needle = search.value.trim().toLocaleLowerCase()
  return slots.value.filter(slot => (filter.value === 'all' || (filter.value === 'collected' ? slot.owned : !slot.owned)) &&
    (!needle || `${slot.name} ${slot.local_id} ${slot.set_name} ${slot.label}`.toLocaleLowerCase().includes(needle)))
})
const pages = computed(() => filtered.value ? Math.max(1, Math.ceil(matches.value.length / size.value)) : props.binder.page_count)
const visible = computed<any[]>(() => filtered.value ? matches.value.slice(page.value * size.value, (page.value + 1) * size.value) :
  Array.from({ length: size.value }, (_, i) => slots.value.find(slot => slot.position === page.value * size.value + i) || { position: page.value * size.value + i, empty: true }))
const spread = ref(true)
const pageNumbers = computed(() => Array.from({length: Math.min(spread.value ? 2 : 1, Math.max(1, pages.value - page.value))}, (_, i) => page.value + i))
function pageItems(number: number): any[] {
  if (filtered.value) return matches.value.slice(number * size.value, (number + 1) * size.value)
  return Array.from({length: size.value}, (_, i) => slots.value.find(slot => slot.position === number * size.value + i) || {position: number * size.value + i, empty: true})
}
const selected = computed(() => slots.value.find(slot => slot.position === selection.value))
watch([search, filter, () => props.binder.id], () => { page.value = 0 })
watch(pages, value => { page.value = Math.min(page.value, Math.max(0, value - 1)) })
watch(() => props.binder.id, () => { selection.value = null; pending = null; error.value = '' })
function select(slot: any) {
  if (saving.value || props.disabled) return
  if (slot.empty) { emit('add', slot.position); return }
  selection.value = slot.position; pending = null; error.value = ''
}
function close() {
  if (saving.value) return
  if (pending) emit('reload')
  selection.value = null; pending = null; error.value = ''
}
function inspect() { if (!saving.value && selected.value) { const slot = selected.value; close(); emit('inspect', slot) } }
async function mark(collected: boolean) {
  if (saving.value || props.disabled || !selected.value) return
  const id = props.binder.id, slot = selected.value
  pending ||= { request_id: crypto.randomUUID(), revision: props.binder.revision, position: slot.position,
    printing_id: slot.printing_id, collected, ownership_version: slot.ownership_version }
  saving.value = true; emit('saving', true); error.value = ''
  try {
    const result = await api('/api/binders/' + id + '/ownership', { method: 'POST', body: { ...pending } })
    if (!alive || id !== props.binder.id) return
    selection.value = null; pending = null; emit('saved')
    notice.show(result.is_collected ? 'Owned in your collection. No duplicate copy was added.' : 'Quick-added copy removed. The card stays in your binder.')
  } catch (e: any) {
    if (!alive || id !== props.binder.id) return
    error.value = errorMessage(e)
    const status = e?.statusCode || e?.status || e?.response?.status
    if (status >= 400 && status < 500) { pending = null; selection.value = null; emit('reload'); notice.show(error.value, 'error') }
  } finally { saving.value = false; if (alive) emit('saving', false) }
}
</script>
<template>
  <section class="collection-quick" data-testid="collection-quick-binder" :aria-busy="saving">
    <div class="collection-quick-summary panel"><div><span class="eyebrow">COLLECTION-SYNCED CHECKLIST</span><h2>{{ collected }} / {{ slots.length }} pockets owned</h2><p>Tap a missing card, then “I have this card”. Its displayed printing becomes owned in your collection and every collection-backed binder.</p></div><strong>{{ percent }}%</strong></div>
    <div class="quick-progress" role="progressbar" :aria-valuenow="percent" aria-valuemin="0" aria-valuemax="100" aria-label="Owned checklist progress"><span :style="{width: percent + '%'}" /></div>
    <div class="quick-tools"><div class="button-row" role="group" aria-label="Filter by ownership"><button v-for="option in ['all','missing','collected']" :key="option" class="button secondary" :aria-pressed="filter === option" @click="filter = option">{{ option === 'all' ? 'All cards' : option === 'collected' ? 'Owned' : 'Missing' }}</button></div><label><span class="sr-only">Search collection binder</span><input v-model="search" type="search" maxlength="100" placeholder="Name, number or set…"></label></div>
    <BinderBook v-model="page" v-model:spread="spread" :pages="pages" :disabled="saving || disabled"><div class="quick-spread" :class="{ 'one-page': !spread }"><div v-for="number in pageNumbers" :key="number" class="quick-page"><div class="quick-page-heading">PAGE {{ number + 1 }}</div><div class="quick-grid" :style="{gridTemplateColumns:'repeat(' + binder.columns + ',minmax(0,1fr))'}">
      <button v-for="slot in pageItems(number)" :key="slot.position" type="button" class="quick-card" data-book-tap :class="{missing:!slot.empty && !slot.owned,owned:slot.owned,empty:slot.empty}" :disabled="saving || disabled" :aria-label="slot.empty ? 'Add card to pocket ' + (slot.position + 1) : slot.name + ', ' + slot.label + ', ' + (slot.owned ? 'owned' : 'missing')" @click="select(slot)">
        <template v-if="!slot.empty"><CardArtwork :card="slot" :printing="slot" effects-mode="off" /><span class="quick-status"><AppIcon :name="slot.owned ? 'check' : 'plus'" :size="13" />{{slot.owned ? 'Owned' : 'Missing'}}</span><strong>{{slot.name}}</strong><small>#{{slot.local_id}} · {{slot.label}}</small><small v-if="slot.owned">{{slot.owned_quantity}} owned in collection</small></template>
        <template v-else><AppIcon name="plus" :size="22" /><span>Add card</span></template>
      </button>
    </div>
    </div><div v-if="spread && pageNumbers.length === 1" class="quick-page empty-book-leaf" aria-hidden="true">End of binder</div></div></BinderBook>
    <p v-if="!visible.length" class="muted">No cards match this filter.</p>

    <UiDisclosure title="About ownership"><p class="data-note">One quick claim means you own at least one copy of the exact displayed printing. Repeated pockets or other binders do not add copies. Prices use your shared collection; an owned marker is not a physical-copy allocation.</p></UiDisclosure>
    <AppModal :open="selection !== null && !!selected" :title="selected?.name || 'Card ownership'" :dismissible="!saving" @close="close">
      <template v-if="selected">
        <div class="quick-selection"><CardArtwork :card="selected" :printing="selected" effects-mode="off" /><div><span class="badge" :class="selected.owned ? 'green' : ''">{{selected.owned ? 'Owned' : 'Missing'}}</span><p>{{selected.set_name}} · #{{selected.local_id}}<br><strong>{{selected.label}}</strong></p><p v-if="selected.owned" class="small">{{selected.owned_quantity}} owned across your collection.</p></div></div>
        <p v-if="error" class="alert error" role="alert">{{error}} Retry to confirm the saved state.</p>
        <button v-if="pending || !selected.owned" class="button primary full" :disabled="saving || disabled" @click="mark(true)">{{saving ? 'Saving…' : pending ? 'Retry the same save' : '+ I have this card'}}</button>
        <button v-else-if="selected.can_quick_remove" class="button secondary full" :disabled="saving || disabled" @click="mark(false)">Remove quick-added copy / mark missing</button>
        <p v-else class="data-note">This printing has detailed or multiple copies. Manage quantities below rather than removing them with one tap.</p>
        <button class="text-button" :disabled="saving" @click="inspect">View card & ownership</button>
        <p class="data-note">New quick-added copies use condition Unknown. Removing a quick-added copy updates all collection-backed binders; it does not remove this pocket.</p>
        <UiDisclosure title="Market prices & history"><CardPrices :card-id="selected.card_id" /></UiDisclosure>
      </template>
    </AppModal>
  </section>
</template>
<style scoped>
.collection-quick-summary{padding:22px;display:flex;align-items:center;justify-content:space-between;gap:20px}.collection-quick-summary h2{margin-bottom:8px}.collection-quick-summary p{font-size:13px;color:var(--muted);max-width:630px;margin:0}.collection-quick-summary>strong{font-size:32px;color:var(--green)}.quick-progress{height:6px;background:var(--line);border-radius:4px;overflow:hidden}.quick-progress span{height:100%;display:block;background:var(--green)}.quick-tools{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;margin:22px 0}.quick-tools>label{flex:1;max-width:330px;min-width:180px}.quick-tools input{margin:0}.quick-tools [aria-pressed=true]{background:var(--surface-soft);border-color:var(--primary);color:var(--primary)}.quick-grid{display:grid;gap:12px;max-width:720px;margin:0 auto;padding:14px;background:var(--surface-soft);border:1px solid var(--line);border-radius:14px}.quick-card{background:var(--paper);border:2px solid transparent;border-radius:9px;padding:5px;display:flex;flex-direction:column;gap:6px;min-width:0;overflow:hidden;text-align:left}.quick-card.owned{border-color:var(--green)}.quick-card.missing :deep(.card-artwork){filter:grayscale(1);opacity:.45}.quick-card strong{font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}.quick-card small{font-size:10px;color:var(--muted);overflow-wrap:anywhere}.quick-status{display:flex;gap:5px;align-items:center;justify-content:center;background:var(--surface-soft);font-size:10px;padding:5px;border-radius:4px;width:100%}.quick-card.owned .quick-status{background:var(--success-soft);color:var(--green)}.quick-card.empty{border:1px dashed var(--muted);background:transparent;aspect-ratio:63/101;align-items:center;justify-content:center}.quick-selection{display:grid;grid-template-columns:110px 1fr;gap:20px;align-items:center;margin-bottom:20px}.quick-selection p{font-size:13px;margin:10px 0}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}@media(max-width:560px){.quick-grid{gap:5px;padding:7px}.quick-card{padding:3px;gap:4px}.quick-card strong{font-size:10px}.quick-card small,.quick-status{font-size:9px}.collection-quick-summary{padding:16px;align-items:flex-start}.collection-quick-summary>strong{font-size:26px}.quick-tools>label{max-width:none;flex-basis:100%}}

.empty-book-leaf{display:grid;place-items:center;min-height:180px;color:var(--muted);font-size:11px}

.quick-spread{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;max-width:1120px;margin-inline:auto}.quick-spread.one-page{grid-template-columns:minmax(0,1fr);max-width:720px}.quick-page{min-width:0;background:var(--surface-soft);border:1px solid var(--line);border-radius:12px;padding:14px}.quick-page-heading{font-size:10px;letter-spacing:.08em;color:var(--muted);margin-bottom:12px}.quick-grid{max-width:none;padding:0;border:0;border-radius:0}.collection-quick-summary{padding:14px 18px}.collection-quick-summary .eyebrow{display:none}.collection-quick-summary h2{font-size:20px;margin:0 0 5px}.collection-quick-summary p{font-size:12px}.quick-tools{margin:16px 0}
@media(max-width:560px){.quick-spread{gap:7px}.quick-page{padding:7px 5px}.quick-page-heading{font-size:8px;margin-bottom:10px}.quick-spread:not(.one-page) .quick-card strong{font-size:8px}.quick-spread:not(.one-page) .quick-card small,.quick-spread:not(.one-page) .quick-status{font-size:7px}.quick-spread:not(.one-page) .quick-status svg{width:9px}.quick-spread:not(.one-page) .quick-card.empty{font-size:8px}}
</style>
