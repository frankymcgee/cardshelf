<script setup lang="ts">
import QRCode from 'qrcode'
import { startAuthentication, startRegistration, WebAuthnAbortService } from '@simplewebauthn/browser'
import { safeReturnTo } from '../../shared/platform.mjs'
definePageMeta({ layout: 'auth' })
useSeoMeta({ title: 'Account security · CardShelf', robots: 'noindex, nofollow', referrer: 'no-referrer' })
const api = useApi(), auth = useAuth(), route = useRoute()
const status = ref<any>(null), loading = ref(true), busy = ref(false), error = ref(''), message = ref('')
const action = ref<'totp' | 'passkey' | 'remove' | 'recovery' | 'reauth' | ''>(''), selectedFactor = ref<any>(null)
const credentials = reactive({ password: '', code: '', method: 'totp' }), label = ref(''), confirmation = ref(false)
const enrollment = ref<any>(null), qr = ref(''), enrollmentCode = ref(''), recoveryCodes = ref<string[]>([]), savedCodes = ref(false)
const passkeysSupported = ref(false), now = ref(Date.now())
const pending = computed(() => status.value?.pending)
const bootstrap = computed(() => pending.value?.scope === 'enrollment')
const expired = computed(() => pending.value?.expires_at && Date.parse(pending.value.expires_at) <= now.value)
const factors = computed(() => [...(status.value?.totp || []).map((factor: any) => ({ ...factor, kind: 'totp' })), ...(status.value?.passkeys || []).map((factor: any) => ({ ...factor, kind: 'passkey' }))])
const needsStrongAuth = computed(() => !bootstrap.value && factors.value.length > 0)
const lastRequiredFactor = computed(() => factors.value.length <= 1)
const next = computed(() => safeReturnTo(route.query.next))
let alive = true, sequence = 0, allowUnsavedLeave = false, timer: ReturnType<typeof setInterval> | undefined
function clearCredentials() { credentials.password = ''; credentials.code = '' }
function clearEnrollment() { enrollment.value = null; enrollmentCode.value = ''; qr.value = '' }
function clearRecovery() { recoveryCodes.value = []; savedCodes.value = false }
function beforeUnload(event: BeforeUnloadEvent) { if (recoveryCodes.value.length && !savedCodes.value) { event.preventDefault(); event.returnValue = '' } }
onMounted(() => {
  passkeysSupported.value = window.isSecureContext && !!window.PublicKeyCredential
  timer = setInterval(() => { now.value = Date.now() }, 15000)
  window.addEventListener('beforeunload', beforeUnload); load()
})
onBeforeRouteLeave(() => allowUnsavedLeave || !recoveryCodes.value.length || savedCodes.value || window.confirm('These recovery codes are shown only once. Leave without saving them?'))
onBeforeUnmount(() => { alive = false; sequence++; clearInterval(timer); WebAuthnAbortService.cancelCeremony(); window.removeEventListener('beforeunload', beforeUnload); clearCredentials(); clearEnrollment(); clearRecovery(); status.value = null })
function applyStatus(result: any) {
  status.value = result
  auth.state.value = { ...auth.state.value, loaded: true, user: result.user ? { ...(auth.state.value.user?.id === result.user.id ? auth.state.value.user : {}), ...result.user } : null, pending: result.pending || null }
}
async function load() {
  const current = ++sequence; loading.value = true; error.value = ''
  try {
    const result = await api('/api/security/status')
    if (!alive || current !== sequence) return
    applyStatus(result)
    if (!result.user && result.pending?.scope !== 'enrollment') await navigateTo({ path: '/login', query: { next: '/security' } })
  } catch (e) { if (alive && current === sequence) error.value = errorMessage(e) }
  finally { if (alive && current === sequence) loading.value = false }
}
function choose(value: typeof action.value, factor: any = null) {
  if (busy.value || recoveryCodes.value.length) return
  clearCredentials(); clearEnrollment(); error.value = ''; message.value = ''; confirmation.value = false; label.value = ''; selectedFactor.value = factor
  credentials.method = status.value?.totp?.length ? 'totp' : 'passkey'; action.value = value
}
function cancelAction() {
  if (busy.value) return
  clearCredentials(); clearEnrollment(); selectedFactor.value = null; confirmation.value = false; action.value = ''; error.value = ''
}
async function authorization(current: number) {
  const password = credentials.password
  if (bootstrap.value) return { password }
  if (!needsStrongAuth.value || credentials.method === 'totp') return { password, ...(needsStrongAuth.value ? { code: credentials.code } : {}) }
  const challenge = await api('/api/security/passkeys/authenticate/begin', { method: 'POST', body: { purpose: 'reauth', password } })
  if (!alive || current !== sequence) return null
  const response = await startAuthentication({ optionsJSON: challenge.options })
  if (!alive || current !== sequence) return null
  const result = await api('/api/security/passkeys/authenticate/verify', { method: 'POST', body: { purpose: 'reauth', challenge_token: challenge.challenge_token, response } })
  if (!alive || current !== sequence) return null
  return { password, proof_token: result.proof_token }
}
async function completed(result: any, text: string, current: number) {
  if (!alive || current !== sequence) return
  clearEnrollment(); action.value = ''; selectedFactor.value = null; message.value = text
  if (Array.isArray(result.recovery_codes) && result.recovery_codes.length) { recoveryCodes.value = result.recovery_codes; savedCodes.value = false }
  await auth.refresh()
  if (!alive || current !== sequence) return
  const latest = await api('/api/security/status')
  if (alive && current === sequence) applyStatus(latest)
}
async function submitAction() {
  if (busy.value || !action.value || expired.value || recoveryCodes.value.length || ((action.value === 'remove' || action.value === 'recovery') && !confirmation.value)) return
  busy.value = true; error.value = ''; message.value = ''
  const current = ++sequence, selectedAction = action.value
  try {
    const proof = await authorization(current)
    if (!proof || !alive || current !== sequence) return
    if (selectedAction === 'reauth') {
      if (credentials.method === 'totp') await api('/api/security/reauthenticate', { method: 'POST', body: proof })
      await completed({}, 'Identity confirmed. You can return to your sensitive action now.', current)
    } else if (selectedAction === 'totp') {
      const result = await api('/api/security/totp/begin', { method: 'POST', body: { ...proof, label: label.value.trim() || 'Authenticator app' } })
      if (!alive || current !== sequence) return
      enrollment.value = result
      try { const image = await QRCode.toDataURL(result.uri, { width: 240, margin: 2, errorCorrectionLevel: 'M' }); if (alive && current === sequence) qr.value = image }
      catch { if (alive && current === sequence) message.value = 'QR code unavailable. Enter the setup key in your authenticator app instead.' }
    } else if (selectedAction === 'passkey') {
      const challenge = await api('/api/security/passkeys/begin', { method: 'POST', body: { ...proof, label: label.value.trim() || 'Passkey or security key' } })
      if (!alive || current !== sequence) return
      const response = await startRegistration({ optionsJSON: challenge.options })
      if (!alive || current !== sequence) return
      const result = await api('/api/security/passkeys/verify', { method: 'POST', body: { challenge_token: challenge.challenge_token, response } })
      await completed(result, 'Passkey added. Keep a second factor or recovery codes somewhere safe.', current)
    } else {
      const result = await api(selectedAction === 'remove' ? '/api/security/factors/remove' : '/api/security/recovery/regenerate', { method: 'POST', body: { ...proof, ...(selectedAction === 'remove' ? { factor_id: selectedFactor.value.id } : {}) } })
      await completed(result, selectedAction === 'remove' ? 'Factor removed. Other sessions have been signed out.' : 'New recovery codes created. All previous recovery codes are now invalid.', current)
    }
  } catch (e: any) { if (alive && current === sequence) error.value = e?.name === 'NotAllowedError' || e?.name === 'AbortError' ? 'The passkey request was cancelled or timed out. Try again when you’re ready.' : errorMessage(e) }
  finally { clearCredentials(); if (alive && current === sequence) busy.value = false }
}
async function verifyTotp() {
  if (busy.value || !enrollment.value || expired.value) return
  busy.value = true; error.value = ''; message.value = ''
  const current = ++sequence
  try { const result = await api('/api/security/totp/verify', { method: 'POST', body: { challenge_token: enrollment.value.challenge_token, code: enrollmentCode.value } }); await completed(result, 'Authenticator added. Keep a second factor or recovery codes somewhere safe.', current) }
  catch (e) { if (alive && current === sequence) error.value = errorMessage(e) }
  finally { enrollmentCode.value = ''; if (alive && current === sequence) busy.value = false }
}
async function signOut() {
  if (busy.value) return
  if (recoveryCodes.value.length && !savedCodes.value && !window.confirm('These recovery codes are shown only once. Sign out without saving them?')) return
  allowUnsavedLeave = true
  busy.value = true; error.value = ''; clearCredentials(); clearEnrollment()
  try { await auth.logout() } catch (e) { allowUnsavedLeave = false; if (alive) error.value = errorMessage(e) } finally { if (alive) busy.value = false }
}
function dismissCodes() { if (savedCodes.value) { clearRecovery(); message.value = 'Recovery codes saved. Store them separately from your sign-in device.' } }
function dateLabel(value: string) { return value ? new Date(value).toLocaleDateString() : 'Never' }
</script>
<template>
  <div class="security-box">
    <span class="eyebrow">ACCOUNT SECURITY</span><h1>{{ bootstrap ? 'Secure your account.' : 'Your sign-in safeguards.' }}</h1>
    <p class="muted">{{ bootstrap ? 'Enroll an authenticator app or a passkey to finish signing in. Your private workspace stays locked until this step is complete.' : 'Add backup factors, review your devices and keep recovery codes offline.' }}</p>
    <p v-if="error" class="alert error" role="alert">{{ error }}</p><button v-if="error && status" type="button" class="text-button" :disabled="busy || loading" @click="load">Reload security status</button><p v-if="message" class="alert info" role="status">{{ message }}</p>
    <p v-if="loading" class="loading-panel" role="status">Loading security settings…</p>
    <button v-if="!loading && !status" type="button" class="button secondary" @click="load">Retry security settings</button>
    <template v-if="status && !loading">
      <p v-if="bootstrap && pending.recovery_mode" class="alert warning">Recovery is in progress. Enroll a new factor before you can use your account. Your previous factors and recovery codes will be replaced.</p>
      <p v-if="expired" class="alert warning" role="alert">This enrollment session has expired. Sign out and sign in again to restart.</p>
      <section v-if="recoveryCodes.length" class="panel security-panel" aria-labelledby="recovery-heading">
        <h2 id="recovery-heading">Save these recovery codes now.</h2>
        <p>Each code works once. These are shown only here, only now. Keep a copy offline in a safe place, separate from your phone or security key.</p>
        <p class="small muted">Anyone with your password and a recovery code can replace your factors. Do not share these codes or send them by email.</p>
        <ul class="recovery-codes" aria-label="One-time recovery codes"><li v-for="value in recoveryCodes" :key="value"><code>{{ value }}</code></li></ul>
        <label class="checkbox-label"><input v-model="savedCodes" type="checkbox" />I have saved these codes somewhere safe offline.</label>
        <button type="button" class="button primary full spaced" :disabled="!savedCodes" @click="dismissCodes">Done, hide recovery codes</button>
      </section>
      <template v-else-if="!expired">
        <section v-if="!bootstrap && factors.length && !action" class="panel security-panel"><h2>Sensitive actions</h2><p class="small muted">Some administrator and account changes require a fresh password and factor check. Return here when asked to verify again.</p><p class="small"><span class="badge" :class="status.recent_strong_auth ? 'green' : 'amber'">{{ status.recent_strong_auth ? 'Identity recently confirmed' : 'Fresh verification needed' }}</span></p><button type="button" class="button secondary full" :disabled="busy" @click="choose('reauth')">Verify for sensitive actions</button></section>
        <section v-if="!bootstrap" class="panel security-panel" aria-labelledby="factors-heading">
          <h2 id="factors-heading">Your factors</h2>
          <p v-if="!factors.length" class="small muted">MFA is not enabled yet. Adding a factor protects every new sign-in after your password.</p>
          <p v-if="factors.length" class="small muted">Add a replacement before removing your last factor.<template v-if="status.user?.role === 'admin' && status.require_admin_mfa"> MFA is required for administrator accounts on this server.</template></p>
          <ul v-if="factors.length" class="factor-list"><li v-for="factor in factors" :key="factor.id"><div><strong>{{ factor.label || (factor.kind === 'totp' ? 'Authenticator app' : 'Passkey or security key') }}</strong><span class="small muted">{{ factor.kind === 'totp' ? 'Authenticator app' : 'Passkey / FIDO2 security key' }} · Added {{ dateLabel(factor.created_at) }}</span><span class="small muted">Last used: {{ dateLabel(factor.last_used_at) }}</span></div><button type="button" class="text-button danger-text" :disabled="busy || lastRequiredFactor" :aria-label="'Remove ' + (factor.label || factor.kind)" @click="choose('remove', factor)">Remove</button></li></ul>
          <p v-if="factors.length" class="small muted">{{ status.recovery_codes_remaining }} unused recovery codes remain.</p>
        </section>
        <div v-if="!action" class="form-stack">
          <button type="button" class="button primary full" :disabled="busy" @click="choose('totp')">Add an authenticator app</button>
          <button type="button" class="button secondary full" :disabled="busy || !passkeysSupported" @click="choose('passkey')">Add a passkey or security key</button>
          <p class="small muted">Use a device passkey or a FIDO2 hardware key such as a YubiKey. Register a spare separately so you have a backup.</p>
          <p v-if="!passkeysSupported" class="alert warning">Passkeys require a supported browser and HTTPS (or localhost). You can use an authenticator app here.</p>
          <button v-if="!bootstrap && factors.length" type="button" class="text-button" :disabled="busy" @click="choose('recovery')">Replace recovery codes</button>
        </div>
        <section v-else class="panel security-panel">
          <template v-if="enrollment">
            <h2>Set up your authenticator</h2><p class="small muted">Scan this QR code with your authenticator app, then enter its six-digit code. This factor is not active until you verify it.</p>
            <img v-if="qr" class="totp-qr" :src="qr" width="240" height="240" alt="Authenticator setup QR code. A manual setup key follows." />
            <label>Manual setup key<input :value="enrollment.secret" readonly autocomplete="off" spellcheck="false" aria-label="Manual authenticator setup key" /></label>
            <p class="small muted spaced">Keep this setup key secret. If this setup expires, cancel and start again for a new key.</p>
            <form class="form-stack" @submit.prevent="verifyTotp"><label>Authenticator code<input v-model="enrollmentCode" required inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" :disabled="busy" /></label><button class="button primary full" :disabled="busy">{{ busy ? 'Verifying…' : 'Verify and enable authenticator' }}</button></form>
          </template>
          <form v-else class="form-stack" @submit.prevent="submitAction">
            <h2>{{ action === 'totp' ? 'Add an authenticator app' : action === 'passkey' ? 'Add a passkey or security key' : action === 'remove' ? 'Remove this factor?' : action === 'reauth' ? 'Verify your identity' : 'Replace recovery codes?' }}</h2>
            <label v-if="action === 'totp' || action === 'passkey'">Name for this factor<input v-model="label" maxlength="80" :placeholder="action === 'totp' ? 'My authenticator' : 'Laptop passkey or spare YubiKey'" autocomplete="off" :disabled="busy" /></label>
            <p class="small muted">For this change, confirm your current password{{ needsStrongAuth ? ' and an existing factor' : '' }}.<template v-if="action !== 'reauth'"> Each confirmation authorizes one factor change only.</template></p>
            <label>Current password<input v-model="credentials.password" type="password" required maxlength="128" autocomplete="current-password" :disabled="busy" /></label>
            <template v-if="needsStrongAuth">
              <label>Confirm with<select v-model="credentials.method" :disabled="busy"><option v-if="status.totp.length" value="totp">Authenticator code</option><option v-if="status.passkeys.length" value="passkey">Passkey or security key</option></select></label>
              <label v-if="credentials.method === 'totp'">Current authenticator code<input v-model="credentials.code" required inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" :disabled="busy" /><small>If you just used a code, wait for the next one.</small></label>
              <p v-else class="small muted">Your browser will ask for your existing passkey or security key before making this change.</p>
            </template>
            <template v-if="action === 'remove'"><p class="alert warning">Remove {{ selectedFactor?.label || 'this factor' }}? Other sessions will be signed out.</p><label class="checkbox-label"><input v-model="confirmation" type="checkbox" required :disabled="busy" />I want to remove this factor.</label></template>
            <template v-if="action === 'recovery'"><p class="alert warning">All existing recovery codes stop working immediately. Save the new codes before leaving this page.</p><label class="checkbox-label"><input v-model="confirmation" type="checkbox" required :disabled="busy" />Replace all my previous recovery codes.</label></template>
            <button class="button full" :class="action === 'remove' ? 'danger' : 'primary'" :disabled="busy || (needsStrongAuth && credentials.method === 'passkey' && !passkeysSupported)">{{ busy ? 'Please wait…' : action === 'totp' ? 'Continue to setup' : action === 'passkey' ? 'Create passkey or security key' : action === 'remove' ? 'Remove factor' : action === 'reauth' ? 'Verify identity' : 'Create new recovery codes' }}</button>
          </form>
          <button type="button" class="text-button spaced" :disabled="busy" @click="cancelAction">Cancel</button>
        </section>
      </template>
      <div class="button-row spaced"><NuxtLink v-if="status.user && !recoveryCodes.length" :to="route.query.next ? next : '/account'" class="button secondary">{{ route.query.next ? 'Continue to your account' : 'Back to account' }}</NuxtLink><button type="button" class="text-button" :disabled="busy" @click="signOut">{{ bootstrap ? 'Cancel and sign out' : 'Sign out' }}</button></div>
      <p class="small muted spaced">Password resets and email verification do not disable MFA. If you lose all factors and recovery codes, contact the server administrator for the controlled recovery process.</p>
    </template>
  </div>
</template>
<style scoped>
.security-box{width:100%;max-width:560px;padding-block:20px}.security-box>h1{font-size:30px}.security-panel{padding:22px;margin-block:22px}.security-panel h2{font-size:19px}.security-panel p{font-size:12px}.security-panel .form-stack h2{margin-bottom:0}.factor-list{list-style:none;margin:0 0 18px;padding:0}.factor-list li{display:flex;gap:16px;justify-content:space-between;align-items:center;padding:14px 0;border-bottom:1px solid var(--line)}.factor-list li>div{min-width:0;overflow-wrap:anywhere}.factor-list strong,.factor-list span{display:block}.factor-list strong{font-size:13px;margin-bottom:5px}.factor-list button{flex-shrink:0}.recovery-codes{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;list-style:none;margin:20px 0;padding:16px;background:var(--surface-soft);border-radius:10px}.recovery-codes code{font-size:12px;overflow-wrap:anywhere}.totp-qr{display:block;margin:16px auto;background:#fff;max-width:100%;height:auto}.security-box .checkbox-label{align-items:flex-start}.security-box .checkbox-label input{margin-top:3px}.security-box .button{white-space:normal}
@media(max-width:500px){.security-panel{padding:18px}.security-box>h1{font-size:27px}.recovery-codes{grid-template-columns:1fr}}
</style>
