<script setup lang="ts">
import { SCAN_TIERS, scanAllowanceLabel } from '../../../shared/scan-allowances.mjs'
import { scanMoney, SCAN_DEFAULTS, SCAN_CONFIG_KEYS, SCAN_PROMPT, SCAN_REASONING_EFFORTS, SCAN_REASONING_MODES } from '../../../shared/card-scanning.mjs'
const api = useApi()
const overview = ref<any>(null), error = ref(''), message = ref(''), busy = ref(false)
const form = reactive({ ...SCAN_DEFAULTS, reasoning_effort: null as string | null, reasoning_mode: null as string | null,
  revision: 1, enabled: false, api_key: '', clear_api_key: false, password: '', monthly_budget_usd: 0, tier_monthly_limits: { free: 100, collector: 100, plus: 100, complimentary: 100 } as Record<string, number>, input_usd_per_million: 0.4, output_usd_per_million: 1.6 })
const reservation = computed(() => Math.ceil(Number(form.input_token_ceiling) * Number(form.input_usd_per_million) + Number(form.max_output_tokens) * Number(form.output_usd_per_million)))
let alive = true
function accept(settings: any) {
  Object.assign(form, { revision: settings.revision, enabled: settings.enabled, api_key: '', clear_api_key: false, password: '', monthly_budget_usd: settings.monthly_budget_micros / 1e6,
    tier_monthly_limits: { ...settings.tier_monthly_limits }, input_usd_per_million: settings.input_price_micros / 1e6, output_usd_per_million: settings.output_price_micros / 1e6,
    ...Object.fromEntries(SCAN_CONFIG_KEYS.map(key => [key, settings[key]])) })
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
            <h3>Recognition settings</h3>
            <label>Model name<input v-model.trim="form.model" type="text" maxlength="200" placeholder="gpt-4.1-mini-2025-04-14" spellcheck="false" required /></label>
            <p class="data-note">Enter an OpenAI model ID with image input and structured output support. A dated snapshot keeps the model version stable; an alias can change over time.</p>
            <div class="scan-settings-grid">
              <label>Reasoning effort<select v-model="form.reasoning_effort"><option :value="null">Model default · omit setting</option><option v-for="effort in SCAN_REASONING_EFFORTS" :key="effort" :value="effort">{{ effort }}</option></select></label>
              <label>Reasoning mode<select v-model="form.reasoning_mode"><option :value="null">Model default · omit setting</option><option v-for="mode in SCAN_REASONING_MODES" :key="mode" :value="mode">{{ mode }}</option></select></label>
              <label>Maximum output tokens<input v-model.number="form.max_output_tokens" type="number" min="256" max="32768" step="1" required /></label>
              <label>Image detail<select v-model="form.image_detail"><option value="high">High</option><option value="low">Low</option><option value="auto">Automatic</option></select></label>
            </div>
            <p class="data-note">Supported reasoning options depend on the model. Leave both at “Model default” for GPT-4.1 mini. Output tokens include reasoning and the final answer; reasoning models may need a larger allowance. Pro mode can use more tokens and take longer.</p>
            <label class="scan-prompt-label">Recognition prompt<textarea v-model="form.prompt" rows="9" maxlength="8000" required spellcheck="false"></textarea></label>
            <div class="scan-prompt-tools"><span class="data-note">{{ form.prompt.length }} / 8000 characters</span><button type="button" class="text-button" @click="form.prompt = SCAN_PROMPT">Restore default prompt</button></div>
            <p class="data-note">Describe how to read the card’s visible name, number, set and language. CardShelf also instructs the model to ignore directions inside the image and return identification fields. Members confirm the printing before adding it. Restoring the prompt takes effect when you save.</p>
            <details><summary>Request limits</summary>
              <div class="scan-settings-grid"><label>Request timeout (seconds)<input v-model.number="form.request_timeout_seconds" type="number" min="15" max="180" step="1" required /></label><label>Input token reservation<input v-model.number="form.input_token_ceiling" type="number" min="16384" max="131072" step="1" required /></label></div>
              <p class="data-note">Allow more time for slower reasoning models. The input reservation covers the photo, prompt and response format; it is an accounting estimate, not an API input limit. Scanning pauses if reported usage exceeds the saved token bounds.</p>
            </details>
            <h3>Budget and model pricing</h3>
            <div class="scan-settings-grid">
              <label>Shared monthly budget (USD)<input v-model.number="form.monthly_budget_usd" type="number" min="0" max="1000" step="0.01" required /></label>

            </div>
            <h3 id="tier-limits">Monthly scans by membership tier</h3>
            <p class="data-note">Set <strong>0 for unlimited</strong> scans per member. These limits do not add scanning access to a tier; collection access and the selected Pokémon game are still required. The shared USD budget always applies.</p>
            <div class="scan-settings-grid"><label v-for="tier in SCAN_TIERS" :key="tier.code">{{ tier.name }} monthly scans<input v-model.number="form.tier_monthly_limits[tier.code]" type="number" min="0" max="10000" step="1" required /><strong class="data-note">{{ scanAllowanceLabel(form.tier_monthly_limits[tier.code]) }}</strong><small class="data-note">{{ tier.note }}</small></label></div>
            <p class="data-note">Saved allowances appear for every tier on pricing and the Test preview, and on paid membership choices. No Stripe sync is needed. These amounts do not grant collection access.</p>
            <p class="data-note">Allowances reset at the start of each UTC calendar month. All analysis attempts count towards the member allowance; adding or undoing a card does not call OpenAI again.</p>
            <p class="data-note">Enter the current USD token rates for your selected model. Prices do not update automatically when you change the model. The OpenAI invoice is authoritative; cached-input discounts are conservatively ignored.</p>
            <div class="scan-settings-grid"><label>USD per million input tokens<input v-model.number="form.input_usd_per_million" type="number" min="0.000001" max="1000" step="0.000001" required /></label><label>USD per million output tokens<input v-model.number="form.output_usd_per_million" type="number" min="0.000001" max="1000" step="0.000001" required /></label></div>
            <p class="alert info" data-testid="scan-reservation">With these settings, each scan reserves {{ scanMoney(reservation) }} before contacting OpenAI. Reported usage releases the unused amount. Interrupted requests retain their reservation. Requests stop when the remaining budget cannot cover another reservation. Changes apply to new scans after saving.</p>
            <label>Confirm your administrator password<input v-model="form.password" type="password" autocomplete="current-password" required /></label>
            <button class="button primary" :disabled="busy">{{ busy ? 'Saving…' : 'Save scanning settings' }}</button>
          </fieldset>
        </form>
      </section>
      <section class="panel scan-admin-panel"><h2>Usage by model this month</h2><p v-if="!overview.models?.length" class="muted">Model usage will appear after your first scan.</p><div v-else class="table-scroll"><table><thead><tr><th>Requested / returned model</th><th>Reasoning</th><th>Scans / failed</th><th>Accounted USD</th><th>Average response</th></tr></thead><tbody><tr v-for="(m, index) in overview.models" :key="index"><td>{{ m.model }}<small class="scan-member-email">{{ m.resolved_model || 'No model reported' }}</small></td><td>{{ m.reasoning_effort || 'Default' }} · {{ m.reasoning_mode || 'Default mode' }}</td><td>{{ m.scans }} / {{ m.failed }}</td><td>{{ scanMoney(m.accounted_micros) }}</td><td>{{ m.average_duration_ms === null ? '—' : (m.average_duration_ms / 1000).toFixed(1) + ' s' }}</td></tr></tbody></table></div></section>
      <section class="panel scan-admin-panel"><h2>Usage by member</h2><p v-if="!overview.users.length" class="muted">Scan usage will appear here.</p><div v-else class="table-scroll"><table><thead><tr><th>Member</th><th>Scans</th><th>Accounted USD</th></tr></thead><tbody><tr v-for="u in overview.users" :key="u.user_id || 'deleted'"><td>{{ u.name || 'Deleted account' }}<small class="scan-member-email">{{ u.email }}</small></td><td>{{ u.scans }}</td><td>{{ scanMoney(u.accounted_micros) }}</td></tr></tbody></table></div></section>
      <section class="panel scan-admin-panel"><h2>Cost history</h2><p class="muted">Use scan volume, measured API cost and response time to compare a future local GPU service. Confirmation counts describe user choices, not measured recognition accuracy.</p><div v-if="overview.history.length" class="table-scroll"><table><thead><tr><th>Month</th><th>Scans</th><th>Measured USD</th><th>Accounted USD</th><th>Average response</th></tr></thead><tbody><tr v-for="m in overview.history" :key="m.month"><td>{{ m.month }}</td><td>{{ m.scans }}</td><td>{{ scanMoney(m.measured_micros) }}</td><td>{{ scanMoney(m.accounted_micros) }}</td><td>{{ m.average_duration_ms === null ? '—' : (m.average_duration_ms / 1000).toFixed(1) + ' s' }}</td></tr></tbody></table></div></section>
      <p class="data-note">CardShelf does not save scan photos or send your collection to OpenAI. Requests use store=false; OpenAI’s standard abuse-monitoring retention can still apply. Recognition is limited to English/Japanese Pokémon cards already imported into the catalogue.</p>
    </template>
  </div>
</template>
<style scoped>
.scan-fieldset h3{margin:12px 0 0}.scan-fieldset>label.scan-prompt-label{max-width:none}.scan-prompt-label textarea{width:100%;min-height:210px;resize:vertical;line-height:1.6}.scan-prompt-tools{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}.scan-admin select{max-width:100%}
.scan-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;margin-bottom:24px}.scan-stats section{padding:22px}.scan-stats span,.scan-stats small{display:block;color:var(--muted);font-size:12px}.scan-stats strong{display:block;font-size:25px;margin:10px 0}.scan-admin-panel{padding:26px;margin-bottom:24px}.scan-admin-panel h2{margin-top:0}.scan-admin-panel p{line-height:1.7}.scan-fieldset{border:0;padding:0;margin:0;min-width:0}.scan-fieldset>label:not(.checkbox-label){max-width:600px}.scan-settings-grid{display:grid;grid-template-columns:1fr 1fr;gap:20px}.scan-member-email{display:block;color:var(--muted);margin-top:5px}.scan-admin table{width:100%;text-align:left;border-collapse:collapse}.scan-admin th,.scan-admin td{padding:14px 12px;border-bottom:1px solid var(--line);white-space:nowrap}.scan-admin input{max-width:100%}.scan-admin summary{cursor:pointer}.scan-admin details .scan-settings-grid{margin-top:15px}@media(max-width:700px){.scan-stats,.scan-settings-grid{grid-template-columns:1fr}.scan-admin-panel{padding:18px}.scan-stats{gap:10px}.scan-admin .page-heading{display:block}.scan-admin .page-heading>.button{margin-top:16px}}
</style>
