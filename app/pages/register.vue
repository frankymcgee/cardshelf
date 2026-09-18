<script setup lang="ts">
definePageMeta({ layout: 'marketing' })
useMarketingSeo('Free account', 'Create a Free CardShelf account without starting a subscription.', '/register')
const api = useApi(), enabled = ref(false), checked = ref(false), busy = ref(false), created = ref(false), error = ref('')
const form = reactive({ name: '', email: '', password: '', consent: false, website: '' })
onMounted(async () => { try { enabled.value = (await api('/api/public/free-registration')).enabled } catch (e) { error.value = errorMessage(e) } finally { checked.value = true } })
async function register() {
  if (busy.value || !form.consent) return
  busy.value = true; error.value = ''
  try { await api('/api/public/register', { method: 'POST', body: { ...form } }); created.value = true; form.password = '' }
  catch (e) { error.value = errorMessage(e) } finally { busy.value = false }
}
</script>
<template><div class="m-container free-catalogue"><header class="catalogue-heading"><h1>Start with Free.</h1><p>No card details. No automatic subscription. Public card information is available even without an account.</p></header><section class="panel free-register-panel"><p v-if="error" class="alert warning">{{ error }}</p><div v-if="created"><h2>Your Free account is ready.</h2><p>Sign in with the email and password you chose.</p><NuxtLink to="/login" class="m-button">Sign in</NuxtLink></div><form v-else-if="enabled" class="form-stack" @submit.prevent="register"><label>Name<input v-model="form.name" required maxlength="80" autocomplete="name"></label><label>Email<input v-model="form.email" type="email" required maxlength="254" autocomplete="email"></label><label>Password<input v-model="form.password" type="password" required minlength="12" maxlength="128" autocomplete="new-password"></label><label class="registration-honeypot" aria-hidden="true">Website<input v-model="form.website" tabindex="-1" autocomplete="off"></label><label class="checkbox-label"><input v-model="form.consent" required type="checkbox">I have read the privacy notice. Free includes public lookup and may show sponsor messages; private collection tools require a separate paid membership.</label><NuxtLink to="/privacy" class="m-text-link">Privacy & data</NuxtLink><button class="m-button" :disabled="busy || !form.consent">{{ busy ? 'Creating account…' : 'Create Free account' }}</button></form><p v-else-if="checked">Free self-registration is not open yet. <NuxtLink to="/early-access">Request access from the administrator</NuxtLink>, or browse without signing in.</p><NuxtLink to="/explore" class="m-text-link">Browse the free catalogue</NuxtLink></section></div></template>
