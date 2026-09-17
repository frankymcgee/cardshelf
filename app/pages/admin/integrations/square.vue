<script setup lang="ts">
import '~/assets/css/membership.css'
const api = useApi(), route = useRoute()
const environment = ref(route.query.environment === 'production' ? 'production' : 'sandbox'), data = ref<any>(null), error = ref(''), notice = ref(''), busy = ref(false)
const password = ref(''), applicationId = ref(''), applicationSecret = ref(''), signatureKey = ref('')
const locations = ref<any[]>([]), locationId = ref(''), plans = ref<any[]>([]), cursor = ref<string | null>(null)
const selectedPlan = ref(''), tier = ref('collector'), tax = ref('0'), terms = ref(''), disconnectAck = ref(false), revokeRemote = ref(false)
const chosen = computed(() => plans.value.find(p => p.variation_id === selectedPlan.value))
const active = computed(() => data.value?.active_environment === environment.value)
const money = (n: number) => Number.isFinite(n) ? new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(n / 100) : '—'
const date = (value: any) => value ? new Date(value).toLocaleString('en-AU') : 'Not yet'
const endpoint = (action: string) => '/api/admin/integrations/square/' + action + '?environment=' + environment.value
async function load() {
  data.value = await api(endpoint('status'))
  applicationId.value = data.value.application_id
  locationId.value = data.value.location_id
}
async function run(work: () => Promise<void>) {
  if (busy.value) return
  busy.value = true; error.value = ''; notice.value = ''
  try { await work() } catch (e) { error.value = errorMessage(e) }
  finally { busy.value = false; password.value = ''; applicationSecret.value = ''; signatureKey.value = '' }
}
async function switchEnvironment() {
  plans.value = []; locations.value = []; selectedPlan.value = ''; cursor.value = null; data.value = null
  await run(load)
}
async function saveSetup() {
  await run(async () => {
    await api(endpoint('setup'), { method: 'POST', body: { application_id: applicationId.value,
      application_secret: applicationSecret.value, webhook_signature_key: signatureKey.value,
      revision: data.value.revision, password: password.value } })
    await load(); notice.value = 'Settings saved securely. No billing switches or account tiers were changed.'
  })
}
async function authorize() {
  await run(async () => {
    const response: any = await api(endpoint('authorize'), { method: 'POST', body: { revision: data.value.revision, password: password.value } })
    const target = new URL(response.url)
    const host = environment.value === 'production' ? 'connect.squareup.com' : 'connect.squareupsandbox.com'
    if (target.protocol !== 'https:' || target.hostname !== host || target.pathname !== '/oauth2/authorize') throw new Error('Unexpected Square authorization URL.')
    window.location.assign(target.href)
  })
}
async function testConnection() {
  await run(async () => {
    const response: any = await api(endpoint('test'), { method: 'POST', body: {} })
    locations.value = response.locations
    await load(); notice.value = 'Square permissions and business verified. No subscription or charge was created.'
  })
}
async function saveLocation() {
  await run(async () => {
    await api(endpoint('location'), { method: 'POST', body: { location_id: locationId.value, revision: data.value.revision, password: password.value } })
    plans.value = []; selectedPlan.value = ''; await load(); notice.value = 'Subscription location saved. Billing remains unchanged.'
  })
}
async function loadPlans(more = false) {
  await run(async () => {
    const response: any = await api(endpoint('plans') + (more && cursor.value ? '&cursor=' + encodeURIComponent(cursor.value) : ''))
    plans.value = more ? [...plans.value, ...response.items] : response.items
    cursor.value = response.cursor; notice.value = plans.value.length ? 'Square plans loaded. Only compatible variations can be mapped.' : 'No Square subscription variations were found. Create one in Square first.'
  })
}
async function saveOffer() {
  await run(async () => {
    if (!chosen.value?.compatible || !active.value) throw new Error('Choose a compatible plan in the server’s active environment.')
    if (!/^\d+(\.\d{1,2})?$/.test(tax.value) || Number(tax.value) > 100) throw new Error('Enter a tax percentage from 0 to 100, with up to two decimal places.')
    await api('/api/admin/billing/offers', { method: 'POST', body: { plan_code: tier.value,
      cadence: chosen.value.cadence, variation_id: chosen.value.variation_id, amount_minor: chosen.value.amount_minor,
      tax_bps: Math.round(Number(tax.value) * 100), terms: terms.value } })
    notice.value = 'Unpublished offer created. Review it in Membership administration before Verify & publish.'
    terms.value = ''; selectedPlan.value = ''
  })
}
async function disconnect() {
  await run(async () => {
    await api(endpoint('disconnect'), { method: 'POST', body: { password: password.value, revision: data.value.revision, confirm_billing_unchanged: disconnectAck.value, revoke_remote: revokeRemote.value } })
    disconnectAck.value = false; locations.value = []; plans.value = []; await load()
    notice.value = revokeRemote.value ? 'Square authorization revoked and stored tokens removed. No subscriptions were cancelled.' : 'Stored tokens removed. No subscriptions were cancelled. Remote authorization remains in Square.'
    revokeRemote.value = false
  })
}
onMounted(async () => {
  await run(load)
  const messages: Record<string, string> = { connected: 'Square connected. Test connection to choose its subscription location.', denied: 'Square authorization was declined. Nothing was changed.', error: 'Authorization could not be completed. Check your session, application credentials and registered callback, then reconnect.' }
  if (typeof route.query.result === 'string') notice.value = messages[route.query.result] || ''
})
useSeoMeta({ title: 'Square integration · CardShelf', robots: 'noindex, nofollow' })
</script>
<template>
<div class="membership-page square-integration">
  <header class="page-heading"><div><span class="eyebrow">ADMINISTRATION / INTEGRATIONS</span><h1>Connect Square</h1><p>Your subscription business, connected securely.</p></div><NuxtLink to="/admin/memberships" class="button secondary">Membership administration</NuxtLink></header>
  <p v-if="error" class="alert error" role="alert">{{ error }}</p><p v-if="notice" class="alert info" role="status">{{ notice }}</p>
  <section class="panel settings-panel">
    <div class="section-heading"><h2>Connection environment</h2><label>Editing<select v-model="environment" :disabled="busy" @change="switchEnvironment"><option value="sandbox">Sandbox — test business</option><option value="production">Production — real business</option></select></label></div>
    <p class="small muted">This selector edits a connection; it does not switch live billing. Connecting Square does not charge testers, change complimentary access or enable marketplace payments.</p>
    <template v-if="data">
      <p v-if="environment==='production'" class="alert info">Production credentials access a real Square business. The Connect and Test actions do not create subscriptions.</p>
      <div class="membership-status-grid"><div><small>Credential source</small><strong>{{data.source==='oauth'?'Managed OAuth ('+data.connection_status+')':data.source==='disconnected'?'Disconnected':'Server environment'}}</strong></div><div><small>Server active environment</small><strong>{{data.active_environment}}</strong></div><div><small>New subscriptions</small><strong>{{data.billing_switch?'Server switch enabled':'Disabled'}}</strong></div><div><small>Paid-tier enforcement</small><strong>{{data.enforcement_switch?'Server switch enabled':'Disabled — testing access'}}</strong></div></div>
      <p v-if="!active" class="small muted">You are configuring the inactive environment. It is isolated from current billing. Offer mapping and webhook processing use the server’s active environment only.</p>
      <p v-if="data.last_error" class="alert error">{{data.last_error}}</p>
      <p v-if="!data.key_available" class="alert error">One-time server setup is needed to encrypt credentials. Run <code>sudo sh scripts/configure-integrations.sh</code>, then recreate the application using your existing Compose configuration. Keep the generated key with your private server configuration.</p>
    </template>
  </section>
  <template v-if="data">
    <section class="panel settings-panel spaced"><div class="section-heading"><h2>1. Application & webhook setup</h2><span class="badge">Administrator only</span></div>
      <p>Create your application in Square Developer Console. On its OAuth page, register this exact redirect URL:</p><code class="square-url">{{data.callback_url}}</code>
      <p class="small muted">Use this environment’s application ID and application secret. Leave secret fields empty to retain a saved value; saved secrets are never displayed again. Existing server credentials continue working until OAuth is connected.</p>
      <form class="membership-form" @submit.prevent="saveSetup">
        <label>Application ID<input v-model="applicationId" maxlength="191" required :disabled="busy"></label>
        <label>Application secret<input v-model="applicationSecret" type="password" autocomplete="new-password" maxlength="4096" :placeholder="data.application_secret_saved?'Saved securely — leave blank to keep':'Square application secret'" :disabled="busy"></label>
        <details><summary>Webhook setup</summary><p class="small muted">Create the webhook in Square Developer Console, then save its signature key here. OAuth cannot register application-owned webhooks. Do not enter a personal access token into this form.</p><code class="square-url">{{data.webhook_url}}</code>
          <p class="small muted">Select subscription.created, subscription.updated, invoice.published, invoice.updated, invoice.payment_made, invoice.refunded, invoice.scheduled_charge_failed, payment.updated, refund.created, refund.updated, dispute.created, dispute.state.updated and oauth.authorization.revoked.</p>
          <label>Webhook signature key<input v-model="signatureKey" type="password" autocomplete="new-password" maxlength="4096" :placeholder="data.webhook_secret_saved?'Saved securely — leave blank to keep':'Webhook signature key'" :disabled="busy"></label>
          <p class="small muted">Last verified event received: {{date(data.webhook_seen_at)}}. Saving a key alone does not prove delivery; send a test event from Square and refresh this page.</p>
        </details>
        <label>Your current administrator password<input v-model="password" type="password" autocomplete="current-password" required maxlength="128" :disabled="busy"></label>
        <button class="button primary" :disabled="busy||!data.key_available">Save encrypted settings</button>
      </form>
    </section>
    <section class="panel settings-panel spaced"><h2>2. Authorize your business</h2>
      <p>You will sign in on Square and approve permissions for subscription invoices, customers, plans and payment-status verification. Square requires payment/order/invoice write permissions to create subscriptions; CardShelf still does not process marketplace card-sale payments.</p>
      <form class="membership-form" @submit.prevent="authorize"><label>Your current administrator password<input v-model="password" type="password" required maxlength="128" autocomplete="current-password" :disabled="busy"></label><div class="button-row"><button class="button primary" :disabled="busy||!data.key_available||!data.application_secret_saved">{{data.connected?'Reconnect Square':'Connect Square'}}</button><button type="button" class="button secondary" :disabled="busy||!data.connected" @click="testConnection">Test connection</button></div></form>
      <div v-if="data.merchant_id" class="membership-status-grid spaced"><div><small>Connected business</small><strong>{{data.merchant_name||data.merchant_id}}</strong></div><div><small>Last verified</small><strong>{{date(data.checked_at)}}</strong></div><div><small>Token expires</small><strong>{{date(data.expires_at)}}</strong></div><div><small>Last renewed</small><strong>{{date(data.refreshed_at)}}</strong></div></div>
      <details v-if="data.scopes.length" class="spaced"><summary>Granted permissions</summary><p class="small muted">{{data.scopes.join(', ')}}</p></details>
      <p class="small muted">Reconnection is pinned to the original merchant. Access tokens are renewed automatically while the application is running; expiry or renewal errors require attention here.</p>
    </section>
    <section class="panel settings-panel spaced"><h2>3. Subscription location</h2>
      <p class="small muted">Test the connection to load active AUD locations. Selecting a location also uses its Square timezone. A location used by published offers or subscription history cannot be switched here.</p>
      <p v-if="data.location_id">Selected: <strong>{{data.location_name||data.location_id}}</strong> · {{data.timezone}}</p>
      <form v-if="locations.length" class="membership-form" @submit.prevent="saveLocation"><label>Square location<select v-model="locationId" required :disabled="busy"><option value="" disabled>Select a location</option><option v-for="l in locations" :key="l.id" :value="l.id">{{l.name}} · {{l.timezone}}</option></select></label><label>Your current administrator password<input v-model="password" type="password" required autocomplete="current-password" maxlength="128" :disabled="busy"></label><button class="button primary" :disabled="busy">Save location</button></form>
    </section>
    <section class="panel settings-panel spaced"><div class="section-heading"><h2>4. Choose a subscription plan</h2><button class="button secondary" :disabled="busy||!data.connected||!data.location_id" @click="loadPlans()">Load Square plans</button></div>
      <p class="small muted">Compatible plans are single-phase, static AUD subscriptions with monthly or annual billing. This creates a CardShelf draft only; publishing and enabling subscriptions remain separate actions.</p>
      <div v-if="plans.length" class="membership-table-wrap"><table><thead><tr><th>Square variation</th><th>Cadence</th><th>Base price</th><th>Compatibility</th></tr></thead><tbody><tr v-for="p in plans" :key="p.variation_id"><td><strong>{{p.name}}</strong><br><code>{{p.variation_id}}</code></td><td>{{p.cadence}}</td><td>{{p.currency==='AUD'?money(p.amount_minor):p.currency}}</td><td>{{p.compatible?'Supported':p.reason}}</td></tr></tbody></table></div>
      <button v-if="cursor" class="button secondary spaced" :disabled="busy" @click="loadPlans(true)">Load more plans</button>
      <form v-if="plans.some(p=>p.compatible)&&active" class="membership-form spaced" @submit.prevent="saveOffer"><label>Square plan<select v-model="selectedPlan" required :disabled="busy"><option value="" disabled>Choose a compatible plan</option><option v-for="p in plans.filter(p=>p.compatible)" :key="p.variation_id" :value="p.variation_id">{{p.name}} · {{p.cadence}} · {{money(p.amount_minor)}}</option></select></label><label>CardShelf tier<select v-model="tier" :disabled="busy"><option value="collector">Collector</option><option value="plus">Collector Plus</option></select></label><label>Tax added (%)<input v-model="tax" inputmode="decimal" required :disabled="busy"></label><label>Customer-facing recurring subscription terms<textarea v-model="terms" rows="5" minlength="60" maxlength="6000" required :disabled="busy" placeholder="Amount, billing cadence, cancellation, refunds and operator contact information."></textarea></label><button class="button primary" :disabled="busy||!chosen">Create unpublished offer</button></form>
    </section>
    <details class="panel settings-panel spaced"><summary>Disconnect this integration</summary><p>This removes CardShelf’s stored OAuth tokens locally. It does not cancel invoices or subscriptions. Optional remote revocation invalidates all tokens for this Square application and business, including other installations. You can also revoke authorization through My Applications in Square Dashboard.</p><p class="small muted">The active environment’s subscription switch must be off and no current or pending subscriptions can remain. Tester and complimentary grants are never removed by disconnecting. An old environment token will not silently take over.</p><form class="membership-form" @submit.prevent="disconnect"><label class="membership-check"><input v-model="disconnectAck" type="checkbox" required><span>I understand this does not cancel Square billing.</span></label><label>Your current administrator password<input v-model="password" type="password" required autocomplete="current-password" maxlength="128" :disabled="busy"></label><label class="membership-check"><input v-model="revokeRemote" type="checkbox"><span>Also revoke this application’s Square authorization for this business. All installations using the same app and business will lose API access.</span></label><button class="button secondary" :disabled="busy||data.source!=='oauth'||!disconnectAck">{{revokeRemote?'Revoke & disconnect':'Disconnect locally'}}</button></form></details>
  </template>
</div>
</template>
<style scoped>
.square-url{display:block;overflow-wrap:anywhere;word-break:break-all;padding:1rem;background:var(--surface,#f4f5f9);border-radius:10px;font-size:.85rem}
.square-integration .section-heading{gap:1rem;flex-wrap:wrap}.square-integration select{max-width:100%}
.square-integration .membership-status-grid strong{overflow-wrap:anywhere}.square-integration details summary{cursor:pointer;font-weight:600}
@media(max-width:600px){.square-integration .section-heading{align-items:stretch}.square-integration .section-heading>label{width:100%}}
</style>
