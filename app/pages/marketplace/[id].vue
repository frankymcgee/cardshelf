<script setup lang="ts">
import { aud, parseAud, saleStateLabel, canTransitionSale, SALE_STATES, REPORT_REASONS } from '../../../shared/marketplace.mjs'
const api = useApi(), route = useRoute(), auth = useAuth(), notice = useNotice()
const listing = ref<any>(null), loading = ref(true), busy = ref(false), failure = ref('')
const enquiry = ref(''), pending = ref<any>(null), reporting = ref(false), reported = ref(false)
const report = reactive({ reason: 'misleading', details: '' }), moderationReason = ref('')
const edit = reactive({ price: '', postage: '', status: 'active', description: '' })
let sequence = 0
async function load() {
  const current = ++sequence; loading.value = true; failure.value = ''
  try { const value = await api('/api/marketplace/listings/' + route.params.id); if (current !== sequence) return; listing.value = value; edit.price = (value.price_minor / 100).toFixed(2); edit.postage = (value.postage_minor / 100).toFixed(2); edit.status = value.status; edit.description = value.description }
  catch (e) { if (current === sequence) failure.value = errorMessage(e) }
  finally { if (current === sequence) loading.value = false }
}
onMounted(load); watch(() => route.params.id, () => { listing.value = null; pending.value = null; reported.value = false; reporting.value = false; load() }); onBeforeUnmount(() => { sequence++ })
async function save() {
  const price = parseAud(edit.price), postage = parseAud(edit.postage)
  if (price === null || postage === null) { notice.show('Enter valid AUD amounts.', 'error'); return }
  if (edit.status === 'sold' && !window.confirm('Mark this card sold? This is your own status report, not proof of payment. Your inventory will not change. Sold listings cannot be reopened.')) return
  busy.value = true
  try { await api('/api/marketplace/listings/' + listing.value.id, { method: 'PATCH', body: { revision: listing.value.revision, status: edit.status, price_minor: price, postage_minor: postage, description: edit.description } }); notice.show('Listing updated.'); await load() }
  catch (e) { notice.show(errorMessage(e), 'error') } finally { busy.value = false }
}
async function startEnquiry() {
  if (busy.value) return
  pending.value ||= { request_id: crypto.randomUUID(), message: enquiry.value, revision: listing.value.revision }
  busy.value = true
  try { const value = await api('/api/marketplace/listings/' + listing.value.id + '/enquiries', { method: 'POST', body: pending.value }); pending.value = null; await navigateTo({ path: '/marketplace/inbox', query: { thread: value.id } }) }
  catch (e: any) { notice.show(errorMessage(e), 'error'); const status = e?.statusCode || e?.response?.status; if (status >= 400 && status < 500) pending.value = null; if (status === 409) await load() }
  finally { busy.value = false }
}
async function sendReport() {
  busy.value = true
  try { await api('/api/marketplace/listings/' + listing.value.id + '/report', { method: 'POST', body: report }); reported.value = true; reporting.value = false; notice.show('Report recorded for the administrator.') }
  catch (e) { notice.show(errorMessage(e), 'error') } finally { busy.value = false }
}
async function moderate() {
  if (!window.confirm(listing.value.hidden ? 'Restore this listing’s visibility and resolve its open reports?' : 'Hide this listing and resolve its open reports?')) return
  busy.value = true
  try { await api('/api/marketplace/listings/' + listing.value.id + '/moderate', { method: 'POST', body: { revision: listing.value.revision, hidden: !listing.value.hidden, reason: moderationReason.value } }); notice.show('Moderation saved.'); await load() }
  catch (e) { notice.show(errorMessage(e), 'error') } finally { busy.value = false }
}
async function remove() {
  if (!window.confirm('Permanently delete this withdrawn listing and its photos? Listings with conversations or reports cannot be deleted here.')) return
  busy.value = true
  try { await api('/api/marketplace/listings/' + listing.value.id, { method: 'DELETE', body: { revision: listing.value.revision } }); await navigateTo('/marketplace?mine=1') }
  catch (e) { notice.show(errorMessage(e), 'error') } finally { busy.value = false }
}
</script>
<template>
  <MarketplaceShell :title="listing?.card_name || 'Card listing'" :subtitle="listing ? listing.set_name + ' · #' + listing.local_id + ' · ' + listing.printing_label : ''">
    <NuxtLink to="/marketplace" class="market-back">← Back to the market</NuxtLink>
    <p v-if="loading" class="loading-panel" role="status">Loading listing…</p><div v-if="failure" class="market-error" role="alert">{{ failure }} <button class="text-button" @click="load">Reload</button></div>
    <div v-if="listing && !loading" class="market-detail">
      <div><div class="market-photos"><figure v-for="photo in listing.photos" :key="photo.side"><img :src="photo.url" :alt="listing.card_name + ' — seller’s ' + photo.side + ' photo'" /><figcaption>Seller’s {{ photo.side }} photo</figcaption></figure></div><p class="market-help">These are seller-supplied photos of the listed card, not catalogue artwork. CardShelf has not authenticated or graded the item.</p></div>
      <section class="market-panel" style="margin-top:0"><span class="market-pill" :class="listing.hidden ? 'hidden' : listing.status">{{ listing.hidden ? 'Hidden by moderator' : saleStateLabel(listing.status) }}</span><strong class="market-price-large">{{ aud(listing.price_minor) }}</strong><p class="market-help">AUD asking price · one physical card · not a market valuation</p><dl class="market-facts"><dt>Seller</dt><dd>{{ listing.seller_alias }}</dd><dt>Condition</dt><dd>{{ listing.condition }} · seller described</dd><dt>Printing</dt><dd>{{ listing.printing_label }}</dd><dt>Language</dt><dd>{{ listing.language === 'en' ? 'English' : 'Japanese' }}</dd><dt>Location</dt><dd>{{ listing.region }}</dd><dt>Delivery</dt><dd>{{ listing.delivery === 'both' ? 'Postage or pickup' : listing.delivery === 'pickup' ? 'Local pickup' : 'Postage' }}</dd><template v-if="listing.delivery !== 'pickup'"><dt>Postage</dt><dd>{{ aud(listing.postage_minor) }}</dd></template></dl><p class="market-description">{{ listing.description }}</p>
        <p v-if="listing.moderation_reason" class="market-error">Moderation: {{ listing.moderation_reason }}</p>
        <NuxtLink v-if="listing.conversation_id" :to="{ path: '/marketplace/inbox', query: { thread: listing.conversation_id } }" class="button primary">Open your enquiry</NuxtLink>
        <form v-else-if="listing.can_enquire" @submit.prevent="startEnquiry"><label>Your enquiry<textarea v-model="enquiry" :disabled="busy || !!pending" maxlength="2000" required placeholder="Ask about condition, availability or delivery. Do not send passwords or payment-card details." /></label><p class="market-help">Your email and account name are not shared automatically. An enquiry does not reserve the card, create an order or authorise payment.</p><button class="button primary" :disabled="busy">{{ busy ? 'Opening enquiry…' : pending ? 'Retry enquiry' : 'Enquire with seller' }}</button></form>
        <p v-else-if="!listing.is_owner" class="market-help">This listing is not accepting new enquiries.</p>
        <div v-if="!listing.is_owner" id="report" class="market-actions"><button v-if="!reported" class="text-button market-danger" @click="reporting = !reporting">Report listing</button><span v-else class="market-help">Your report has been recorded.</span></div>
        <form v-if="reporting" class="form-stack" @submit.prevent="sendReport"><label>Reason<select v-model="report.reason"><option v-for="r in REPORT_REASONS" :key="r" :value="r">{{ r.replaceAll('_', ' ') }}</option></select></label><label>What should the administrator review?<textarea v-model="report.details" minlength="10" maxlength="1500" required /></label><button class="button secondary" :disabled="busy">Send report</button></form>
      </section>
    </div>
    <form v-if="listing?.is_owner && listing.status !== 'sold' && !loading" class="market-panel market-form" @submit.prevent="save"><h2>Manage your listing</h2><p class="market-help">Marking reserved or sold only changes the listing. Update detailed inventory separately when the transaction is completed. Existing enquiries retain the original asking price for reference.</p><div class="market-fields"><label>Asking price (AUD)<input v-model="edit.price" inputmode="decimal" required /></label><label v-if="listing.delivery !== 'pickup'">Postage (AUD)<input v-model="edit.postage" inputmode="decimal" required /></label><label>Availability<select v-model="edit.status"><option v-for="s in SALE_STATES.filter(s => canTransitionSale(listing.status, s))" :key="s" :value="s">{{ saleStateLabel(s) }}</option></select></label><label class="market-wide">Description<textarea v-model="edit.description" minlength="10" maxlength="2000" required /></label></div><div class="market-actions"><button class="button primary" :disabled="busy">Save changes</button><NuxtLink to="/marketplace/inbox" class="button secondary">View enquiries</NuxtLink><button v-if="listing.status === 'withdrawn' && !listing.hidden" type="button" class="text-button market-danger" :disabled="busy" @click="remove">Delete unused listing</button></div></form>
    <form v-if="listing && auth.state.value.user?.role === 'admin'" class="market-panel market-form" @submit.prevent="moderate"><h2>Administrator moderation</h2><p class="market-help">Hide a listing without altering a seller’s account, binder, inventory or private conversations. Restoring visibility does not reopen sold or withdrawn listings.</p><label>Reason (shown to seller)<textarea v-model="moderationReason" minlength="10" maxlength="1000" required /></label><div class="market-actions"><button class="button secondary" :disabled="busy">{{ listing.hidden ? 'Restore listing / resolve reports' : 'Hide listing / resolve reports' }}</button><NuxtLink to="/marketplace/moderation" class="text-button">Report queue</NuxtLink></div></form>
  </MarketplaceShell>
</template>
