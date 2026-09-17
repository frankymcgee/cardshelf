<script setup lang="ts">
import { aud, parseAud, SALE_CONDITIONS } from '../../../shared/marketplace.mjs'
const api = useApi(), notice = useNotice(), access = ref<any>(null), selected = ref<any>(null)
const query = ref(''), results = ref<any[]>([]), searching = ref(false), saving = ref(false), failure = ref(''), pending = ref<any>(null)
const form = reactive({ seller_alias: '', condition: 'UNKNOWN', price: '', delivery: 'postage', postage: '0.00', region: '', description: '', ownership_confirmed: false })
const photos = reactive<Record<string, any>>({ front: null, back: null }), reading = ref(0)
let sequence = 0, timer: ReturnType<typeof setTimeout> | undefined
async function search() {
  const current = ++sequence; searching.value = true
  try { const next = await api('/api/marketplace/printings', { query: { q: query.value } }); if (current === sequence) results.value = next }
  catch (e) { notice.show(errorMessage(e), 'error') } finally { if (current === sequence) searching.value = false }
}
onMounted(async () => { try { access.value = await api('/api/marketplace/access'); if (access.value.can_sell) search() } catch (e) { failure.value = errorMessage(e) } })
watch(query, () => { clearTimeout(timer); timer = setTimeout(search, 250) })
onBeforeUnmount(() => { sequence++; clearTimeout(timer) })
async function photo(event: Event, side: string) {
  const file = (event.target as HTMLInputElement).files?.[0]; if (!file) return
  if (!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size > 2_000_000) { notice.show('Use a JPEG, PNG or WebP no larger than 2 MB.', 'error'); return }
  reading.value++
  try {
    const data = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('The photo could not be read.')); reader.readAsDataURL(file) })
    photos[side] = { side, content_type: file.type, data_base64: data.split(',')[1], preview: data }
  } catch (e) { notice.show(errorMessage(e), 'error') } finally { reading.value-- }
}
async function publish() {
  if (saving.value || reading.value) return
  failure.value = ''
  if (!pending.value) {
    const price = parseAud(form.price), postage = form.delivery === 'pickup' ? 0 : parseAud(form.postage)
    if (!selected.value || !photos.front || !photos.back || !form.ownership_confirmed || price === null || price < 1 || postage === null) { failure.value = 'Choose a printing, add both photos, enter valid prices and confirm ownership.'; return }
    pending.value = { request_id: crypto.randomUUID(), printing_id: selected.value.printing_id,
      seller_alias: form.seller_alias, condition: form.condition, price_minor: price, delivery: form.delivery,
      postage_minor: postage, region: form.region, description: form.description, ownership_confirmed: true,
      photos: ['front','back'].map(side => ({ side, content_type: photos[side].content_type, data_base64: photos[side].data_base64 })) }
  }
  saving.value = true
  try { const result = await api('/api/marketplace/listings', { method: 'POST', body: pending.value }); pending.value = null; await navigateTo('/marketplace/' + result.id) }
  catch (e: any) { failure.value = errorMessage(e); const status = e?.statusCode || e?.response?.status; if (status >= 400 && status < 500) pending.value = null }
  finally { saving.value = false }
}
</script>
<template>
  <MarketplaceShell title="Make room for a new favourite" subtitle="List one physical card. Connect with the collector who is looking for it.">
    <p v-if="!access && !failure" class="loading-panel">Checking seller access…</p>
    <div v-if="failure" role="alert" class="market-error">{{ failure }}</div>
    <section v-if="access && !access.can_sell" class="market-empty"><h2>Selling is a Collector Plus feature.</h2><p>You can still browse listings and use your existing conversations.</p><NuxtLink to="/marketplace" class="button secondary">Browse cards</NuxtLink></section>
    <form v-if="access?.can_sell" class="market-form" @submit.prevent="publish">
      <fieldset :disabled="saving || !!pending">
        <section class="market-panel"><div class="market-section-label">01 · THE EXACT CARD</div><h2>Choose the card and printing</h2><p class="market-help">Your owned printings appear first. Catalogue matches are references, not proof of ownership or authenticity.</p><label>Find a card<input v-model="query" type="search" maxlength="100" placeholder="Card name, collector number or set" /></label>
          <p v-if="searching" class="market-help" role="status">Searching…</p><div class="market-picks"><button v-for="p in results" :key="p.printing_id" type="button" class="market-pick" :class="{ selected: selected?.printing_id === p.printing_id }" :aria-pressed="selected?.printing_id === p.printing_id" @click="selected = p"><img v-if="p.image_url" :src="p.image_url" alt="Catalogue reference" loading="lazy" /><span><strong>{{ p.card_name }}</strong><small>{{ p.set_name }} · #{{ p.local_id }} · {{ p.language.toUpperCase() }}</small><small>{{ p.printing_label }} · {{ p.owned_quantity }} recorded in inventory</small></span></button></div>
          <p v-if="!searching && !results.length" class="market-help">No matches. Only imported catalogue cards can be listed.</p><p v-if="selected" class="market-help"><strong>Selected: {{ selected.card_name }} — {{ selected.printing_label }}</strong></p>
        </section>
        <section class="market-panel"><div class="market-section-label">02 · SHOW THE ACTUAL CARD</div><h2>A clear front and back</h2><p class="market-help">Use photos you have permission to publish. Avoid faces, addresses or other personal information. JPEG, PNG or WebP, up to 2 MB each. Uploaded photos are resized and metadata is removed.</p><div class="market-fields"><label v-for="side in ['front','back']" :key="side" class="market-photo-input">{{ side === 'front' ? 'Front photo' : 'Back photo' }}<input type="file" accept="image/jpeg,image/png,image/webp" @change="photo($event, side)" /><img v-if="photos[side]" :src="photos[side].preview" :alt="side + ' photo preview'" /></label></div></section>
        <section class="market-panel"><div class="market-section-label">03 · THE DETAILS</div><h2>Set your asking price</h2><div class="market-fields">
          <label>Public seller name<input v-model="form.seller_alias" minlength="2" maxlength="40" required placeholder="Choose a display name" autocomplete="off" /></label>
          <label>Condition<select v-model="form.condition"><option v-for="c in SALE_CONDITIONS" :key="c" :value="c">{{ c }}</option></select></label>
          <label>Asking price (AUD)<input v-model="form.price" inputmode="decimal" placeholder="25.00" required /></label>
          <label>Delivery<select v-model="form.delivery"><option value="postage">Postage</option><option value="pickup">Local pickup</option><option value="both">Postage or pickup</option></select></label>
          <label v-if="form.delivery !== 'pickup'">Postage cost (AUD)<input v-model="form.postage" inputmode="decimal" placeholder="0.00" required /></label>
          <label>Suburb or city<input v-model="form.region" minlength="2" maxlength="80" required placeholder="Perth, WA — no street address" /></label>
          <label class="market-wide">Description<textarea v-model="form.description" minlength="10" maxlength="2000" required placeholder="Describe the card’s condition, visible wear and delivery arrangements. Do not post contact details, addresses or payment information." /></label>
        </div></section>
        <section class="market-panel"><h2>Ready for the shelf?</h2><p class="market-help">Publishing makes your seller name, photos and listing details visible to signed-in collectors. Listings and seller-reported sales do not change your inventory or tracking binders. Sale arrangements are made between collectors; an enquiry is not an order.</p><label class="market-check"><input v-model="form.ownership_confirmed" type="checkbox" required /><span>I own this genuine card, have the right to sell it and publish these photos, and have described it accurately. I understand that CardShelf is not processing or protecting the payment.</span></label></section>
      </fieldset>
      <p v-if="pending && !saving" class="market-help">The previous response could not be confirmed. Retry the same submission; its request ID prevents a duplicate listing. You can also check My listings.</p>
      <button class="button primary" type="submit" :disabled="saving || !!reading">{{ saving ? 'Publishing…' : pending ? 'Retry publishing' : 'Publish listing' }}</button>
      <NuxtLink to="/marketplace?mine=1" class="market-back" style="margin-left:16px;margin-top:16px">Back to my listings</NuxtLink>
    </form>
  </MarketplaceShell>
</template>
