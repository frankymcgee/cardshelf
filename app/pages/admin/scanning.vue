<script setup lang="ts">
import { scanMoney } from '../../../shared/card-scanning.mjs'
const api = useApi()
const overview = ref<any>(null), error = ref(''), message = ref(''), busy = ref(false)
const form = reactive({ revision: 1, enabled: false, api_key: '', clear_api_key: false, password: '', monthly_budget_usd: 0, user_monthly_limit: 100, input_usd_per_million: 0.4, output_usd_per_million: 1.6 })
let alive = true
function accept(settings: any) {
  Object.assign(form, { revision: settings.revision, enabled: settings.enabled, api_key: '', clear_api_key: false, password: '', monthly_budget_usd: settings.monthly_budget_micros / 1e6,
    user_monthly_limit: settings.user_monthly_limit, input_usd_per_million: settings.input_price_micros / 1e6, output_usd_per_million: settings.output_price_micros / 1e6 })
}
async function load() {
  error.value = ''
  try { const data = await api('/api/admin/scanning'); if (alive) { overview.value = data; accept(data.settings) } }
  catch (e) { if (alive) error.value = errorMessage(e) }
}
async function save() {
  if (busy.value) return
  busy.value = true; error.value = ''; message.value = ''
  try {
    await api('/api/admin/scanning', { method: 'POST', body: { ...form } })
    if (alive) { message.value = 'Scanning settings saved.'; await load() }
  } catch (e) { if (alive) error.value = errorMessage(e) }
  finally { form.password = ''; form.api_key = ''; busy.value = false }
}
onMounted(load)
onBeforeUnmount(() => { alive = false; form.password = ''; form.api_key = '' })
</script>
<template>
  <div class="scan-admin">
    <header class="page-heading"><div><span class="eyebrow">PLATFORM ADMINISTRATION</span><h1>Card scanning</h1><p>Control photo recognition and see what each month costs.</p></div><NuxtLink to="/scan" class="button secondary">Open scanner</NuxtLink></header>
    <p v-if="error" class="alert error" role="alert">{{ error }} <button class="text-button" :disabled="busy" @click="load">Reload settings</button></p>
    <p v-if="message" class="alert success" role="status">{{ message }}</p>
    <div v-if="!overview && !error" class="loading-panel">Loading scanning settings…</div>
    <template v-if="overview">
      <div class="scan-stats">
        <section class="panel"><span>THIS MONTH · UTC</span><strong>{{ overview.totals.scans }} scans</strong><small>{{ overview.totals.confirmed }} confirmed additions</small></section>
        <section class="panel"><span>ACCOUNTED USAGE</span><strong>{{ scanMoney(overview.totals.accounted_micros) }}</strong><small>of {{ scanMoney(overview.settings.monthly_budget_micros) }} USD</small></section>
        <section class="panel"><span>MEASURED API COST</span><strong>{{ scanMoney(overview.totals.measured_micros) }}</strong><small>{{ overview.totals.uncertain }} pending or uncertain reservations</small></section>
      </div>
      <section class="panel scan-admin-panel">
        <h2>OpenAI connection</h2><p class="muted">Photos are sent to OpenAI for recognition. API billing is separate from ChatGPT subscriptions. CardShelf keeps the catalogue matching and collection records.</p>
        <form class="form-stack" @submit.prevent="save">
          <fieldset :disabled="busy" class="scan-fieldset form-stack">
            <label class="checkbox-label"><input v-model="form.enabled" type="checkbox" />Enable photo scanning for members with collection access</label>
            <p v-if="!overview.settings.key_available" class="alert info">The server integration encryption key must be configured before storing an API key.</p>
            <label>OpenAI API key<input v-model="form.api_key" type="password" autocomplete="new-password" maxlength="512" :placeholder="overview.settings.api_key_set ? 'Saved securely · leave blank to keep' : 'sk-…'" /></label>
            <label class="checkbox-label"><input v-model="form.clear_api_key" type="checkbox" />Remove the saved key and disable scanning</label>
            <p class="data-note">Model: {{ overview.settings.model_label }} · {{ overview.settings.model }}. A snapshot keeps recognition behaviour and usage accounting consistent.</p>
            <div class="scan-settings-grid">
              <label>Shared monthly budget (USD)<input v-model.number="form.monthly_budget_usd" type="number" min="0" max="1000" step="0.01" required /></label>
              <label>Scans per member per month<input v-model.number="form.user_monthly_limit" type="number" min="1" max="10000" step="1" required /></label>
            </div>
            <p class="data-note">Allowances reset at the start of each UTC calendar month. All analysis attempts count towards the member allowance; adding or undoing a card does not call OpenAI again.</p>
            <details><summary>Accounting rates</summary><p class="data-note">Rates last checked {{ overview.settings.price_checked }}. Raise these if your provider rates increase. The OpenAI invoice is authoritative; cached-input discounts are conservatively ignored.</p>
              <div class="scan-settings-grid"><label>USD per million input tokens<input v-model.number="form.input_usd_per_million" type="number" min="0.4" max="1000" step="0.01" required /></label><label>USD per million output tokens<input v-model.number="form.output_usd_per_million" type="number" min="1.6" max="1000" step="0.01" required /></label></div>
            </details>
            <p class="alert info">Each scan reserves up to {{ scanMoney(overview.settings.reservation_micros) }} at the saved rates before contacting OpenAI. Successful usage reports release the unused amount. Interrupted requests retain their reservation. Requests stop when the remaining budget cannot cover another reservation.</p>
            <label>Confirm your administrator password<input v-model="form.password" type="password" autocomplete="current-password" required /></label>
            <button class="button primary" :disabled="busy">{{ busy ? 'Saving…' : 'Save scanning settings' }}</button>
          </fieldset>
        </form>
      </section>
      <section class="panel scan-admin-panel"><h2>Usage by member</h2><p v-if="!overview.users.length" class="muted">Scan usage will appear here.</p><div v-else class="table-scroll"><table><thead><tr><th>Member</th><th>Scans</th><th>Accounted USD</th></tr></thead><tbody><tr v-for="u in overview.users" :key="u.user_id || 'deleted'"><td>{{ u.name || 'Deleted account' }}<small class="scan-member-email">{{ u.email }}</small></td><td>{{ u.scans }}</td><td>{{ scanMoney(u.accounted_micros) }}</td></tr></tbody></table></div></section>
      <section class="panel scan-admin-panel"><h2>Cost history</h2><p class="muted">Use scan volume, measured API cost and response time to compare a future local GPU service. Confirmation counts describe user choices, not measured recognition accuracy.</p><div v-if="overview.history.length" class="table-scroll"><table><thead><tr><th>Month</th><th>Scans</th><th>Measured USD</th><th>Accounted USD</th><th>Average response</th></tr></thead><tbody><tr v-for="m in overview.history" :key="m.month"><td>{{ m.month }}</td><td>{{ m.scans }}</td><td>{{ scanMoney(m.measured_micros) }}</td><td>{{ scanMoney(m.accounted_micros) }}</td><td>{{ m.average_duration_ms === null ? '—' : (m.average_duration_ms / 1000).toFixed(1) + ' s' }}</td></tr></tbody></table></div></section>
      <p class="data-note">CardShelf does not save scan photos or send your collection to OpenAI. Requests use store=false; OpenAI’s standard abuse-monitoring retention can still apply. Recognition is limited to English/Japanese Pokémon cards already imported into the catalogue.</p>
    </template>
  </div>
</template>
<style scoped>
.scan-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;margin-bottom:24px}.scan-stats section{padding:22px}.scan-stats span,.scan-stats small{display:block;color:var(--muted);font-size:12px}.scan-stats strong{display:block;font-size:25px;margin:10px 0}.scan-admin-panel{padding:26px;margin-bottom:24px}.scan-admin-panel h2{margin-top:0}.scan-admin-panel p{line-height:1.7}.scan-fieldset{border:0;padding:0;margin:0;min-width:0}.scan-fieldset>label:not(.checkbox-label){max-width:600px}.scan-settings-grid{display:grid;grid-template-columns:1fr 1fr;gap:20px}.scan-member-email{display:block;color:var(--muted);margin-top:5px}.scan-admin table{width:100%;text-align:left;border-collapse:collapse}.scan-admin th,.scan-admin td{padding:14px 12px;border-bottom:1px solid var(--line);white-space:nowrap}.scan-admin input{max-width:100%}.scan-admin summary{cursor:pointer}.scan-admin details .scan-settings-grid{margin-top:15px}@media(max-width:700px){.scan-stats,.scan-settings-grid{grid-template-columns:1fr}.scan-admin-panel{padding:18px}.scan-stats{gap:10px}.scan-admin .page-heading{display:block}.scan-admin .page-heading>.button{margin-top:16px}}
</style>
