<script setup lang="ts">
const api = useApi(), notice = useNotice(), auth = useAuth()
const saved = ref<any>(null), error = ref(''), busy = ref(false), password = ref('')
const form = reactive({ placeholders_enabled: false, enabled: false, verification_enabled: false, publisher_id: '', slot_id: '', auto_ads_enabled: false, marketplace_enabled: false, marketplace_slot_id: '', reason: '' })
const adminView = ref('hidden'), viewBusy = ref(false)
async function saveView() {
  viewBusy.value = true; error.value = ''
  try {
    const mode = adminView.value
    await api('/api/admin/adsense/view', { method: 'POST', body: { mode } })
    const session = await auth.refresh()
    if (session.admin_placement_view !== mode) throw new Error('Your browser did not retain the preview setting. Check cookies and the site HTTPS configuration, then apply again.')
    window.location.reload()
  }
  catch (e) { error.value = errorMessage(e); viewBusy.value = false }
}
const approval = ref(false), consent = ref(false), autoOff = ref(false), autoReady = ref(false), scope = ref(false)
const site = String(useRuntimeConfig().public.siteUrl)
function accept(value: any) {
  saved.value = value
  if (value.admin_view) adminView.value = value.admin_view
  for (const key of ['placeholders_enabled','enabled','verification_enabled','publisher_id','slot_id','auto_ads_enabled','marketplace_enabled','marketplace_slot_id'] as const) (form as any)[key] = value[key]
  approval.value = false; consent.value = false; autoOff.value = false; autoReady.value = false; scope.value = false
}
async function load() { try { accept(await api('/api/admin/adsense')) } catch (e) { error.value = errorMessage(e) } }
onMounted(load)
async function save() {
  if (busy.value || !saved.value) return
  busy.value = true; error.value = ''
  try {
    accept(await api('/api/admin/adsense/settings', { method: 'POST', body: { ...form, revision: saved.value.revision, password: password.value,
      confirm_approval: approval.value, confirm_consent: consent.value, confirm_auto_ads_off: autoOff.value,
      confirm_auto_ads: autoReady.value, confirm_scope: scope.value } }))
    notice.show('AdSense settings saved. Member advertising rules are preserved.')
  } catch (e) { error.value = errorMessage(e) }
  finally { busy.value = false; password.value = '' }
}
</script>
<template>
  <header class="page-heading"><div><span class="eyebrow">FREE-ONLY ADVERTISING</span><h1>Google AdSense</h1><p>Auto ads across approved content pages, with card-sized placements in the marketplace.</p></div></header>
  <p v-if="error" class="alert error" role="alert">{{ error }}</p>
  <section v-if="saved" class="panel adsense-settings form-stack">
    <h2>Your administrator ad view</h2>
    <label>Display in this browser<select v-model="adminView" :disabled="viewBusy"><option value="hidden">Hidden — no ads or placeholders</option><option value="preview">Placeholder preview — no Google requests</option><option value="live">Live ads — when site advertising is enabled</option></select></label>
    <p class="data-note">Applies only to your administrator account in this browser. Preview works before approval. Live ads use the approved site settings and may not fill; do not click your own ads. Private screens remain excluded.</p>
    <button class="button secondary" :disabled="viewBusy" @click="saveView">{{ viewBusy ? 'Applying…' : 'Apply my ad view' }}</button>
    <p class="data-note">Saved view: <strong>{{ saved.admin_view === 'preview' ? 'Placeholder preview' : saved.admin_view === 'live' ? 'Live ads' : 'Hidden' }}</strong>. Apply changes before following a link. Placements appear near the bottom of eligible pages; private screens stay excluded.</p>
    <div class="button-row"><NuxtLink to="/cards#cardshelf-placement-preview">View catalogue</NuxtLink><NuxtLink to="/marketplace#cardshelf-placement-preview">View marketplace</NuxtLink><NuxtLink to="/#cardshelf-placement-preview">View homepage</NuxtLink></div>
  </section>
  <form v-if="saved" class="panel adsense-settings form-stack" @submit.prevent="save">
    <p class="alert info">Only signed-in Free accounts are eligible. Collector, Collector Pro, Complimentary users, testers and signed-out visitors receive no Google advertising loader. No Google ads are loaded on passwords, billing, account settings, administration, private messages, private card editors, binders or battles.</p>
    <label class="checkbox-label"><input v-model="form.placeholders_enabled" type="checkbox" :disabled="busy">Show placeholder ad sections to eligible Free accounts</label>
    <p class="data-note">Use while awaiting approval. This replaces Google advertising with local placeholders on eligible content pages, with no publisher or ad unit IDs required. Turn it off when ready for live ads. These are illustrative CardShelf positions; Google chooses the actual Auto ads layout. Paid and protected accounts stay ad-free.</p>
    <label>Publisher ID<input v-model="form.publisher_id" placeholder="ca-pub-1234567890123456" maxlength="23" :disabled="busy" autocomplete="off"></label>
    <label class="checkbox-label"><input v-model="form.verification_enabled" type="checkbox" :disabled="busy">Publish the verification meta tag and this hostname's ads.txt entry</label>
    <p class="data-note">Current site: {{ site }}. Verification is not approval and does not enable ads. Confirm this domain's status in Google AdSense; preserve any other authorised sellers in your root-domain ads.txt.</p>
    <label class="checkbox-label"><input v-model="form.enabled" type="checkbox" :disabled="busy">Enable Free-only Google AdSense</label>
    <fieldset :disabled="busy" class="ad-modes">
      <legend>Placement modes</legend>
      <label class="checkbox-label"><input v-model="form.auto_ads_enabled" type="checkbox">Allow Auto ads on eligible frontend and signed-in content pages</label>
      <p class="data-note">Homepage, features, public pricing, public card catalogue/details, collection overview, card browsing and marketplace browsing. New routes are excluded by default. Forms, private card details and My listings remain ad-free.</p>
      <p class="data-note">Enable Auto ads separately under Google AdSense → Ads → By site → Edit. Google chooses formats, positions and frequency. CardShelf controls who receives the loader, not Google's account settings. Start with in-page formats and review anchors/vignettes against your mobile navigation.</p>
      <label>Optional catalogue display ad unit ID<input v-model="form.slot_id" placeholder="1234567890" maxlength="20" autocomplete="off"></label>
      <label class="checkbox-label"><input v-model="form.marketplace_enabled" type="checkbox">Place an advertisement in the marketplace card grid</label>
      <label>Marketplace responsive display ad unit ID<input v-model="form.marketplace_slot_id" placeholder="1234567890" maxlength="20" autocomplete="off"></label>
      <p class="data-note">Use a responsive Display ad unit, not an In-feed template. One labelled ad tile appears after up to six listings when at least four listings are present. It uses the listing-card footprint, is not a sale link and does not replace a card. Disable “Optimise your existing ads” in Google to retain this manual position. Ad creative sizes and fill are determined by Google.</p>
      <p class="data-note">Auto ads alone needs only your publisher ID. Catalogue and marketplace display units are independent optional placements. Never paste scripts into a global header, theme, proxy or Tag Manager: that would bypass Free-only controls.</p>
    </fieldset>
    <label class="checkbox-label"><input v-model="approval" type="checkbox" :disabled="busy">Google has approved this site and the chosen ad units. I have reviewed publisher content and placement eligibility.</label>
    <label class="checkbox-label"><input v-model="consent" type="checkbox" :disabled="busy">I have published and tested the required Google-certified consent messages, privacy disclosures and consent-revocation option for the audiences I serve.</label>
    <label v-if="form.auto_ads_enabled" class="checkbox-label"><input v-model="autoReady" type="checkbox" :disabled="busy">Auto ads is configured in Google, with private-page exclusions and reviewed formats. I understand Google may add Auto ads wherever its shared loader runs, including pages with manual units.</label>
    <label v-else class="checkbox-label"><input v-model="autoOff" type="checkbox" :disabled="busy">Auto ads and automatic ad experiments are disabled in Google AdSense; only the selected manual units will be requested.</label>
    <label v-if="form.auto_ads_enabled || form.marketplace_enabled" class="checkbox-label"><input v-model="scope" type="checkbox" :disabled="busy">I confirm the Free-only page scope and private-screen exclusions, and no additional unscoped advertising loader is installed.</label>
    <p class="data-note">These acknowledgements do not change or verify your Google account. Google Privacy & messaging handles consent; CardShelf never overrides a refusal. Do not click your own ads or request real ads in automated tests.</p>
    <label>Reason for change<input v-model="form.reason" required minlength="5" maxlength="500" :disabled="busy"></label>
    <label>Current administrator password<input v-model="password" required type="password" autocomplete="current-password" maxlength="128" :disabled="busy"></label>
    <button class="button primary" :disabled="busy">{{ busy ? 'Saving…' : 'Save AdSense settings' }}</button>
    <p class="data-note">The master switch stops new loaders. Open pages recheck eligibility on focus and every minute; a loss of access reloads to an ad-free document, never a fresh ad impression. Navigation away also replaces any document that loaded Google. Use your administrator view above to inspect placeholders or opt into live ads.</p>
    <p class="data-note">Disabling only “Allow Auto ads” limits CardShelf's new loader locations. To disable automatic placement everywhere, turn Auto ads off in Google too: manual units share the same official script.</p>
    <p><NuxtLink to="/admin/free-platform">Manage first-party sponsorship separately</NuxtLink></p>
  </form><p v-else class="loading-panel">Loading protected AdSense settings…</p>
</template>
<style scoped>
.adsense-settings{padding:24px;margin:24px 0;max-width:960px}.adsense-settings .checkbox-label{align-items:flex-start;line-height:1.55}.adsense-settings input[type=checkbox]{margin-top:5px}.ad-modes{border:1px solid var(--line,#ddd);border-radius:12px;padding:20px;display:flex;flex-direction:column;gap:16px;min-width:0}.ad-modes legend{padding:0 8px;font-weight:600}.ad-modes .data-note{margin:0}
</style>
