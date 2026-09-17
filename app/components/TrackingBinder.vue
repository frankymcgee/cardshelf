<script setup lang="ts">
import { trackingProgress } from '../../shared/binder-types.mjs'
const props = withDefaults(defineProps<{ binder: any; readOnly?: boolean; disabled?: boolean }>(), { readOnly: false, disabled: false })
const emit = defineEmits<{ marked: [result: any]; reload: []; add: [position: number]; saving: [value: boolean] }>()
const api = useApi(), notice = useNotice()
const search = ref(''), filter = ref('all'), page = ref(0), selection = ref<number | null>(null), saving = ref(false), saveError = ref('')
let pending: any = null, alive = true
onBeforeUnmount(() => { alive = false })
const slots = computed<any[]>(() => props.binder.slots || [])
const progress = computed(() => trackingProgress(slots.value))
const size = computed(() => props.binder.columns * props.binder.rows)
const filtered = computed(() => !!search.value.trim() || filter.value !== 'all')
const matches = computed(() => {
  const needle = search.value.trim().toLocaleLowerCase()
  return slots.value.filter(s => (filter.value === 'all' || (filter.value === 'collected' ? s.is_collected : !s.is_collected)) &&
    (!needle || `${s.name} ${s.local_id} ${s.set_name} ${s.label}`.toLocaleLowerCase().includes(needle)))
})
const pages = computed(() => filtered.value ? Math.max(1, Math.ceil(matches.value.length / size.value)) : props.binder.page_count)
const visible = computed<any[]>(() => filtered.value ? matches.value.slice(page.value * size.value, (page.value + 1) * size.value) :
  Array.from({ length: size.value }, (_, i) => slots.value.find(s => s.position === page.value * size.value + i) || { position: page.value * size.value + i, empty: true }))
const selected = computed(() => slots.value.find(s => s.position === selection.value))
const designMode = computed(() => (props.binder.tracking_selection || props.binder.generation?.options?.selection) === 'designs')
watch([search, filter, () => props.binder.id], () => { page.value = 0 })
watch(pages, value => { page.value = Math.min(page.value, value - 1) })
watch(() => props.binder.id, () => { selection.value = null; pending = null; saveError.value = '' })
function label(s: any) { return designMode.value ? 'Card design · any printing' : s.label }
function select(s: any) {
  if (props.readOnly || saving.value || props.disabled) return
  if (s.empty) { emit('add', s.position); return }
  selection.value = s.position; pending = null; saveError.value = ''
}
function closeSelection() {
  if (saving.value) return
  if (saveError.value) emit('reload')
  selection.value = null; pending = null; saveError.value = ''
}
async function mark(collected: boolean) {
  if (props.readOnly || props.disabled || saving.value || !selected.value) return
  const id = props.binder.id, slot = selected.value
  pending ||= { request_id: crypto.randomUUID(), revision: props.binder.revision, position: slot.position, printing_id: slot.printing_id, collected }
  saving.value = true; emit('saving', true); saveError.value = ''
  try {
    const result = await api('/api/binders/' + id + '/tracking', { method: 'POST', body: { ...pending } })
    if (!alive || props.binder.id !== id) return
    emit('marked', result)
    notice.show(result.is_collected ? 'Marked collected.' : 'Marked missing.')
    selection.value = null; pending = null
  } catch (error: any) {
    if (!alive || props.binder.id !== id) return
    const status = error?.statusCode || error?.status || error?.response?.status
    saveError.value = errorMessage(error)
    if (status >= 400 && status < 500) { pending = null; selection.value = null; emit('reload'); notice.show(saveError.value, 'error') }
    // Network/5xx failures retain the same request ID for safe explicit retry.
  } finally { saving.value = false; if (alive) emit('saving', false) }
}
</script>
<template>
  <section class="tracking-binder" data-testid="tracking-binder" :aria-busy="saving">
    <div class="tracking-summary">
      <div><span class="tracking-kicker">YOUR COLLECTION CHECKLIST</span><h2>{{ progress.collected }} <span>/ {{ progress.total }} collected</span></h2><p>{{ progress.missing ? progress.missing + ' still to find. One card closer, every time.' : progress.total ? 'Checklist complete. Every card accounted for.' : 'Add checklist cards to start tracking.' }}</p></div>
      <strong class="tracking-percent" aria-label="Completion percentage">{{ progress.percent }}<small>%</small></strong>
    </div>
    <div class="tracking-progress" role="progressbar" :aria-valuenow="progress.percent" aria-valuemin="0" aria-valuemax="100" aria-label="Checklist completion"><span :style="{ width: progress.percent + '%' }" /></div>
    <div class="tracking-tools">
      <div class="tracking-filters" role="group" aria-label="Filter checklist"><button v-for="f in ['all', 'missing', 'collected']" :key="f" class="button secondary small-button" :class="{ active: filter === f }" :aria-pressed="filter === f" @click="filter = f">{{ f === 'all' ? 'All cards' : f === 'missing' ? 'Missing' : 'Collected' }}</button></div>
      <label class="tracking-search"><span class="sr-only">Search checklist</span><input v-model="search" type="search" maxlength="100" placeholder="Find a name, number or set…" /></label>
    </div>
    <p class="tracking-instructions">{{ readOnly ? 'Read-only checklist. Collected cards are shown in colour.' : 'Tap a card, then + Mark collected. Tap a collected card to mark it missing again.' }}</p>
    <div class="tracking-page">
      <div class="tracking-page-heading"><span>{{ filtered ? 'FILTERED CHECKLIST' : 'PAGE ' + (page + 1) }}</span><small>{{ filtered ? matches.length + ' matches' : size + ' pockets' }}</small></div>
      <div class="tracking-grid" :style="{ gridTemplateColumns: 'repeat(' + binder.columns + ', minmax(0, 1fr))' }">
        <component :is="readOnly ? 'div' : 'button'" v-for="item in visible" :key="item.position" :type="readOnly ? undefined : 'button'"
          class="tracking-card" :class="{ missing: !item.empty && !item.is_collected, collected: item.is_collected, empty: item.empty }"
          :data-position="item.position" :data-collected="item.is_collected ? 'true' : 'false'"
          :disabled="!readOnly && (saving || disabled)" :aria-label="item.empty ? 'Add checklist card to pocket ' + (item.position + 1) : item.name + ', ' + label(item) + ', ' + (item.is_collected ? 'collected' : 'missing')"
          @click="select(item)">
          <template v-if="!item.empty"><CardArtwork :card="item" :printing="designMode ? null : item" effects-mode="off" :badges="!designMode" />
            <span class="tracking-status"><AppIcon :name="item.is_collected ? 'check' : 'plus'" :size="13" />{{ item.is_collected ? 'Collected' : 'Missing' }}</span>
            <span class="tracking-card-info"><strong>{{ item.name }}</strong><small>#{{ item.local_id }} · {{ label(item) }}</small><small v-if="filtered">Page {{ Math.floor(item.position / size) + 1 }} · Pocket {{ item.position % size + 1 }}</small></span>
          </template>
          <template v-else><AppIcon :name="readOnly ? 'cards' : 'plus'" :size="22" /><span>{{ readOnly ? 'Empty pocket' : 'Add checklist card' }}</span></template>
        </component>
      </div>
      <p v-if="!visible.length" class="tracking-no-matches">No cards match. Try another search or choose All cards.</p>
    </div>
    <div class="binder-pagination tracking-pagination"><button class="button secondary" :disabled="page <= 0 || saving" @click="page--"><AppIcon name="left" :size="17" />Previous</button><span>{{ filtered ? 'Results' : 'Page' }} {{ page + 1 }} / {{ pages }}</span><button class="button secondary" :disabled="page + 1 >= pages || saving" @click="page++">Next<AppIcon name="right" :size="17" /></button></div>
    <p class="data-note">This is an independent checklist. Marks do not add inventory quantities, set a condition, change prices or reserve physical copies. {{ designMode ? 'One mark per card design, regardless of printing.' : 'Each pocket tracks its displayed printing.' }}</p>
    <AppModal :open="!readOnly && selection !== null && !!selected" :title="selected?.name || 'Track card'" :dismissible="!saving" @close="closeSelection">
      <div v-if="selected" class="tracking-selection"><div class="tracking-selected-art"><CardArtwork :card="selected" :printing="designMode ? null : selected" effects-mode="off" :badges="!designMode" /></div>
        <div><span class="badge" :class="selected.is_collected ? 'green' : ''">{{ selected.is_collected ? 'Collected' : 'Missing' }}</span><h3>{{ selected.set_name }}</h3><p>#{{ selected.local_id }} · {{ label(selected) }}</p><p class="muted small">Page {{ Math.floor(selected.position / size) + 1 }} · Pocket {{ selected.position % size + 1 }}</p></div>
      </div>
      <p v-if="saveError" class="alert error" role="alert">{{ saveError }} Retry to confirm the saved state, or close to reload.</p>
      <button class="button primary full tracking-mark" :disabled="saving || disabled" @click="mark(!selected?.is_collected)"><AppIcon :name="selected?.is_collected ? 'close' : 'plus'" :size="20" />{{ saving ? 'Saving…' : saveError ? 'Retry save' : selected?.is_collected ? 'Mark missing' : 'Mark collected' }}</button>
      <p class="data-note">{{ selected?.is_collected ? 'The card stays in the checklist and returns to grey.' : 'The card returns to full colour. No condition or price entry needed.' }}</p>
    </AppModal>
  </section>
</template>
<style scoped>
.tracking-binder{--track-ink:#253247;--track-green:#147b64;margin:18px 0 28px}.tracking-summary{display:flex;justify-content:space-between;align-items:center;gap:20px;padding:24px 28px;background:#eef7f3;border-radius:16px 16px 0 0;color:var(--track-ink)}.tracking-kicker{font-size:10px;font-weight:800;letter-spacing:.13em;color:#3c6c60}.tracking-summary h2{font-size:32px;margin:9px 0;font-weight:800}.tracking-summary h2 span{font-size:18px;font-weight:500}.tracking-summary p{font-size:13px;margin:0;line-height:1.6}.tracking-percent{font-size:40px;color:var(--track-green)}.tracking-percent small{font-size:18px}.tracking-progress{height:6px;background:#dce9e3;border-radius:0 0 6px 6px;overflow:hidden}.tracking-progress span{display:block;height:100%;background:var(--track-green);transition:width .18s ease}.tracking-tools{display:flex;flex-wrap:wrap;justify-content:space-between;gap:12px;margin:24px 0 14px;align-items:center}.tracking-filters{display:flex;gap:8px;flex-wrap:wrap}.tracking-filters .active{background:#253247;border-color:#253247;color:#fff}.tracking-search{min-width:220px;max-width:380px;flex:1}.tracking-search input{width:100%}.tracking-instructions{font-size:13px;color:#556177;line-height:1.7}.tracking-page{max-width:720px;margin:20px auto 0;background:#e9edf2;border:1px solid #d5dce6;border-radius:16px;padding:20px;box-shadow:0 8px 24px #2532470a}.tracking-page-heading{display:flex;justify-content:space-between;margin:0 2px 16px;font-size:10px;letter-spacing:.1em;font-weight:750;color:#59677a}.tracking-page-heading small{font-size:10px;font-weight:500;letter-spacing:0}.tracking-grid{display:grid;gap:14px}.tracking-card{display:block;min-width:0;position:relative;text-align:left;font:inherit;overflow:hidden;border:2px solid transparent;border-radius:9px;padding:5px;background:#fff;color:var(--track-ink);cursor:pointer;transition:border-color .15s}.tracking-card.missing :deep(.card-artwork){filter:grayscale(1);opacity:.46}.tracking-card.collected{border-color:#69b49b}.tracking-card:focus-visible{outline:3px solid #6356d8;outline-offset:3px}.tracking-card:disabled{cursor:wait;opacity:1}.tracking-status{display:flex;justify-content:center;align-items:center;gap:4px;font-size:10px;font-weight:750;border-radius:4px;background:#e9edf3;color:#42526a;padding:5px 2px;margin-top:5px}.tracking-card.collected .tracking-status{background:#e5f5ec;color:#11644e}.tracking-card-info{display:flex;flex-direction:column;padding:7px 3px 5px;gap:4px}.tracking-card-info strong{font-size:12px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.tracking-card-info small{font-size:10px;line-height:1.5;color:#59677a;overflow-wrap:anywhere}.tracking-card.empty{aspect-ratio:63/102;display:flex;flex-direction:column;align-items:center;justify-content:center;border:1px dashed #b4bfce;background:transparent;gap:8px;color:#66768d;text-align:center;font-size:11px;line-height:1.5;padding:12px}.tracking-pagination{max-width:720px;margin:20px auto}.tracking-no-matches{text-align:center;padding:50px 12px;color:#5e6c7f}.tracking-selection{display:grid;grid-template-columns:130px 1fr;gap:20px;align-items:center;margin-bottom:24px}.tracking-selected-art{width:130px}.tracking-selection h3{font-size:16px;margin:12px 0}.tracking-selection p{line-height:1.6;font-size:13px}.tracking-mark{min-height:48px}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}@media(max-width:560px){.tracking-summary{padding:20px 16px}.tracking-summary h2{font-size:28px}.tracking-summary h2 span{font-size:15px}.tracking-percent{font-size:30px}.tracking-page{padding:12px 8px}.tracking-grid{gap:6px}.tracking-card{padding:3px}.tracking-card-info{padding:5px 1px}.tracking-card-info strong{font-size:10px}.tracking-card-info small{font-size:9px}.tracking-status{font-size:9px}.tracking-search{max-width:none;min-width:0;flex-basis:100%}.tracking-selection{grid-template-columns:100px 1fr;gap:14px}.tracking-selected-art{width:100px}.tracking-pagination .button{padding:10px;font-size:12px}}@media(prefers-reduced-motion:reduce){.tracking-progress span,.tracking-card{transition:none}}
</style>
