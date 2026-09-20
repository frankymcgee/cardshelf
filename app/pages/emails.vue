<script setup lang="ts">
const api = useApi(), auth = useAuth()
const loading = ref(true), ready = ref(false), busy = ref(false), error = ref(''), notice = ref(''), conflict = ref(false)
const preferences = reactive({ marketplace: false, membership: false, revision: 0 })
let alive = true
async function load() {
  if (busy.value) return
  loading.value = true; error.value = ''
  try { const result = await api('/api/emails/preferences'); if (alive) { preferences.marketplace = result.marketplace; preferences.membership = result.membership; preferences.revision = result.revision; ready.value = true; conflict.value = false } }
  catch (e) { if (alive) error.value = errorMessage(e) }
  finally { if (alive) loading.value = false }
}
async function save() {
  if (busy.value || loading.value || !ready.value || conflict.value) return
  busy.value = true; error.value = ''; notice.value = ''
  try { const result = await api('/api/emails/preferences', { method: 'PATCH', body: { marketplace: preferences.marketplace, membership: preferences.membership, revision: preferences.revision } }); if (alive) { preferences.revision = result.revision; notice.value = 'Your email preferences have been saved.' } }
  catch (e: any) { if (alive) { error.value = errorMessage(e); if ((e?.statusCode || e?.status) === 409) { conflict.value = true; error.value += ' Reload your saved preferences before making another change.' } } }
  finally { if (alive) busy.value = false }
}
onMounted(load)
onBeforeUnmount(() => { alive = false })
useSeoMeta({ title: 'Email preferences · CardShelf', robots: 'noindex, nofollow' })
</script>
<template>
  <main class="email-preferences">
    <header class="page-heading"><div><span class="eyebrow">MORE · YOUR ACCOUNT</span><h1>Your email preferences</h1><p>Choose which CardShelf updates arrive in your inbox.</p></div><NuxtLink v-if="auth.state.value.user?.role === 'admin'" to="/admin/emails" class="button secondary">Manage email delivery</NuxtLink></header>
    <p v-if="error" class="alert error" role="alert">{{ error }}</p><p v-if="notice" class="alert info" role="status">{{ notice }}</p>
    <p v-if="loading" class="loading-panel" role="status">Loading your preferences…</p>
    <form v-if="ready" class="panel email-preferences-panel" @submit.prevent="save">
      <div class="email-preference-row"><div class="email-preference-symbol"><AppIcon name="mail" :size="22" /></div><label for="marketplace-email"><strong>Marketplace emails</strong><span>New enquiries about your listings and replies to your enquiries. Open CardShelf to read and respond to the conversation.</span></label><input id="marketplace-email" v-model="preferences.marketplace" type="checkbox" :disabled="busy || loading || conflict"></div>
      <div class="email-preference-row"><div class="email-preference-symbol"><AppIcon name="star" :size="22" /></div><label for="membership-email"><strong>Membership emails</strong><span>Updates when an administrator changes your CardShelf membership assignment.</span></label><input id="membership-email" v-model="preferences.membership" type="checkbox" :disabled="busy || loading || conflict"></div>
      <div class="email-preference-row email-security-row"><div class="email-preference-symbol"><AppIcon name="shield" :size="22" /></div><div><h2>Account security</h2><p>Password recovery and essential account security emails are mandatory and are not controlled by these optional preferences.</p></div><span class="badge">Required</span></div>
      <div class="email-preferences-actions"><p class="small muted">Optional emails start switched off. Enabling them does not subscribe you to marketing.</p><div class="button-row"><button class="button primary" :disabled="busy || loading || conflict">{{ busy ? 'Saving…' : 'Save preferences' }}</button><button v-if="conflict" type="button" class="button secondary" :disabled="busy" @click="load">Reload saved preferences</button></div></div>
    </form>
    <button v-if="!loading && !ready" class="button secondary" @click="load">Try again</button>
  </main>
</template>
<style scoped>
.email-preferences{max-width:940px}.email-preferences-panel{padding:0 26px;overflow:hidden}.email-preference-row{display:grid;grid-template-columns:42px minmax(0,1fr) auto;align-items:start;gap:18px;padding:28px 0;border-bottom:1px solid var(--line)}.email-preference-symbol{width:42px;height:42px;display:grid;place-items:center;background:var(--bg);border-radius:12px;color:var(--primary)}.email-preference-row label{cursor:pointer;color:var(--ink);font-weight:400}.email-preference-row label strong{font-size:15px;display:block;margin-bottom:7px}.email-preference-row label span,.email-preference-row p{display:block;font-size:12px;color:var(--muted);line-height:1.7;margin:0}.email-preference-row input{width:23px;height:23px;margin-top:7px}.email-security-row h2{font-size:15px;letter-spacing:0;margin-bottom:7px}.email-security-row .badge{margin-top:5px}.email-preferences-actions{padding:24px 0}.email-preferences-actions p{margin-bottom:18px}.email-preferences .page-heading{align-items:start}.email-preferences .page-heading .button{flex-shrink:0}@media(max-width:620px){.email-preferences-panel{padding:0 18px}.email-preference-row{grid-template-columns:32px minmax(0,1fr) auto;gap:12px;padding:22px 0}.email-preference-symbol{width:32px;height:32px;border-radius:9px}.email-security-row>.badge{grid-column:2;justify-self:start}.email-preferences .page-heading{display:block}.email-preferences .page-heading .button{margin-top:18px}}
</style>
