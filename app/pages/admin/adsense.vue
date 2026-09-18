<script setup lang="ts">
const api = useApi(), notice = useNotice()
const saved = ref<any>(null), error = ref(''), busy = ref(false), password = ref('')
const form = reactive({ enabled: false, verification_enabled: false, publisher_id: '', slot_id: '', reason: '' })
const approval = ref(false), consent = ref(false), autoOff = ref(false)
function accept(value: any) { saved.value = value; for (const key of ['enabled','verification_enabled','publisher_id','slot_id'] as const) (form as any)[key] = value[key]; approval.value = false; consent.value = false; autoOff.value = false }
async function load() { try { accept(await api('/api/admin/adsense')) } catch (e) { error.value = errorMessage(e) } }
onMounted(load)
async function save() {
  if (busy.value || !saved.value) return
  busy.value = true; error.value = ''
  try {
    accept(await api('/api/admin/adsense/settings', { method: 'POST', body: { ...form, revision: saved.value.revision, password: password.value,
      confirm_approval: approval.value, confirm_consent: consent.value, confirm_auto_ads_off: autoOff.value } }))
    notice.show('AdSense settings saved. Paid and protected accounts remain ad-free.')
  } catch (e) { error.value = errorMessage(e) }
  finally { busy.value = false; password.value = '' }
}
</script>
<template>
  <header class="page-heading"><div><span class="eyebrow">FREE-ONLY ADVERTISING</span><h1>Google AdSense</h1><p>Manual display ads on the public card catalogue for signed-in Free accounts only.</p></div></header>
  <p v-if="error" class="alert error" role="alert">{{ error }}</p>
  <form v-if="saved" class="panel adsense-settings form-stack" @submit.prevent="save">
    <p class="alert info">Collector, Collector Pro, Complimentary users, testers, administrators and signed-out visitors receive no AdSense loader or ad requests. CardShelf does not place Google ads on password, account, billing, administration, private-message or private-binder pages.</p>
    <label>Publisher ID<input v-model="form.publisher_id" placeholder="ca-pub-1234567890123456" maxlength="23" :disabled="busy" autocomplete="off"></label>
    <label>Responsive display ad unit ID<input v-model="form.slot_id" placeholder="1234567890" maxlength="20" :disabled="busy" autocomplete="off"></label>
    <p class="data-note">Use your data-ad-client and data-ad-slot values from AdSense → Ads → By ad unit → Display ads. Do not paste JavaScript or HTML.</p>
    <label class="checkbox-label"><input v-model="form.verification_enabled" type="checkbox" :disabled="busy">Publish the inert verification meta tag and this hostname's ads.txt entry</label>
    <p class="data-note">Verification does not load advertisements. This server controls only its own hostname. For tcg.webwire.cloud, review the root webwire.cloud ads.txt/subdomain setup separately and preserve any existing seller records.</p>
    <label class="checkbox-label"><input v-model="form.enabled" type="checkbox" :disabled="busy">Enable Free-only Google AdSense placements</label>
    <label class="checkbox-label"><input v-model="approval" type="checkbox" :disabled="busy">Google has approved this site and the display ad unit is ready. I have reviewed content and placement eligibility.</label>
    <label class="checkbox-label"><input v-model="consent" type="checkbox" :disabled="busy">I have published and tested the required Google-certified consent messages, privacy disclosures and consent-revocation option for the audiences I serve.</label>
    <label class="checkbox-label"><input v-model="autoOff" type="checkbox" :disabled="busy">Auto ads, anchors, vignettes and automatic ad experiments are disabled in AdSense. No other global AdSense/Tag Manager loader is installed.</label>
    <p class="data-note">These are administrator acknowledgements, not an automatic check of Google's account. Google's published Privacy & messaging configuration handles consent; CardShelf does not manufacture consent or override refusals. Ads may be blocked or unfilled. Do not click your own ads or use real advertisements in automated tests.</p>
    <label>Reason for change<input v-model="form.reason" required minlength="5" maxlength="500" :disabled="busy"></label>
    <label>Current administrator password<input v-model="password" required type="password" autocomplete="current-password" maxlength="128" :disabled="busy"></label>
    <button class="button primary" :disabled="busy">{{ busy ? 'Saving…' : 'Save AdSense settings' }}</button>
    <p class="data-note">Turning AdSense off stops new loaders immediately; open catalogue documents recheck eligibility on focus and every minute. Navigation from a document that loaded Google uses a full page load so advertising scripts cannot follow into protected screens.</p>
    <p><NuxtLink to="/admin/free-platform">Manage first-party sponsorship separately</NuxtLink></p>
  </form><p v-else class="loading-panel">Loading protected AdSense settings…</p>
</template>
<style scoped>.adsense-settings{padding:24px;margin:24px 0;max-width:960px}.adsense-settings .checkbox-label{align-items:flex-start;line-height:1.55}.adsense-settings input[type=checkbox]{margin-top:5px}</style>
