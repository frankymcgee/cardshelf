<script setup lang="ts">
import { startAuthentication, WebAuthnAbortService } from '@simplewebauthn/browser'
import { safeReturnTo } from '../../shared/platform.mjs'
definePageMeta({ layout: 'auth' })
useSeoMeta({ title: 'Sign in · CardShelf', robots: 'noindex, nofollow' })
const auth = useAuth(), api = useApi(), route = useRoute()
const form = reactive({ name: '', email: '', password: '', token: '' })
const busy = ref(false), error = ref(''), message = ref(''), verificationEmail = ref(''), showResend = ref(false)
const code = ref(''), recoveryCode = ref(''), recoveryPassword = ref(''), showRecovery = ref(false), now = ref(Date.now())
const setup = computed(() => auth.state.value.setup_required)
const pending = computed(() => auth.state.value.pending)
const expired = computed(() => pending.value?.expires_at && Date.parse(pending.value.expires_at) <= now.value)
let alive = true, sequence = 0, timer: ReturnType<typeof setInterval> | undefined
onMounted(async () => {
  timer = setInterval(() => { now.value = Date.now() }, 15000)
  try { await auth.refresh(); if (alive && pending.value?.scope === 'enrollment') await navigateTo({ path: '/security', query: { next: safeReturnTo(route.query.next) } }) }
  catch (e) { if (alive) error.value = errorMessage(e) }
})
onBeforeUnmount(() => { alive = false; sequence++; clearInterval(timer); WebAuthnAbortService.cancelCeremony(); clearSecrets() })
function clearSecrets() { form.password = ''; form.token = ''; code.value = ''; recoveryCode.value = ''; recoveryPassword.value = '' }
async function finish(result: any, current: number) {
  if (!alive || current !== sequence) return
  if (result.pending?.scope === 'email_verification') {
    verificationEmail.value = form.email; showResend.value = true
    message.value = 'Verify your email address before your first sign-in. Check your inbox or request a new link.'
    return
  }
  await auth.refresh()
  if (!alive || current !== sequence) return
  if (auth.state.value.pending?.scope === 'enrollment') await navigateTo({ path: '/security', query: { next: safeReturnTo(route.query.next) } })
  else if (auth.state.value.user) await navigateTo(safeReturnTo(route.query.next))
}
async function submit() {
  if (busy.value) return
  busy.value = true; error.value = ''; message.value = ''
  const current = ++sequence
  try { const result = await api(setup.value ? '/api/setup' : '/api/login', { method: 'POST', body: { ...form } }); if (alive && current === sequence) await finish(result, current) }
  catch (e) { if (alive && current === sequence) error.value = errorMessage(e) }
  finally { clearSecrets(); if (alive && current === sequence) busy.value = false }
}
async function secondFactor(method: 'totp' | 'passkey' | 'recovery') {
  if (busy.value || expired.value) return
  busy.value = true; error.value = ''; message.value = ''
  const current = ++sequence
  try {
    let result: any
    if (method === 'passkey') {
      const challenge = await api('/api/security/passkeys/authenticate/begin', { method: 'POST', body: { purpose: 'login' } })
      if (!alive || current !== sequence) return
      const response = await startAuthentication({ optionsJSON: challenge.options })
      if (!alive || current !== sequence) return
      result = await api('/api/security/passkeys/authenticate/verify', { method: 'POST', body: { purpose: 'login', challenge_token: challenge.challenge_token, response } })
    } else result = await api(method === 'totp' ? '/api/security/totp/login' : '/api/security/recovery/redeem', { method: 'POST', body: method === 'totp' ? { code: code.value } : { password: recoveryPassword.value, code: recoveryCode.value } })
    if (alive && current === sequence) await finish(result, current)
  } catch (e: any) { if (alive && current === sequence) error.value = e?.name === 'NotAllowedError' || e?.name === 'AbortError' ? 'The passkey request was cancelled or timed out. Try again or use another method.' : errorMessage(e) }
  finally { clearSecrets(); if (alive && current === sequence) busy.value = false }
}
async function cancel() {
  if (busy.value) return
  sequence++; WebAuthnAbortService.cancelCeremony(); clearSecrets(); busy.value = true; error.value = ''
  try { await auth.logout() } catch (e) { if (alive) error.value = errorMessage(e) } finally { if (alive) busy.value = false }
}
async function resend() {
  if (busy.value) return
  busy.value = true; error.value = ''; message.value = ''
  try { const result = await api('/api/public/email-verification/request', { method: 'POST', body: { email: verificationEmail.value } }); if (alive) message.value = result.message }
  catch (e) { if (alive) error.value = errorMessage(e) } finally { if (alive) busy.value = false }
}
</script>
<template>
  <div class="login-box">
    <div class="auth-logo-mobile"><img src="/icon.svg" alt="" />CardShelf</div>
    <span class="eyebrow">{{ pending ? 'SECURE SIGN-IN' : setup ? 'FIRST-TIME SETUP' : 'WELCOME BACK' }}</span>
    <h1>{{ pending ? 'One more check.' : setup ? 'Make it yours.' : 'Your collection awaits.' }}</h1>
    <p class="muted">{{ pending ? 'Use an enrolled authenticator or passkey to finish signing in.' : setup ? 'Create the administrator account for this server. You can add an authenticator or passkey in Account security.' : 'Sign in with your existing CardShelf account.' }}</p>
    <p v-if="error" class="alert error" role="alert">{{ error }}</p>
    <p v-if="message" class="alert info" role="status">{{ message }}</p>
    <template v-if="pending">
      <p v-if="expired" class="alert warning" role="alert">This sign-in has expired. Cancel and start again.</p>
      <template v-else>
        <template v-if="!showRecovery">
          <form v-if="pending.methods?.includes('totp')" class="form-stack" @submit.prevent="secondFactor('totp')">
            <label>Authenticator code<input v-model="code" required inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" :disabled="busy" /></label>
            <button class="button primary full" :disabled="busy">{{ busy ? 'Checking…' : 'Verify and sign in' }}</button>
          </form>
          <button v-if="pending.methods?.includes('passkey')" type="button" class="button secondary full spaced" :disabled="busy" @click="secondFactor('passkey')">Use a passkey or security key</button>
          <p class="small muted spaced">A registered YubiKey works as a FIDO2 security key. Follow your browser’s prompt to use its PIN or touch sensor.</p>
        </template>
        <form v-else class="form-stack" @submit.prevent="secondFactor('recovery')">
          <p class="alert warning">Recovery codes are one-time use. You must enroll a new factor before account access is restored. Password reset and email verification do not remove MFA.</p>
          <label>Current password<input v-model="recoveryPassword" required type="password" maxlength="128" autocomplete="current-password" :disabled="busy" /></label>
          <label>Recovery code<input v-model="recoveryCode" required maxlength="128" autocomplete="off" autocapitalize="none" spellcheck="false" :disabled="busy" /></label>
          <button class="button primary full" :disabled="busy">{{ busy ? 'Checking…' : 'Recover and replace factors' }}</button>
          <button type="button" class="text-button" :disabled="busy" @click="showRecovery = false; clearSecrets(); error = ''">Back to authenticator or passkey</button>
        </form>
      </template>
      <div class="login-secondary-actions">
        <button v-if="!expired && !showRecovery" type="button" class="text-button" :disabled="busy" @click="showRecovery = true; clearSecrets(); error = ''">Use a recovery code instead</button>
        <button type="button" class="text-button" :disabled="busy" @click="cancel">Cancel sign-in</button>
      </div>
    </template>
    <template v-else>
      <form v-if="!showResend" class="form-stack" @submit.prevent="submit">
        <label v-if="setup">Your name<input v-model="form.name" required maxlength="80" autocomplete="name" :disabled="busy" /></label>
        <label>Email address<input v-model="form.email" required type="email" maxlength="254" autocomplete="username" :disabled="busy" /></label>
        <label>Password<input v-model="form.password" required type="password" :minlength="setup ? 12 : 1" maxlength="128" :autocomplete="setup ? 'new-password' : 'current-password'" :disabled="busy" /><small v-if="setup">Use at least 12 characters.</small></label>
        <label v-if="setup">Server setup token<input v-model="form.token" required type="password" autocomplete="off" :disabled="busy" /><small>Use BOOTSTRAP_TOKEN from the server’s .env file. This prevents anyone else claiming your installation.</small></label>
        <button class="button primary full" :disabled="busy || !auth.state.value.loaded">{{ busy ? 'Please wait…' : setup ? 'Create my workspace' : 'Sign in' }}<AppIcon name="arrow" /></button>
      </form>
      <form v-else class="form-stack" @submit.prevent="resend">
        <label>Email address<input v-model="verificationEmail" required type="email" maxlength="254" autocomplete="email" :disabled="busy" /></label>
        <button class="button primary full" :disabled="busy">{{ busy ? 'Requesting…' : 'Request verification email' }}</button>
        <button type="button" class="text-button" :disabled="busy" @click="showResend = false; message = ''; error = ''">Back to sign in</button>
      </form>
      <p v-if="!setup && !showResend" class="login-foot"><NuxtLink to="/forgot-password">Forgot your password?</NuxtLink></p>
      <p v-if="!setup && !showResend" class="login-foot"><button type="button" class="text-button" :disabled="busy" @click="verificationEmail = form.email; showResend = true; clearSecrets(); error = ''">Resend verification email</button></p>
      <p class="login-foot"><AppIcon name="shield" :size="16" />{{ setup ? 'Setup closes after the first account is created.' : 'Use the Free account options to create a new account.' }}</p>
      <p class="login-foot"><NuxtLink to="/">Back to the website</NuxtLink><span aria-hidden="true"> · </span><NuxtLink to="/register">Create a Free account</NuxtLink><span aria-hidden="true"> · </span><NuxtLink to="/contact">Contact</NuxtLink></p>
    </template>
  </div>
</template>
<style scoped>
.login-secondary-actions{display:flex;flex-wrap:wrap;align-items:center;gap:12px 20px;margin-top:18px}.login-secondary-actions .text-button{min-height:44px;text-align:left}
</style>
