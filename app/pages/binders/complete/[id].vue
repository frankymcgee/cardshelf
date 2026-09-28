<script setup lang="ts">
import { gameName } from '../../../../shared/games.mjs'
import { aud } from '../../../../shared/marketplace.mjs'
const route = useRoute(), api = useApi()
const data = ref<any>(null), loading = ref(true), saving = ref(false), loadError = ref(''), actionError = ref(''), success = ref('')
const search = ref(''), filter = ref('all'), page = ref(1), selected = ref<string[]>([]), confirmPrintings = ref(false)
const pageSize = 24
let alive = true, loadSequence = 0, matchSequence = 0
const id = computed(() => String(route.params.id))
const binderUrl = computed(() => '/binders/' + id.value)
const tracking = computed(() => data.value?.binder.binder_type === 'tracking')
const items = computed<any[]>(() => data.value?.items || [])
const wishlistCount = computed(() => items.value.filter(item => item.wishlist).length)
const matchedCount = computed(() => items.value.filter(item => item.match_count > 0).length)
const filtered = computed(() => {
  const term = search.value.trim().toLocaleLowerCase()
  return items.value.filter(item => (filter.value !== 'unwished' || !item.wishlist) && (filter.value !== 'matched' || item.match_count > 0) &&
    (!term || [item.name, item.local_id, item.label, item.set_name, item.language].join(' ').toLocaleLowerCase().includes(term)))
})
const pages = computed(() => Math.max(1, Math.ceil(filtered.value.length / pageSize)))
const visible = computed(() => filtered.value.slice((page.value - 1) * pageSize, page.value * pageSize))
const canSelect = computed(() => !!data.value?.permissions.can_add_wishlist && !saving.value && !loading.value && !loadError.value)
const canSave = computed(() => canSelect.value && selected.value.length > 0 && (!data.value?.binder.design_checklist || confirmPrintings.value))
watch([search, filter], () => { page.value = 1 })
watch(pages, value => { page.value = Math.min(page.value, value) })
function selectResults() {
  if (canSelect.value) selected.value = [...new Set([...selected.value, ...filtered.value.filter(item => !item.wishlist).map(item => item.printing_id)])]
}
function locations(item: any) {
  const size = data.value.binder.columns * data.value.binder.rows
  return item.positions.slice(0, 3).map((position: number) => `Page ${Math.floor(position / size) + 1}, pocket ${position % size + 1}`).join(' · ') +
    (item.positions.length > 3 ? ` · ${item.positions.length - 3} more` : '')
}
async function load() {
  const request = ++loadSequence, binderId = id.value
  loading.value = true; loadError.value = ''; selected.value = []; confirmPrintings.value = false; closeMatches()
  try {
    const result = await api('/api/binders/' + binderId + '/completion')
    if (alive && request === loadSequence && id.value === binderId) data.value = result
  } catch (e) { if (alive && request === loadSequence) loadError.value = errorMessage(e) }
  finally { if (alive && request === loadSequence) loading.value = false }
}
async function saveWishlist() {
  if (!canSave.value) return
  const binderId = id.value
  const body = { preview_token: data.value.preview_token, printing_ids: [...selected.value], confirm_displayed_printings: confirmPrintings.value }
  saving.value = true; actionError.value = ''; success.value = ''
  try {
    const result = await api('/api/binders/' + binderId + '/completion/wishlist', { method: 'POST', body })
    if (!alive || id.value !== binderId) return
    success.value = result.added ? `${result.added} ${result.added === 1 ? 'printing added' : 'printings added'} to your wishlist.` : 'Your selected printings are already on your wishlist.'
    await load()
  } catch (e: any) {
    if (!alive || id.value !== binderId) return
    actionError.value = errorMessage(e) + ' The list has been refreshed; check the wishlist badges before trying again.'
    await load()
  } finally { if (alive && id.value === binderId) saving.value = false }
}
const matchItem = ref<any>(null), matchData = ref<any>(null), matchLoading = ref(false), matchError = ref(''), matchPage = ref(1)
function closeMatches() { matchItem.value = null; matchData.value = null; matchSequence++ }
async function loadMatches(nextPage = 1) {
  if (!matchItem.value) return
  const request = ++matchSequence, binderId = id.value, printingId = matchItem.value.printing_id
  matchLoading.value = true; matchError.value = ''; matchData.value = null; matchPage.value = nextPage
  try {
    const result = await api('/api/binders/' + binderId + '/completion/matches', { query: { printing_id: printingId, page: nextPage } })
    if (alive && request === matchSequence && id.value === binderId && matchItem.value?.printing_id === printingId) matchData.value = result
  } catch (e) { if (alive && request === matchSequence) matchError.value = errorMessage(e) }
  finally { if (alive && request === matchSequence) matchLoading.value = false }
}
function openMatches(item: any) { matchItem.value = item; loadMatches() }
const conditionNames: Record<string, string> = { NM: 'Near mint', LP: 'Lightly played', MP: 'Moderately played', HP: 'Heavily played', DMG: 'Damaged', UNKNOWN: 'Not assessed' }
onMounted(load)
watch(id, () => { data.value = null; success.value = ''; actionError.value = ''; load() })
onBeforeUnmount(() => { alive = false; loadSequence++; matchSequence++ })
</script>
<template>
  <div class="binder-completion">
    <NuxtLink :to="binderUrl" class="text-button back-link"><AppIcon name="left" :size="16" />Back to binder</NuxtLink>
    <header class="page-heading">
      <div><span class="eyebrow">ONE CARD CLOSER</span><h1>Complete this binder</h1><p>{{ data?.binder.title || 'Find the printings your binder is waiting for.' }}</p></div>
      <button class="button secondary" :disabled="loading || saving" @click="load"><AppIcon name="refresh" :size="16" />Refresh missing cards</button>
    </header>
    <p v-if="loadError" class="alert error" role="alert">{{ loadError }} <button class="text-button" :disabled="loading" @click="load">Retry</button></p>
    <p v-if="actionError" class="alert warning" role="alert">{{ actionError }}</p>
    <p v-if="success" class="alert success" role="status">{{ success }}</p>
    <div v-if="loading && !data" class="loading-panel" role="status">Checking your binder…</div>
    <template v-if="data">
      <section class="completion-summary panel" aria-label="Binder completion">
        <div class="completion-progress">
          <span class="badge">{{ gameName(data.binder.game) }} · {{ tracking ? 'Tracking binder' : 'Collection binder' }}</span>
          <h2>{{ data.progress.completed }} of {{ data.progress.total }} planned pockets {{ tracking ? 'marked collected' : 'have an owned printing' }}</h2>
          <progress :value="data.progress.completed" :max="Math.max(1, data.progress.total)" aria-label="Planned pocket completion" />
          <p>{{ tracking ? 'Missing cards follow this checklist’s saved marks. Your detailed inventory is separate.' : 'Missing cards follow your owned printings. A repeated pocket does not require or reserve another copy.' }}</p>
        </div>
        <dl class="completion-stats"><div><dt>Missing printings</dt><dd>{{ data.progress.missing_printings }}</dd></div><div><dt>Already wishlisted</dt><dd>{{ wishlistCount }}</dd></div><div><dt>With active listings</dt><dd>{{ data.permissions.can_browse_marketplace ? matchedCount : '—' }}</dd></div></dl>
      </section>
      <section v-if="!data.progress.total" class="empty-state"><AppIcon name="binder" :size="36" /><h2>No cards planned yet</h2><p>Add cards to this binder to start a completion list.</p><NuxtLink :to="binderUrl" class="button primary">Plan this binder</NuxtLink></section>
      <section v-else-if="!items.length" class="empty-state"><AppIcon name="check" :size="36" /><h2>All planned cards accounted for</h2><p>{{ tracking ? 'Every checklist pocket is marked collected.' : 'You own each printing planned in this binder.' }}</p><NuxtLink :to="binderUrl" class="button primary">Enjoy your binder</NuxtLink></section>
      <template v-else>
        <p v-if="data.binder.design_checklist" class="alert info">This checklist tracks card designs. Wishes and marketplace matches use the exact printing displayed below; another finish is a separate card.</p>
        <p v-if="!data.permissions.can_add_wishlist" class="alert info">{{ data.permissions.wishlist_reason }} <NuxtLink to="/membership">Review membership</NuxtLink></p>
        <p v-if="!data.permissions.can_browse_marketplace" class="alert info">Marketplace matches need browsing access. <NuxtLink to="/membership">Review membership</NuxtLink></p>
        <section class="completion-controls panel" aria-label="Missing card controls">
          <div class="completion-filters"><label>Search missing cards<input v-model="search" type="search" placeholder="Card, set, number or printing…" /></label><label>Show<select v-model="filter"><option value="all">All missing printings</option><option value="unwished">Not on my wishlist</option><option value="matched" :disabled="!data.permissions.can_browse_marketplace">With active listings</option></select></label></div>
          <div class="completion-actions"><div class="button-row"><button class="button secondary" :disabled="!canSelect || !filtered.some(item => !item.wishlist)" @click="selectResults">Select all results</button><button class="text-button" :disabled="!canSelect || !selected.length" @click="selected = []">Clear selection</button><span class="muted small" aria-live="polite">{{ selected.length }} selected across all pages</span></div><button class="button primary" :disabled="!canSave" @click="saveWishlist">{{ saving ? 'Adding to wishlist…' : 'Add selected to wishlist' }}</button></div>
          <label v-if="data.binder.design_checklist && data.permissions.can_add_wishlist" class="completion-check"><input v-model="confirmPrintings" type="checkbox" :disabled="saving || loading" />I want the exact displayed printings on my wishlist.</label>
        </section>
        <p class="muted small">{{ filtered.length }} missing {{ filtered.length === 1 ? 'printing' : 'printings' }} shown · Each printing appears once, including repeated pockets.</p>
        <div class="completion-list" :aria-busy="loading || saving">
          <article v-for="item in visible" :key="item.printing_id" class="completion-card" :class="{ selected: selected.includes(item.printing_id) }" :data-printing="item.printing_id">
            <input v-model="selected" type="checkbox" :value="item.printing_id" :disabled="!canSelect || item.wishlist" :aria-label="'Select ' + item.name + ' · ' + item.label + ' · ' + item.language.toUpperCase()" />
            <CardImage :card="item" alt=""><div class="completion-art"><AppIcon name="cards" :size="28" /></div></CardImage>
            <div class="completion-card-copy"><h2>{{ item.name }}</h2><p>{{ item.set_name }} · #{{ item.local_id }}</p><div class="button-row"><span class="badge purple">{{ item.label }}</span><span class="badge">{{ item.language.toUpperCase() }}</span><span v-if="item.wishlist" class="badge green">On your wishlist</span></div><p class="completion-location">{{ locations(item) }}</p><p v-if="tracking && item.owned_quantity > 0" class="small">You own this printing; this checklist is still unmarked.</p></div>
            <div class="completion-match"><button v-if="data.permissions.can_browse_marketplace && item.match_count" class="button secondary" :disabled="loading || !!loadError" @click="openMatches(item)">View {{ item.match_count }} {{ item.match_count === 1 ? 'listing' : 'listings' }}</button><span v-else class="muted small">{{ data.permissions.can_browse_marketplace ? 'No active matches yet' : 'Matches unavailable' }}</span></div>
          </article>
        </div>
        <p v-if="!filtered.length" class="empty-inline">No missing printings match these filters.</p>
        <nav v-if="pages > 1" class="pagination" aria-label="Missing printings pages"><button class="button secondary" :disabled="page === 1" @click="page--">Previous</button><span>Page {{ page }} / {{ pages }}</span><button class="button secondary" :disabled="page === pages" @click="page++">Next</button></nav>
        <p class="data-note">Adding wishes keeps your owned quantities and binder progress unchanged. Marketplace matches are active member listings for the exact printing and language.</p>
      </template>
    </template>
    <AppModal :open="!!matchItem" title="Matching member listings" wide @close="closeMatches">
      <template v-if="matchItem">
        <h3>{{ matchItem.name }}</h3><p class="muted">{{ matchItem.set_name }} · #{{ matchItem.local_id }} · {{ matchItem.label }} · {{ matchItem.language.toUpperCase() }}</p>
        <p class="small muted">Sorted by card asking price. Check the condition, postage and pickup location before enquiring.</p>
        <p v-if="matchLoading" role="status">Finding current listings…</p>
        <p v-if="matchError" class="alert error" role="alert">{{ matchError }} <button class="text-button" @click="loadMatches(matchPage)">Retry</button></p>
        <div v-if="matchData" class="completion-sales">
          <article v-for="listing in matchData.items" :key="listing.id" class="completion-sale">
            <div><strong>{{ aud(listing.price_minor) }}</strong><p>{{ conditionNames[listing.condition] || listing.condition }} · {{ listing.seller_alias }}</p><p>{{ listing.region }}</p><small>{{ listing.delivery === 'pickup' ? 'Pickup only' : aud(listing.postage_minor) + ' postage' }}{{ listing.delivery === 'both' ? ' · Pickup also available' : '' }}</small></div>
            <NuxtLink :to="'/marketplace/' + listing.id" class="button primary" @click="closeMatches">View listing</NuxtLink>
          </article>
          <p v-if="!matchData.items.length" class="empty-inline">No active listings on this page. Availability may have changed.</p>
          <nav v-if="matchData.total > matchData.page_size || matchPage > 1" class="pagination" aria-label="Matching listing pages"><button class="button secondary" :disabled="matchPage === 1" @click="loadMatches(matchPage - 1)">Previous listings</button><span>Page {{ matchPage }} / {{ Math.max(1, Math.ceil(matchData.total / matchData.page_size)) }}</span><button class="button secondary" :disabled="matchPage * matchData.page_size >= matchData.total" @click="loadMatches(matchPage + 1)">Next listings</button></nav>
        </div>
      </template>
    </AppModal>
  </div>
</template>
<style scoped>
.binder-completion{max-width:1120px;margin:auto}.completion-summary{display:grid;grid-template-columns:1.15fr 1fr;gap:28px;padding:28px;margin-bottom:24px}.completion-progress h2{font-size:21px;line-height:1.4;margin:16px 0 12px}.completion-progress p{font-size:12px;line-height:1.7;color:var(--muted);margin-bottom:0}.completion-progress progress{width:100%;height:9px;accent-color:var(--primary);border:0;border-radius:8px;overflow:hidden;background:var(--surface-soft)}.completion-progress progress::-webkit-progress-bar{background:var(--surface-soft)}.completion-progress progress::-webkit-progress-value{background:var(--primary);border-radius:8px}.completion-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;align-items:center;margin:0}.completion-stats div{padding:16px 0 16px 16px;border-left:1px solid var(--line)}.completion-stats dt{font-size:11px;line-height:1.5;color:var(--muted)}.completion-stats dd{font-size:32px;font-weight:750;margin:8px 0 0;color:var(--ink)}.completion-controls{padding:20px;margin:22px 0 16px}.completion-filters{display:grid;grid-template-columns:2fr 1fr;gap:16px}.completion-filters label{display:flex;flex-direction:column;gap:8px;font-size:12px;font-weight:600;min-width:0}.completion-filters input,.completion-filters select{width:100%;min-width:0}.completion-actions{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:14px;margin-top:18px}.completion-check{display:flex;align-items:flex-start;gap:10px;font-size:12px;line-height:1.6;margin-top:18px}.completion-check input,.completion-card>input{width:18px;height:18px;flex-shrink:0;accent-color:var(--primary)}.completion-list{display:flex;flex-direction:column;gap:12px}.completion-card{display:grid;grid-template-columns:20px 68px minmax(0,1fr) auto;gap:18px;align-items:center;padding:18px;border:1px solid var(--line);border-radius:15px;background:var(--paper)}.completion-card.selected{border-color:var(--primary);background:var(--accent-soft)}.completion-card>img,.completion-art{width:68px;height:94px;object-fit:contain;border-radius:7px}.completion-art{display:grid;place-items:center;background:var(--surface-soft);color:var(--muted)}.completion-card-copy{min-width:0}.completion-card h2{font-size:16px;margin:0 0 6px;overflow-wrap:anywhere}.completion-card p{font-size:11px;line-height:1.6;margin:6px 0;color:var(--muted)}.completion-card-copy .button-row{gap:6px;margin-top:8px}.completion-card-copy .badge{font-size:10px}.completion-location{margin-top:10px!important}.completion-match{max-width:190px;text-align:right}.completion-sales{display:flex;flex-direction:column;gap:12px;margin-top:20px}.completion-sale{display:flex;align-items:center;justify-content:space-between;gap:18px;padding:18px;border:1px solid var(--line);border-radius:12px;background:var(--paper)}.completion-sale strong{font-size:23px;color:var(--ink)}.completion-sale p{font-size:12px;color:var(--muted);margin:7px 0}.completion-sale small{color:var(--muted);font-size:11px}.binder-completion .empty-state h2{font-size:22px}.binder-completion .empty-state>.button{margin-top:12px}
@media(max-width:850px){.completion-summary{grid-template-columns:1fr;gap:16px;padding:22px}.completion-stats{border-top:1px solid var(--line);padding-top:8px}.completion-stats div:first-child{border:0;padding-left:0}.completion-card{grid-template-columns:18px 60px minmax(0,1fr);gap:12px}.completion-card>img,.completion-art{width:60px;height:84px}.completion-match{grid-column:3;max-width:none;text-align:left}.completion-filters{grid-template-columns:1fr}.completion-actions>.button{width:100%}}
@media(max-width:480px){.completion-summary,.completion-controls{padding:17px}.completion-progress h2{font-size:18px}.completion-stats{gap:8px}.completion-stats div{padding-left:10px}.completion-stats dd{font-size:27px}.completion-card{padding:13px;column-gap:10px}.completion-card h2{font-size:14px}.completion-sale{align-items:flex-start;flex-direction:column}.completion-sale>.button{width:100%}}
</style>
