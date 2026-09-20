<script setup lang="ts">
interface Account { id: string; name: string; email: string; role: string }
const api = useApi(), notice = useNotice()
const search = ref(''), data = ref<any>(null), selected = ref<Account | null>(null), password = ref(''), reason = ref(''), delivery = ref('email'), confirmed = ref(false)
const busy = ref(false), error = ref(''), result = ref<any>(null)
let sequence = 0, alive = true
async function load() {
  const request = ++sequence; error.value = ''
  try { const value = await api('/api/admin/password-recovery', { query: { q: search.value } }); if (alive && request === sequence) data.value = value }
  catch (e) { if (alive && request === sequence) error.value = errorMessage(e) }
}
onMounted(load)
onBeforeUnmount(() => { alive = false; sequence++; password.value = ''; result.value = null })
function choose(user: Account) { selected.value = user; result.value = null; confirmed.value = false; password.value = ''; delivery.value = data.value?.mail.configured ? 'email' : 'link' }
async function submit() {
  if (busy.value || !selected.value) return
  busy.value = true; error.value = ''; result.value = null
  try {
    result.value = await api('/api/admin/password-recovery/request', { method: 'POST', body: { user_id: selected.value.id, password: password.value, reason: reason.value, delivery: delivery.value, confirm_identity: confirmed.value } })
    notice.show(delivery.value === 'email' ? 'Recovery email queued.' : 'One-time recovery link generated.'); load()
  } catch (e) { error.value = errorMessage(e) }
  finally { busy.value = false; password.value = ''; confirmed.value = false }
}
async function copy() {
  try { await navigator.clipboard.writeText(result.value.url); notice.show('Recovery link copied. Treat it like a temporary password.') }
  catch { notice.show('Select and copy the link manually.', 'error') }
}
</script>
<template>
  <header class="page-heading"><div><span class="eyebrow">ACCOUNT SECURITY</span><h1>Password recovery</h1><p>Help an account holder choose a new password. Existing passwords are never shown.</p></div></header>
  <p v-if="error" class="alert error" role="alert">{{ error }}</p>
  <section v-if="data" class="panel recovery-panel"><h2>Email delivery</h2><p>{{ data.mail.message }}</p><p class="data-note">Manage the Postal connection, sender, delivery history and test emails in the central Emails workspace. Password recovery remains available here.</p><div class="button-row"><NuxtLink to="/admin/emails" class="button secondary">Manage Emails</NuxtLink><span v-for="row in data.queue" :key="row.status" class="badge">{{ row.status }}: {{ row.count }}</span></div></section>
  <section class="panel recovery-panel"><h2>Find an account</h2><form class="search-row" @submit.prevent="load"><label>Name or email<input v-model="search" minlength="2" maxlength="100" type="search" placeholder="Enter at least two characters"></label><button class="button secondary">Search</button></form>
    <div v-if="data?.users.length" class="table-scroll"><table><thead><tr><th>Account</th><th>Role</th><th>Action</th></tr></thead><tbody><tr v-for="user in data.users" :key="user.id"><td>{{ user.name }}<br>{{ user.email }}</td><td>{{ user.role }}</td><td><button class="button secondary" :disabled="busy" @click="choose(user)">Reset password</button></td></tr></tbody></table></div>
    <p v-else class="data-note">Search for an existing account. Up to 30 matches are shown.</p>
  </section>
  <form v-if="selected" class="panel recovery-panel form-stack" @submit.prevent="submit"><h2>Reset for {{ selected.name }}</h2><p>{{ selected.email }}</p>
    <label>Delivery<select v-model="delivery" :disabled="busy"><option value="email" :disabled="!data?.mail.configured">Email the account holder</option><option value="link">Generate a secure one-time link</option></select></label>
    <label v-if="delivery === 'link'" class="checkbox-label"><input v-model="confirmed" type="checkbox" required :disabled="busy">I verified the recipient's identity and will deliver this link privately through a secure channel.</label>
    <label>Reason<input v-model="reason" required minlength="5" maxlength="500" :disabled="busy"></label>
    <label>Current administrator password<input v-model="password" required type="password" autocomplete="current-password" maxlength="128" :disabled="busy"></label>
    <p class="data-note">Links expire after 30 minutes. Creating a link does not change the current password or sign the user out. Successful redemption invalidates all old sessions and links. No subscription, tier or collection records change.</p>
    <button class="button primary" :disabled="busy || (delivery === 'link' && !confirmed)">{{ busy ? 'Preparing…' : 'Create recovery request' }}</button>
  </form>
  <section v-if="result" class="panel recovery-panel"><p role="status">{{ result.message }}</p><template v-if="result.url"><p class="alert warning">Anyone with this link can reset this account's password. Do not post it in a ticket, shared chat or screenshot.</p><label>One-time recovery link<input :value="result.url" readonly autocomplete="off" spellcheck="false" @focus="($event.target as HTMLInputElement).select()"></label><p>Expires {{ new Date(result.expires_at).toLocaleString() }}</p><div class="button-row"><button class="button secondary" @click="copy">Copy link</button><button class="button secondary" @click="result = null">Hide link</button></div></template></section>
</template>
<style scoped>.recovery-panel{padding:24px;margin:24px 0;max-width:960px}.recovery-panel label{display:grid;gap:8px;margin:12px 0}.recovery-panel .checkbox-label{display:flex}.recovery-panel input{max-width:100%;min-width:0}</style>
