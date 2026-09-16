<script setup lang="ts">
import { safeReturnTo } from '../../shared/platform.mjs'
definePageMeta({ layout: 'auth' })
const auth = useAuth(), api = useApi(), route = useRoute()
const form = reactive({ name: '', email: '', password: '', token: '' })
const busy = ref(false), error = ref(''), setup = computed(() => auth.state.value.setup_required)
onMounted(async () => { try { await auth.refresh() } catch (e) { error.value = errorMessage(e) } })
async function submit() {
  busy.value = true; error.value = ''
  try {
    await api(setup.value ? '/api/setup' : '/api/login', { method: 'POST', body: { ...form } })
    await auth.refresh(); await navigateTo(safeReturnTo(route.query.next))
  } catch (e) { error.value = errorMessage(e) } finally { busy.value = false }
}
</script>
<template><div class="login-box"><div class="auth-logo-mobile"><img src="/icon.svg" alt="" />CardShelf</div><span class="eyebrow">{{ setup ? 'FIRST-TIME SETUP' : 'WELCOME BACK' }}</span><h1>{{ setup ? 'Make it yours.' : 'Your collection awaits.' }}</h1><p class="muted">{{ setup ? 'Create the administrator account for this server.' : 'Sign in with your existing CardShelf account.' }}</p><form class="form-stack" @submit.prevent="submit"><label v-if="setup">Your name<input v-model="form.name" required maxlength="80" autocomplete="name" /></label><label>Email address<input v-model="form.email" required type="email" maxlength="254" autocomplete="username" /></label><label>Password<input v-model="form.password" required type="password" :minlength="setup ? 12 : 1" maxlength="128" :autocomplete="setup ? 'new-password' : 'current-password'" /><small v-if="setup">Use at least 12 characters.</small></label><label v-if="setup">Server setup token<input v-model="form.token" required type="password" autocomplete="off" /><small>Use BOOTSTRAP_TOKEN from the server’s .env file. This prevents anyone else claiming your installation.</small></label><p v-if="error" class="alert error" role="alert">{{ error }}</p><button class="button primary full" :disabled="busy || !auth.state.value.loaded">{{ busy ? 'Please wait…' : setup ? 'Create my workspace' : 'Sign in' }}<AppIcon name="arrow" /></button></form><p class="login-foot"><AppIcon name="shield" :size="16" />{{ setup ? 'Setup closes after the first account is created.' : 'Accounts are created by your server administrator.' }}</p><p class="login-foot"><NuxtLink to="/">Back to the website</NuxtLink><span aria-hidden="true"> · </span><NuxtLink to="/early-access">Request access</NuxtLink></p></div></template>
