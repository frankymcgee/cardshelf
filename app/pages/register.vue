<script setup lang="ts">
definePageMeta({ layout: 'marketing' })
useMarketingSeo('Free account', 'Create a Free CardShelf account without starting a subscription.', '/register')
const api = useApi(), enabled = ref(false), checked = ref(false), busy = ref(false), created = ref(false), error = ref('')
const form = reactive({ name: '', email: '', password: '', consent: false, website: '' })
let sequence = 0, alive = true
async function load() {
  const current = ++sequence; checked.value = false; enabled.value = false; error.value = ''
  try { const result = await api('/api/public/free-registration'); if (alive && current === sequence) enabled.value = result.enabled }
  catch (e) { if (alive && current === sequence) error.value = errorMessage(e) }
  finally { if (alive && current === sequence) checked.value = true }
}
onMounted(load)
onBeforeUnmount(() => { alive = false; sequence++; form.password = '' })
async function register() {
  if (busy.value || !form.consent) return
  busy.value = true; error.value = ''
  try { await api('/api/public/register', { method: 'POST', body: { ...form } }); if (alive) created.value = true; form.password = '' }
  catch (e) { if (alive) error.value = errorMessage(e) } finally { form.password = ''; if (alive) busy.value = false }
}
</script>
<template><div class="m-container free-catalogue"><header class="catalogue-heading"><h1>Start with Free.</h1><p>No card details. No automatic subscription. Public card information is available even without an account.</p></header><section class="panel free-register-panel"><p v-if="error" class="alert warning" role="alert">{{ enabled ? 'Could not create your account.' : 'Could not check account registration.' }} {{ error }} <button v-if="!enabled" class="text-button" :disabled="!checked" @click="load">Retry</button></p><p v-if="!checked" class="loading-panel" role="status">Checking account registration…</p><div v-if="created"><h2>Check your email.</h2><p>Verify your email address before your first sign-in. Open the link in your inbox and confirm with the password you chose.</p><p class="small muted">If the message does not arrive, check spam or request another verification email from the sign-in page.</p><NuxtLink to="/login" class="m-button">Continue to sign in</NuxtLink></div><form v-else-if="enabled" class="form-stack" @submit.prevent="register"><label>Name<input v-model="form.name" required maxlength="80" autocomplete="name"></label><label>Email<input v-model="form.email" type="email" required maxlength="254" autocomplete="email"></label><label>Password<input v-model="form.password" type="password" required minlength="12" maxlength="128" autocomplete="new-password"></label><label class="registration-honeypot" aria-hidden="true">Website<input v-model="form.website" tabindex="-1" autocomplete="off"></label><label class="checkbox-label"><input v-model="form.consent" required type="checkbox">I have read the privacy notice. Free includes public lookup and may show sponsor messages; private collection tools require a separate paid membership.</label><NuxtLink to="/privacy" class="m-text-link">Privacy & data</NuxtLink><button class="m-button" :disabled="busy || !form.consent">{{ busy ? 'Creating account…' : 'Create Free account' }}</button></form><p v-else-if="checked && !error">New Free account registration is currently paused. <NuxtLink to="/contact?purpose=early_access">Ask about account access</NuxtLink>, or browse without signing in.</p><NuxtLink to="/explore" class="m-text-link">Browse the free catalogue</NuxtLink></section></div></template>
