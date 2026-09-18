<script setup lang="ts">
definePageMeta({ layout: 'auth' })
useSeoMeta({ title: 'Choose a new password · CardShelf', robots: 'noindex, nofollow', referrer: 'no-referrer' })
const api = useApi(), auth = useAuth()
const token = ref(''), password = ref(''), confirmation = ref(''), busy = ref(false), ready = ref(false), message = ref(''), error = ref('')
onMounted(() => {
  const value = new URLSearchParams(window.location.hash.slice(1)).get('token') || ''
  if (/^[a-f0-9]{64}$/.test(value)) token.value = value
  else error.value = 'This link is missing its recovery token. Request a new link or contact your administrator.'
  // Keep the secret only in this component's memory, not browser history/storage.
  window.history.replaceState(window.history.state, '', '/reset-password')
  ready.value = true
})
onBeforeUnmount(() => { token.value = ''; password.value = ''; confirmation.value = '' })
async function submit() {
  if (busy.value || !token.value) return
  error.value = ''
  if (password.value !== confirmation.value) { error.value = 'The new passwords do not match.'; return }
  busy.value = true
  try {
    message.value = (await api('/api/public/password-recovery/complete', { method: 'POST', body: { token: token.value, password: password.value, confirm_password: confirmation.value } })).message
    token.value = ''; auth.state.value = { loaded: true, user: null, setup_required: false }; clearNuxtData()
  } catch (e) { error.value = errorMessage(e) }
  finally { password.value = ''; confirmation.value = ''; busy.value = false }
}
</script>
<template>
  <div class="login-box"><span class="eyebrow">SECURE RESET</span><h1>Choose a new password.</h1>
    <p v-if="message" class="alert info" role="status">{{ message }}</p><p v-if="error" class="alert error" role="alert">{{ error }}</p>
    <form v-if="ready && token && !message" class="form-stack" @submit.prevent="submit">
      <label>New password<input v-model="password" type="password" required minlength="12" maxlength="128" autocomplete="new-password" :disabled="busy"></label>
      <label>Confirm new password<input v-model="confirmation" type="password" required minlength="12" maxlength="128" autocomplete="new-password" :disabled="busy"></label>
      <p class="data-note">Use 12–128 characters. Resetting signs out every existing session for this account and invalidates other reset links. Your cards, subscription and tier do not change.</p>
      <button class="button primary full" :disabled="busy">{{ busy ? 'Resetting…' : 'Reset password' }}</button>
    </form><p><NuxtLink to="/login">Sign in</NuxtLink> · <NuxtLink to="/forgot-password">Request a new link</NuxtLink></p>
  </div>
</template>
