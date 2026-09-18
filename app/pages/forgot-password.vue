<script setup lang="ts">
definePageMeta({ layout: 'auth' })
useSeoMeta({ title: 'Recover your password · CardShelf', robots: 'noindex, nofollow' })
const api = useApi(), email = ref(''), busy = ref(false), message = ref(''), error = ref('')
async function submit() {
  if (busy.value) return
  busy.value = true; message.value = ''; error.value = ''
  try { message.value = (await api('/api/public/password-recovery/request', { method: 'POST', body: { email: email.value } })).message }
  catch (e) { error.value = errorMessage(e) }
  finally { busy.value = false }
}
</script>
<template>
  <div class="login-box"><span class="eyebrow">ACCOUNT RECOVERY</span><h1>Forgot your password?</h1>
    <p class="muted">Enter your account email address. A one-time link lets you choose a new password without sharing it with anyone.</p>
    <form class="form-stack" @submit.prevent="submit"><label>Email address<input v-model="email" type="email" maxlength="254" required autocomplete="username" :disabled="busy"></label>
      <p v-if="message" class="alert info" role="status">{{ message }}</p><p v-if="error" class="alert error" role="alert">{{ error }}</p>
      <button class="button primary full" :disabled="busy">{{ busy ? 'Requesting…' : 'Send recovery link' }}</button>
    </form><p class="data-note">Links expire after 30 minutes. Email delivery must be configured by your administrator; they can also provide a secure one-time link.</p>
    <p><NuxtLink to="/login">Back to sign in</NuxtLink></p>
  </div>
</template>
