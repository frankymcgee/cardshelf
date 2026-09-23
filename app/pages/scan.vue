<script setup lang="ts">
import { automaticScanPocket, scanBinderPockets } from '../../shared/scan-binders.mjs'
const api = useApi(), route = useRoute(), router = useRouter(), auth = useAuth()
const availability = ref<any>(null), scan = ref<any>(null), card = ref<any>(null), binders = ref<any[]>([]), binder = ref<any>(null)
const photo = ref(''), requestId = ref(''), consent = ref(false), busy = ref(false), preparing = ref(false), error = ref(''), message = ref('')
const printingId = ref(''), condition = ref('UNKNOWN'), quantity = ref(1), binderId = ref(typeof route.query.binder === 'string' ? route.query.binder : ''), binderPage = ref(1), position = ref<number | null>(null)
const placementMode = ref('auto'), bindersLoading = ref(true)
const query = ref(''), language = ref(''), searchResults = ref<any[]>([]), searched = ref(false), searching = ref(false), cardLoading = ref(false), binderLoading = ref(false)
const confirmationBody = ref<any>(null), fileInput = ref<HTMLInputElement>()
let alive = true, poll: ReturnType<typeof setTimeout> | undefined, cardSequence = 0, binderSequence = 0, scanSequence = 0, searchSequence = 0
const immutable = computed(() => busy.value || !!confirmationBody.value)
const printing = computed(() => card.value?.printings.find((p: any) => p.id === printingId.value))
const entry = computed(() => card.value?.entries.find((e: any) => e.printing_id === printingId.value && e.condition === condition.value))
const owned = computed(() => card.value?.entries.filter((e: any) => e.printing_id === printingId.value).reduce((n: number, e: any) => n + e.quantity, 0) || 0)
const availableBinders = computed(() => binders.value.filter(b => (availability.value?.binder_types || ['collection', 'tracking']).includes(b.binder_type)))
const allPockets = computed(() => scanBinderPockets(binder.value, printingId.value))
const pockets = computed(() => allPockets.value.filter(p => p.page === binderPage.value))
const automaticPocket = computed(() => automaticScanPocket(binder.value, printingId.value))
const selectedPocket = computed(() => placementMode.value === 'auto' ? automaticPocket.value : allPockets.value.find(p => p.position === position.value))
const placementDescription = computed(() => {
  if (!selectedPocket.value) return ''
  if (binder.value?.binder_type === 'tracking') return selectedPocket.value.existing
    ? selectedPocket.value.collected ? 'This pocket is already marked collected. You can still add the extra copies to your collection.' : 'Mark this planned pocket collected when you confirm.'
    : 'Place this printing in an empty pocket and mark it collected.'
  return selectedPocket.value.existing ? 'Use the pocket already set up for this printing.' : 'Place this printing in an empty pocket.'
})
watch([printingId, binderPage, binder], () => { position.value = null })
watch(binderId, () => {
  if (!alive) return
  placementMode.value = 'auto'; loadBinder()
  router.replace({ path: '/scan', query: { ...(binderId.value ? { binder: binderId.value } : {}), ...(scan.value?.id ? { scan: scan.value.id } : {}) } })
})
watch(placementMode, () => { position.value = null; binderPage.value = automaticPocket.value?.page || 1 })
async function loadAvailability() {
  const data = await api('/api/scans')
  if (alive) availability.value = data
}
async function loadBinder() {
  const seq = ++binderSequence; binder.value = null; position.value = null; binderPage.value = 1
  if (!binderId.value) { binderLoading.value = false; return }
  binderLoading.value = true
  try {
    const data = await api('/api/binders/' + encodeURIComponent(binderId.value))
    if (alive && seq === binderSequence) {
      if (!['collection', 'tracking'].includes(data.binder_type) || data.game !== 'pokemon') throw new Error('Choose a Pokémon Collection or Tracking binder.')
      binder.value = data
    }
  } catch (e) { if (alive && seq === binderSequence) error.value = errorMessage(e) }
  finally { if (alive && seq === binderSequence) binderLoading.value = false }
}
function applyScan(data: any) {
  scan.value = data
  if (data.status === 'processing') schedulePoll()
  else { clearTimeout(poll); confirmationBody.value = null; loadAvailability().catch(() => {}) }
}
function schedulePoll() {
  clearTimeout(poll)
  poll = setTimeout(() => { if (alive && scan.value?.status === 'processing') checkScan() }, 2500)
}
async function checkScan() {
  const id = scan.value?.id || requestId.value
  if (!id) return
  try { const data = await api('/api/scans/' + id); if (alive && id === (scan.value?.id || requestId.value)) { error.value = ''; applyScan(data) } }
  catch (e) { if (alive) { error.value = errorMessage(e); clearTimeout(poll) } }
}
async function resume(id: string) {
  if (busy.value || preparing.value) return
  const seq = ++scanSequence; cardSequence++; searchSequence++; cardLoading.value = false; searching.value = false
  clearTimeout(poll); error.value = ''; card.value = null; printingId.value = ''; confirmationBody.value = null
  photo.value = ''; requestId.value = id; scan.value = null; searchResults.value = []; searched.value = false
  try {
    const data = await api('/api/scans/' + id)
    if (alive && seq === scanSequence) { applyScan(data); await router.replace({ path: '/scan', query: { ...(binderId.value ? { binder: binderId.value } : {}), scan: id } }) }
  } catch (e) { if (alive && seq === scanSequence) error.value = errorMessage(e) }
}
async function choosePhoto(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file || busy.value) return
  scanSequence++; cardSequence++; searchSequence++; cardLoading.value = false; searching.value = false
  error.value = ''; message.value = ''; preparing.value = true; photo.value = ''; scan.value = null; card.value = null
  confirmationBody.value = null; consent.value = false; clearTimeout(poll)
  try {
    if (file.size > 12_000_000) throw new Error('Choose a photo smaller than 12 MB.')
    const data = await new Promise<string>((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = () => reject(new Error('Could not read this photo.')); r.readAsDataURL(file) })
    const image = await new Promise<HTMLImageElement>((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error('Use a JPEG, PNG or WebP photo.')); img.src = data })
    const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight))
    const canvas = document.createElement('canvas'); canvas.width = Math.round(image.naturalWidth * scale); canvas.height = Math.round(image.naturalHeight * scale)
    const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('Photo preparation is unavailable in this browser.')
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
    if (alive) { photo.value = canvas.toDataURL('image/jpeg', 0.88); requestId.value = crypto.randomUUID(); await router.replace({ path: '/scan', query: binderId.value ? { binder: binderId.value } : {} }) }
  } catch (e) { if (alive) error.value = errorMessage(e) }
  finally { if (alive) preparing.value = false }
}
async function analyse() {
  if (busy.value || !photo.value || !consent.value || !availability.value?.available) return
  busy.value = true; error.value = ''; message.value = ''
  const id = requestId.value
  try {
    const data = await api('/api/scans', { method: 'POST', body: { request_id: id, image: photo.value, confirm_external_processing: true } })
    if (alive) { applyScan(data); await router.replace({ path: '/scan', query: { ...(binderId.value ? { binder: binderId.value } : {}), scan: id } }) }
  } catch (e) {
    if (alive) {
      error.value = errorMessage(e)
      // A lost HTTP response does not imply the provider call failed. Recover the
      // same receipt; retrying the same photo keeps the original request ID.
      try {
        const data = await api('/api/scans/' + id)
        if (alive) { error.value = ''; applyScan(data); await router.replace({ path: '/scan', query: { ...(binderId.value ? { binder: binderId.value } : {}), scan: id } }) }
      } catch { /* Original error stays visible. */ }
    }
  } finally { if (alive) { busy.value = false; loadAvailability().catch(() => {}) } }
}
async function chooseCard(id: string) {
  if (immutable.value) return
  const seq = ++cardSequence; cardLoading.value = true; error.value = ''; card.value = null; printingId.value = ''; position.value = null
  try {
    const data = await api('/api/cards/' + encodeURIComponent(id))
    if (alive && seq === cardSequence) { card.value = data; condition.value = 'UNKNOWN'; quantity.value = 1; printingId.value = data.printings.length === 1 ? data.printings[0].id : '' }
  } catch (e) { if (alive && seq === cardSequence) error.value = errorMessage(e) }
  finally { if (alive && seq === cardSequence) cardLoading.value = false }
}
async function search() {
  if (searching.value || !query.value.trim()) return
  const seq = ++searchSequence
  searching.value = true; error.value = ''
  try { const data = await api('/api/catalogue', { query: { game: 'pokemon', q: query.value, language: language.value, limit: 12 } }); if (alive && seq === searchSequence) { searchResults.value = data.items; searched.value = true } }
  catch (e) { if (alive && seq === searchSequence) error.value = errorMessage(e) }
  finally { if (alive && seq === searchSequence) searching.value = false }
}
async function confirm() {
  if (busy.value || !scan.value || !printing.value || cardLoading.value || binderLoading.value) return
  if (binderId.value && (!binder.value || !selectedPocket.value)) return
  busy.value = true; error.value = ''
  if (!confirmationBody.value) confirmationBody.value = { printing_id: printingId.value, condition: condition.value, quantity: Number(quantity.value), entry_revision: entry.value?.revision || 0,
    binder: binder.value ? { id: binder.value.id, revision: binder.value.revision, ...(placementMode.value === 'auto' ? { mode: 'auto' } : { position: position.value }) } : null, confirm: true }
  try {
    const data = await api('/api/scans/' + scan.value.id + '/confirm', { method: 'POST', body: confirmationBody.value })
    if (alive) { applyScan(data); message.value = data.status === 'undone' ? 'This addition was already undone.' : 'Card added to your collection.' }
  } catch (e: any) {
    if (alive) {
      error.value = errorMessage(e)
      try {
        const data = await api('/api/scans/' + scan.value.id)
        if (alive && ['added', 'undone'].includes(data.status)) { error.value = ''; applyScan(data); message.value = data.status === 'added' ? 'Card added to your collection.' : 'This addition was already undone.' }
      } catch { /* Keep retry details unchanged. */ }
      const status = e?.statusCode || e?.status || e?.response?.status
      if (status && status < 500 && scan.value?.status === 'ready') {
        confirmationBody.value = null
        if (status === 409 && card.value) {
          try {
            const data = await api('/api/cards/' + encodeURIComponent(card.value.id)); if (alive) card.value = data
            if (binderId.value) await loadBinder()
          } catch { /* The conflict remains visible; the user can reselect the card. */ }
        }
      }
    }
  } finally { if (alive) busy.value = false }
}
async function undo() {
  if (busy.value || scan.value?.status !== 'added') return
  busy.value = true; error.value = ''
  try { const data = await api('/api/scans/' + scan.value.id + '/undo', { method: 'POST', body: { confirm: true } }); if (alive) { applyScan(data); message.value = 'The scanned addition was undone.' } }
  catch (e) { if (alive) error.value = errorMessage(e) }
  finally { if (alive) busy.value = false }
}
async function nextPhoto() {
  if (busy.value) return
  scanSequence++; cardSequence++; searchSequence++; cardLoading.value = false; searching.value = false
  clearTimeout(poll); scan.value = null; card.value = null; photo.value = ''; consent.value = false; confirmationBody.value = null
  requestId.value = ''; error.value = ''; message.value = ''; searched.value = false; searchResults.value = []
  printingId.value = ''; position.value = null; placementMode.value = 'auto'
  if (fileInput.value) fileInput.value.value = ''
  await router.replace({ path: '/scan', query: binderId.value ? { binder: binderId.value } : {} })
  if (binderId.value) await loadBinder()
}
onMounted(async () => {
  try {
    const [, data] = await Promise.all([loadAvailability(), api('/api/binders')])
    if (!alive) return
    binders.value = (Array.isArray(data) ? data : data.items || []).filter((b: any) => ['collection', 'tracking'].includes(b.binder_type) && b.game === 'pokemon')
    if (binderId.value) await loadBinder()
    if (typeof route.query.scan === 'string') await resume(route.query.scan)
  } catch (e) { if (alive) error.value = errorMessage(e) }
  finally { if (alive) bindersLoading.value = false }
})
onBeforeUnmount(() => { alive = false; cardSequence++; binderSequence++; clearTimeout(poll); photo.value = '' })
</script>
<template>
  <div class="scanner">
    <header class="page-heading"><div><span class="eyebrow">YOUR COLLECTION · PHOTO SCANNING</span><h1>Scan a card</h1><p>A photo, a match, another card on your shelf.</p></div><NuxtLink to="/cards" class="button secondary">Back to cards</NuxtLink></header>
    <ol class="scan-steps" aria-label="Scanning steps"><li :class="{ active: !scan }">1 <span>Take a photo</span></li><li :class="{ active: scan?.status === 'processing' || scan?.status === 'ready' && !card }">2 <span>Find your card</span></li><li :class="{ active: card || scan?.status === 'added' || scan?.status === 'undone' }">3 <span>Confirm & add</span></li></ol>
    <p v-if="error" class="alert error" role="alert">{{ error }}</p><p v-if="message" class="alert success" role="status">{{ message }}</p>
    <p v-if="availability?.message" class="alert info">{{ availability.message }} <NuxtLink v-if="auth.state.value.user?.role === 'admin'" to="/admin/scanning">Manage scanning</NuxtLink></p>
    <p v-if="availability?.enabled && availability.eligible" class="small muted">{{ availability.remaining }} of {{ availability.monthly_limit }} scans left this month. English and Japanese Pokémon cards.</p>
    <section v-if="!card && (!scan || ['ready', 'processing'].includes(scan.status))" class="panel scan-destination">
      <label>Add scanned cards to<select v-model="binderId" :disabled="immutable || bindersLoading"><option value="">Collection only</option><option v-if="binderId && !availableBinders.some(b => b.id === binderId)" :value="binderId" disabled>Selected binder unavailable</option><option v-for="b in availableBinders" :key="b.id" :value="b.id">{{ b.title }} · {{ b.binder_type === 'tracking' ? 'Tracking' : 'Collection' }}</option></select></label>
      <p class="data-note">Choose a binder once for this scanning session. After you select the printing, automatic placement finds its existing pocket or the first empty pocket. You can review or change the pocket before confirming.</p>
      <p v-if="!bindersLoading && !availableBinders.length" class="data-note">No available Pokémon binders. <NuxtLink to="/binders">View or create your binders</NuxtLink>.</p>
    </section>
    <section v-if="!scan" class="panel scan-capture">
      <div class="scan-photo" :class="{ 'has-photo': photo }"><img v-if="photo" :src="photo" alt="Your card photo to analyse" /><div v-else class="scan-photo-guide"><AppIcon name="cards" :size="52" /><strong>One card. All four corners.</strong><p>Use even light and avoid reflections.<br />Keep the name and card number readable.</p></div></div>
      <div class="scan-capture-controls"><h2>Start with the front</h2><p class="muted">Take a photo on your phone or choose an existing image.</p>
        <label class="scan-file-label">{{ photo ? 'Retake or choose another photo' : 'Take or choose a photo' }}<input ref="fileInput" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" :disabled="busy || preparing || !availability?.available" @change="choosePhoto" /></label>
        <p v-if="preparing" role="status">Preparing your photo…</p>
        <label v-if="photo" class="checkbox-label scan-consent"><input v-model="consent" type="checkbox" :disabled="busy" />Send this card photo to OpenAI for recognition.</label>
        <button class="button primary" :disabled="!photo || !consent || busy || preparing || !availability?.available" @click="analyse">{{ busy ? 'Analysing your card…' : 'Find this card' }}</button>
        <p class="data-note">CardShelf does not save the photo. OpenAI processes it externally under its API data policies. Review the match before anything is added.</p>
      </div>
    </section>
    <section v-else-if="scan.status === 'processing'" class="panel scan-state" aria-live="polite"><h2>Finding your card…</h2><p>Reading the printed details and checking your catalogue.</p><button class="button secondary" @click="checkScan">Check status</button><p class="data-note">You can return to this scan from Recent scans.</p></section>
    <section v-else-if="scan.status === 'failed'" class="panel scan-state"><h2>Let’s try another photo</h2><p>{{ scan.error }}</p><div class="button-row"><button class="button primary" @click="nextPhoto">Retake photo</button><NuxtLink to="/cards" class="button secondary">Search cards manually</NuxtLink></div></section>
    <template v-else-if="scan.status === 'ready'">
      <section class="panel scan-matches">
        <div class="section-heading"><div><h2>Choose the matching card</h2><p class="muted">Check the artwork, number, set and language against your card.</p></div><button class="text-button" :disabled="immutable" @click="nextPhoto">Retake photo</button></div>
        <p v-if="scan.observations?.card_count !== 1 || !scan.observations?.readable" class="alert info">The photo could not be read as one clear Pokémon card. Retake it or search below.</p>
        <p v-else-if="!scan.candidates.length" class="alert info">No matching imported card was found. Search below, or ask an administrator to import the card’s set.</p>
        <details v-if="photo" class="scan-original"><summary>Compare with your photo</summary><img :src="photo" alt="Your original card photo" /></details>
        <div class="scan-candidates"><button v-for="c in scan.candidates" :key="c.id" class="scan-candidate" :class="{ selected: card?.id === c.id }" :disabled="immutable || cardLoading" @click="chooseCard(c.id)"><CardArtwork :card="c" effects-mode="off" :badges="false" /><strong>{{ c.name }}</strong><span>{{ c.set_name }}</span><small>#{{ c.local_id }} · {{ c.language.toUpperCase() }}</small><small class="scan-match-evidence">{{ c.match_evidence.join(' + ') }}<br />{{ c.match_strength }}</small></button></div>
        <details class="scan-manual" :open="!scan.candidates.length"><summary>Search the catalogue manually</summary><form class="scan-search" @submit.prevent="search"><label>Card name or number<input v-model="query" maxlength="100" required :disabled="immutable" /></label><label>Language<select v-model="language" :disabled="immutable"><option value="">English & Japanese</option><option value="en">English</option><option value="ja">Japanese</option></select></label><button class="button secondary" :disabled="searching || immutable">{{ searching ? 'Searching…' : 'Search' }}</button></form><p v-if="searched && !searchResults.length" class="muted">No imported cards matched. Try another search or import the set.</p><div class="scan-manual-results"><button v-for="c in searchResults" :key="c.id" :disabled="immutable || cardLoading" @click="chooseCard(c.id)"><strong>{{ c.name }}</strong><span>{{ c.set_name }} · #{{ c.local_id }} · {{ c.language.toUpperCase() }}</span></button></div></details>
      </section>
      <p v-if="cardLoading" class="loading-panel">Loading printings and ownership…</p>
      <section v-if="card" class="panel scan-review">
        <div class="scan-review-art"><CardArtwork :card="card" :printing="printing" effects-mode="off" :low="false" :badges="false" /></div>
        <form class="form-stack" @submit.prevent="confirm"><div><span class="eyebrow">REVIEW YOUR ADDITION</span><h2>{{ card.name }}</h2><p class="muted">{{ card.set_name }} · #{{ card.local_id }} · {{ card.language.toUpperCase() }}</p></div>
          <fieldset class="scan-fieldset form-stack" :disabled="immutable">
            <label>Printing / finish<select v-model="printingId" required><option value="" disabled>Choose the exact printing</option><option v-for="p in card.printings" :key="p.id" :value="p.id">{{ p.label }}</option></select></label>
            <div class="scan-review-fields"><label>Condition<select v-model="condition"><option value="UNKNOWN">Not assessed</option><option value="NM">Near mint</option><option value="LP">Lightly played</option><option value="MP">Moderately played</option><option value="HP">Heavily played</option><option value="DMG">Damaged</option></select></label><label>Copies to add<input v-model.number="quantity" type="number" min="1" max="99" step="1" required /></label></div>
            <p v-if="printing" class="scan-ownership">You own <strong>{{ owned }}</strong> of this printing across all conditions. This adds <strong>{{ quantity }}</strong> more.<br /><small>Selected condition: {{ entry?.quantity || 0 }} → {{ (entry?.quantity || 0) + Number(quantity || 0) }}</small></p>
            <label>Add to a binder<select v-model="binderId" :disabled="bindersLoading"><option value="">Collection only</option><option v-if="binderId && !availableBinders.some(b => b.id === binderId)" :value="binderId" disabled>Selected binder unavailable</option><option v-for="b in availableBinders" :key="b.id" :value="b.id">{{ b.title }} · {{ b.binder_type === 'tracking' ? 'Tracking' : 'Collection' }}</option></select></label>
            <p v-if="binderLoading" role="status">Loading binder pockets…</p>
            <label v-if="binder">Pocket selection<select v-model="placementMode"><option value="auto">Automatic · matching pocket, then first empty</option><option value="manual">Choose a pocket myself</option></select></label>
            <div v-if="binder && placementMode === 'manual'" class="scan-review-fields"><label>Page<select v-model.number="binderPage"><option v-for="p in binder.page_count" :key="p" :value="p">Page {{ p }}</option></select></label><label>Pocket<select v-model="position" required><option :value="null" disabled>Choose a pocket</option><option v-for="p in pockets" :key="p.position" :value="p.position">Pocket {{ p.pocket }} · {{ p.existing ? 'matching card' : 'empty' }}{{ p.collected ? ' · collected' : '' }}</option></select></label></div>
            <p v-if="binder && printing && !allPockets.length" class="alert info">This binder has no matching or empty pocket. Choose another binder or Collection only.</p>
            <p v-else-if="binder && printing && placementMode === 'manual' && !pockets.length" class="alert info">No available pockets on this page. Choose another page or automatic placement.</p>
            <div v-if="binder && selectedPocket" class="scan-placement" data-testid="scan-placement" aria-live="polite"><strong>{{ binder.title }} · Page {{ selectedPocket.page }}, pocket {{ selectedPocket.pocket }}</strong><p>{{ placementDescription }}</p></div>
            <p v-if="binder" class="data-note">{{ binder.binder_type === 'tracking' ? 'Confirmation adds the copies to your collection and marks this checklist pocket collected. Future checklist marks remain independent of your inventory.' : 'The binder shows this printing and its ownership status. Choose another empty pocket if you want an additional placement.' }} Each scan adds the chosen quantity once. A scan cannot replace a different printing.</p>
          </fieldset>
          <p class="data-note">Confirm the exact printing yourself. Photo recognition does not assess condition or authenticity.</p>
          <button class="button primary" :disabled="busy || !printing || cardLoading || binderLoading || (!!binderId && (!binder || !selectedPocket))">{{ busy ? 'Saving…' : confirmationBody ? 'Retry this same addition' : 'Confirm & add to collection' }}</button>
          <button v-if="confirmationBody && !busy" type="button" class="text-button" @click="checkScan">Check whether it saved</button>
        </form>
      </section>
    </template>
    <section v-else-if="['added', 'undone'].includes(scan.status)" class="panel scan-state" aria-live="polite"><span class="scan-success-icon"><AppIcon :name="scan.status === 'added' ? 'check' : 'refresh'" :size="32" /></span><h2>{{ scan.status === 'added' ? 'Another card on your shelf.' : 'Addition undone.' }}</h2><p>{{ scan.addition.quantity }} × {{ scan.addition.name }} · {{ scan.addition.printing_label }}</p><p v-if="scan.status === 'added' && scan.addition.binder" class="muted" data-testid="scan-binder-receipt">{{ scan.addition.binder.title }}<template v-if="scan.addition.binder.page"> · Page {{ scan.addition.binder.page }}, pocket {{ scan.addition.binder.pocket }}</template><template v-if="scan.addition.binder.binder_type === 'tracking'"> · Marked collected</template>.</p><div class="button-row"><button class="button primary" :disabled="busy" @click="nextPhoto">Scan another card</button><NuxtLink v-if="scan.addition.binder" :to="'/binders/' + scan.addition.binder.id" class="button secondary">Open binder</NuxtLink><button v-if="scan.status === 'added'" class="text-button" :disabled="busy" @click="undo">Undo this addition</button></div><p v-if="scan.status === 'added'" class="data-note">Undo restores this addition while its ownership entry and any pocket or checklist mark changed by this scan remain unchanged.</p></section>
    <section v-if="availability?.recent?.length" class="scan-recent"><h2>Recent scans</h2><div class="scan-recent-list"><button v-for="s in availability.recent" :key="s.id" :disabled="busy" @click="resume(s.id)"><span><strong>{{ s.addition?.name || 'Card photo' }}</strong><small>{{ new Date(s.created_at).toLocaleString() }}</small></span><span class="badge">{{ ({ processing: 'Analysing', ready: 'Review match', failed: 'Try again', added: 'Added', undone: 'Undone' } as Record<string, string>)[s.status] }}</span></button></div></section>
  </div>
</template>
<style scoped>
.scan-destination{padding:20px 26px;margin-bottom:22px}.scan-destination label{max-width:600px}.scan-destination p{margin-bottom:0;line-height:1.7}.scan-placement{padding:14px;border:1px solid var(--line);border-radius:10px;background:var(--bg);font-size:13px;line-height:1.7}.scan-placement p{margin:5px 0 0;color:var(--muted)}
.scanner{max-width:1120px;margin:0 auto}.scan-steps{display:flex;list-style:none;gap:25px;padding:0;margin:0 0 26px;color:var(--muted)}.scan-steps li{display:flex;align-items:center;gap:9px;font-size:13px;font-weight:600}.scan-steps li.active{color:var(--accent,#5546d8)}.scan-capture{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:36px;padding:30px}.scan-photo{background:var(--bg);border:1px dashed var(--line);border-radius:16px;min-height:350px;display:flex;align-items:center;justify-content:center;padding:20px}.scan-photo.has-photo{border-style:solid}.scan-photo img{max-height:440px;max-width:100%;object-fit:contain;border-radius:10px}.scan-photo-guide{text-align:center;color:var(--muted)}.scan-photo-guide strong{display:block;color:var(--ink);margin-top:20px}.scan-photo-guide p{font-size:13px;line-height:1.9}.scan-capture-controls{align-self:center;min-width:0}.scan-capture-controls h2{margin-top:0}.scan-capture-controls>p{line-height:1.8}.scan-file-label{display:grid;gap:10px;margin:24px 0}.scan-file-label input{max-width:100%;font-size:12px}.scan-consent{align-items:flex-start;line-height:1.6;margin:20px 0}.scan-consent input{margin-top:5px}.scan-state{padding:40px;text-align:center}.scan-state .button-row{justify-content:center}.scan-matches,.scan-review{padding:26px;margin-bottom:24px}.scan-matches h2,.scan-review h2{margin:0 0 10px}.scan-original{margin:16px 0}.scan-original summary{cursor:pointer;font-weight:600}.scan-original img{display:block;max-height:300px;max-width:100%;margin-top:12px;border-radius:10px}.scan-candidates{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px}.scan-candidate{display:flex;flex-direction:column;text-align:left;padding:15px;min-width:0;border:2px solid var(--line);border-radius:14px;background:var(--paper);color:var(--ink);cursor:pointer}.scan-candidate.selected{border-color:var(--accent,#5546d8)}.scan-candidate .card-artwork{width:100%;max-width:170px;align-self:center;aspect-ratio:0.716;margin-bottom:13px}.scan-candidate strong{font-size:14px;margin-bottom:6px}.scan-candidate>span,.scan-candidate>small{font-size:12px;line-height:1.6;color:var(--muted)}.scan-match-evidence{margin-top:10px}.scan-manual{margin-top:25px;border-top:1px solid var(--line);padding-top:20px}.scan-manual summary{cursor:pointer;font-weight:600}.scan-search{display:grid;grid-template-columns:1fr minmax(0,190px) auto;gap:15px;align-items:end;margin:20px 0}.scan-manual-results{display:grid;grid-template-columns:1fr 1fr;gap:10px}.scan-manual-results button{display:grid;gap:6px;border:1px solid var(--line);border-radius:9px;background:var(--bg);color:var(--ink);padding:13px;text-align:left;cursor:pointer}.scan-manual-results span{font-size:12px;color:var(--muted)}.scan-review{display:grid;grid-template-columns:minmax(0,0.7fr) minmax(0,1.3fr);gap:32px}.scan-review-art .card-artwork{width:100%;max-width:280px;aspect-ratio:0.716}.scan-review-art{display:flex;align-items:flex-start;justify-content:center;padding-top:10px}.scan-review-fields{display:grid;grid-template-columns:1fr 1fr;gap:16px}.scan-fieldset{border:0;margin:0;padding:0;min-width:0}.scan-ownership{background:var(--bg);border-radius:10px;padding:14px;font-size:13px;line-height:1.8;margin:0}.scan-success-icon{display:inline-flex;padding:15px;border-radius:50%;background:var(--bg);color:var(--accent,#5546d8);margin-bottom:15px}.scan-recent{margin-top:35px}.scan-recent h2{font-size:18px}.scan-recent-list{display:grid;gap:8px}.scan-recent-list>button{display:flex;align-items:center;justify-content:space-between;gap:20px;text-align:left;padding:16px;border:1px solid var(--line);border-radius:10px;background:var(--paper);color:var(--ink);cursor:pointer}.scan-recent-list small{display:block;color:var(--muted);font-size:11px;margin-top:5px}.scanner button:focus-visible,.scanner summary:focus-visible{outline:3px solid var(--accent,#5546d8);outline-offset:3px}.scanner input,.scanner select{min-width:0;max-width:100%}@media(max-width:700px){.scan-capture,.scan-review{grid-template-columns:1fr;gap:22px;padding:18px}.scan-photo{min-height:260px}.scan-photo img{max-height:330px}.scan-steps{gap:16px;justify-content:space-between}.scan-steps li{font-size:11px;gap:5px}.scan-candidates{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.scan-candidate{padding:10px}.scan-matches{padding:18px}.scan-review-art .card-artwork{max-width:180px}.scan-search{grid-template-columns:1fr}.scan-manual-results{grid-template-columns:1fr}.scan-state{padding:25px 18px}.scanner .page-heading{display:block}.scanner .page-heading>.button{margin-top:15px}.scan-matches .section-heading{flex-wrap:wrap;gap:12px}}
</style>
