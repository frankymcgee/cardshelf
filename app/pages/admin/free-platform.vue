<script setup lang="ts">
const api = useApi(), notice = useNotice()
const loading = ref(true), busy = ref(false), error = ref(''), saved = ref<any>(null), password = ref(''), confirmed = ref(false), removeImage = ref(false)
const form = reactive({ registration_enabled: false, ads_enabled: false, sponsor_name: '', sponsor_text: '', sponsor_url: '', sponsor_cta: 'Learn more', sponsor_image_alt: '', reason: '' })
const account = reactive({ name: '', email: '', password: '', consent: false })
function accept(value: any) {
  saved.value = value
  for (const key of ['registration_enabled', 'ads_enabled', 'sponsor_name', 'sponsor_text', 'sponsor_url', 'sponsor_cta', 'sponsor_image_alt'] as const) (form as any)[key] = value[key]
  confirmed.value = false; removeImage.value = false
}
async function load() {
  loading.value = true; error.value = ''
  try { accept(await api('/api/admin/free-platform')) } catch (e) { error.value = errorMessage(e) }
  finally { loading.value = false }
}
onMounted(load)
async function save() {
  if (busy.value || !saved.value) return
  busy.value = true; error.value = ''
  try {
    accept(await api('/api/admin/free-platform/settings', { method: 'POST', body: { ...form, password: password.value, revision: saved.value.revision, confirm_sponsor: confirmed.value, remove_image: removeImage.value } }))
    notice.show('Free registration and sponsored placement settings saved. No billing settings changed.')
  } catch (e) { error.value = errorMessage(e) }
  finally { password.value = ''; busy.value = false }
}
async function upload(event: Event) {
  const input = event.target as HTMLInputElement, file = input.files?.[0]
  if (!file || busy.value) return
  if (file.size > 1024 * 1024 || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { error.value = 'Choose a JPEG, PNG or WebP image smaller than 1 MB.'; input.value = ''; return }
  if (!saved.value?.revision || !password.value) { error.value = 'Save settings once, then enter your administrator password before uploading.'; input.value = ''; return }
  busy.value = true; error.value = ''
  try {
    const encoded = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1] || ''); reader.onerror = () => reject(new Error('Image could not be read.')); reader.readAsDataURL(file) })
    accept(await api('/api/admin/free-platform/image', { method: 'POST', body: { password: password.value, revision: saved.value.revision, image_base64: encoded } }))
    notice.show('Sponsor image stored locally. Other unsaved form edits were not submitted.')
  } catch (e) { error.value = errorMessage(e) }
  finally { password.value = ''; input.value = ''; busy.value = false }
}
async function inviteFree() {
  if (busy.value) return
  busy.value = true; error.value = ''
  try {
    const result = await api('/api/admin/free-platform/accounts', { method: 'POST', body: { ...account } })
    notice.show(result.message); account.name = ''; account.email = ''; account.consent = false
  } catch (e) { error.value = errorMessage(e) }
  finally { account.password = ''; busy.value = false }
}
</script>
<template>
  <header class="page-heading"><div><span class="eyebrow">FREE ACCESS & SPONSORSHIP</span><h1>Free tier administration</h1><p>Open public reference data. Optional signed-in Free accounts. No subscription or ad-network enrolment is created here.</p></div></header>
  <p v-if="error" class="alert error" role="alert">{{ error }}</p><p v-if="loading" class="loading-panel">Loading protected settings…</p>
  <template v-else-if="saved">
    <form class="panel form-stack free-settings" @submit.prevent="save">
      <h2>Registration and advertisements</h2><div class="button-row"><NuxtLink to="/admin/adsense" class="button secondary">Google AdSense</NuxtLink><NuxtLink to="/admin/passwords" class="button secondary">Password recovery</NuxtLink></div>
      <label class="checkbox-label"><input v-model="form.registration_enabled" type="checkbox" :disabled="busy" />Allow new Free accounts to register</label>
      <p class="data-note">The public catalogue does not require an account. New Free accounts have no tester grant or private editing entitlement. Existing testers and paid accounts are not converted. Email verification is not included. Password recovery is available when SMTP is configured; administrators can also provide secure one-time links. Keep self-registration off until your support and privacy process is ready.</p>
      <label class="checkbox-label"><input v-model="form.ads_enabled" type="checkbox" :disabled="busy" />Show the configured sponsor to signed-in Free accounts</label>
      <p class="alert info">Collector, Collector Pro, administrators, testers and Complimentary users remain ad-free. Signed-out visitors and uncertain membership states do not receive an ad. No ads appear on billing, account, administration, binder-editing, print or private-message screens.</p>
      <label>Sponsor name<input v-model="form.sponsor_name" maxlength="100" :disabled="busy" /></label>
      <label>Advertisement text<textarea v-model="form.sponsor_text" maxlength="400" :disabled="busy" /></label>
      <div class="form-columns"><label>HTTPS destination<input v-model="form.sponsor_url" type="url" maxlength="1000" placeholder="https://sponsor.example/" :disabled="busy" /></label><label>Button text<input v-model="form.sponsor_cta" maxlength="40" :disabled="busy" /></label></div>
      <label>Image alternative text<input v-model="form.sponsor_image_alt" maxlength="160" :disabled="busy" /></label>
      <img v-if="saved.has_image" :src="'/api/admin/free-platform/image?revision=' + saved.revision" class="sponsor-preview" :alt="saved.sponsor_image_alt || 'Administrator preview of sponsor creative'" />
      <label class="checkbox-label"><input v-model="removeImage" type="checkbox" :disabled="busy" />Remove saved sponsor image when saving</label>
      <label class="checkbox-label"><input v-model="confirmed" type="checkbox" :disabled="busy" />I have permission to use this creative and have reviewed its suitability, destination and advertisement disclosure.</label>
      <label>Reason for change<input v-model="form.reason" required minlength="5" maxlength="500" :disabled="busy" /></label>
      <label>Current administrator password<input v-model="password" type="password" autocomplete="current-password" :disabled="busy" required /></label>
      <button class="button primary" :disabled="busy">{{ busy ? 'Saving…' : 'Save Free settings' }}</button>
      <p class="data-note">This is a first-party sponsor banner, not AdSense or AdMob. It uses no third-party advertising JavaScript, advertising cookies, impression tracking or personalised targeting. Google AdSense is configured separately under Google AdSense. Its consent and privacy requirements are different from this first-party banner.</p>
      <label>Upload sponsor image after saving settings<input type="file" accept="image/jpeg,image/png,image/webp" :disabled="busy || !saved.revision" @change="upload" /></label>
      <p class="data-note">Re-enter your administrator password before upload. Images are re-encoded, metadata removed and stored on this server. Save text changes separately before uploading.</p>
    </form>
    <form class="panel form-stack free-settings" @submit.prevent="inviteFree"><h2>Create a Free account</h2>
      <p>Use this instead of the existing tester-invite workflow. It creates a new account only, even while public registration is closed.</p>
      <label>Name<input v-model="account.name" required maxlength="80" :disabled="busy" /></label><label>Email<input v-model="account.email" type="email" required maxlength="254" :disabled="busy" /></label><label>Initial password<input v-model="account.password" type="password" required minlength="12" maxlength="128" autocomplete="new-password" :disabled="busy" /></label>
      <label class="checkbox-label"><input v-model="account.consent" type="checkbox" required :disabled="busy" />I have authority to create this Free account and will provide the privacy notice and credentials securely.</label>
      <button class="button secondary" :disabled="busy || !account.consent">Create Free account</button><p class="data-note">No invitation email is sent. A Free account is not a Complimentary account. Assigning a paid/manual tier later removes Free advertising eligibility.</p>
    </form>
  </template>
</template>
<style scoped>.free-settings{padding:24px;margin:24px 0;max-width:900px}.sponsor-preview{max-width:100%;max-height:240px;object-fit:contain;border:1px solid var(--line);border-radius:10px}</style>
