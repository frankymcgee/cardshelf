<script setup lang="ts">
definePageMeta({ layout: 'auth' })
useSeoMeta({ title: 'Verify your email · CardShelf', robots: 'noindex, nofollow', referrer: 'no-referrer' })
const api = useApi()
const token = ref(''), password = ref(''), email = ref(''), busy = ref(false), ready = ref(false), verified = ref(false), message = ref(''), error = ref('')
let alive = true
onMounted(() => {
  const value = new URLSearchParams(window.location.hash.slice(1)).get('token') || ''
  // Remove the secret immediately; only this component's memory retains it.
  window.history.replaceState(window.history.state, '', '/verify-email')
  if (/^[a-f0-9]{64}$/.test(value)) token.value = value
  else error.value = 'Open the link in your verification email, or request a new link below.'
  ready.value = true
})
onBeforeUnmount(() => { alive = false; token.value = ''; password.value = '' })
async function verify() {
  if (busy.value || !token.value) return
  busy.value = true; error.value = ''; message.value = ''
  try {
    const result = await api('/api/public/email-verification/complete', { method: 'POST', body: { token: token.value, password: password.value } })
    if (alive) { message.value = result.message; verified.value = true; token.value = '' }
  } catch (e) { if (alive) error.value = errorMessage(e) }
  finally { password.value = ''; if (alive) busy.value = false }
}
async function resend() {
  if (busy.value) return
  busy.value = true; error.value = ''; message.value = ''
  try { const result = await api('/api/public/email-verification/request', { method: 'POST', body: { email: email.value } }); if (alive) message.value = result.message }
  catch (e) { if (alive) error.value = errorMessage(e) } finally { if (alive) busy.value = false }
}
</script>
<template>
  <div class="login-box"><span class="eyebrow">EMAIL VERIFICATION</span><h1>{{ verified ? 'Email verified.' : 'Confirm your email.' }}</h1>
    <p class="muted">{{ verified ? 'Your address is confirmed. Sign in to continue.' : 'Enter your CardShelf password and confirm to verify this address. Opening the link alone does not activate an account.' }}</p>
    <p v-if="message" class="alert info" role="status">{{ message }}</p><p v-if="error" class="alert error" role="alert">{{ error }}</p>
    <form v-if="ready && token && !verified" class="form-stack" @submit.prevent="verify">
      <label>Current password<input v-model="password" type="password" required maxlength="128" autocomplete="current-password" :disabled="busy" /></label>
      <p class="small muted">Verification links expire after 24 hours and work once. Your MFA, membership and account tier are unchanged.</p>
      <button class="button primary full" :disabled="busy">{{ busy ? 'Verifying…' : 'Verify email address' }}</button>
    </form>
    <details v-if="ready && !verified" class="spaced"><summary>Need a new verification link?</summary><form class="form-stack spaced" @submit.prevent="resend"><label>Email address<input v-model="email" required type="email" maxlength="254" autocomplete="email" :disabled="busy" /></label><button class="button secondary full" :disabled="busy">{{ busy ? 'Requesting…' : 'Request a new link' }}</button></form></details>
    <p class="login-foot"><NuxtLink to="/login">Sign in</NuxtLink><span aria-hidden="true"> · </span><NuxtLink to="/forgot-password">Forgot your password?</NuxtLink></p>
  </div>
</template>
