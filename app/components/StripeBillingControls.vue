<script setup lang="ts">
const emit = defineEmits<{saved: []}>()
const api = useApi()
const state = ref<any>(null), busy = ref(false), error = ref(''), notice = ref('')
const form = reactive({environment: 'sandbox', enabled: false, enforce: false,
  password: '', reason: '', confirm_recurring: false, confirm_access: false,
  confirm_mode_change: false, live_confirmation: ''})
const liveConfirmation = computed(() => form.environment === 'production' && (form.enabled || form.enforce))
const modeChanged = computed(() => Boolean(state.value && form.environment !== state.value.policy.environment))
const accessChanged = computed(() => Boolean(state.value && form.enforce !== state.value.policy.enforce))
const target = computed(() => state.value?.environments.find((e: any) => e.environment === form.environment))
const label = (environment: string) => environment === 'production' ? 'Live' : 'Test / Sandbox'
const date = (value: string | null) => value ? new Date(value).toLocaleString('en-AU') : 'Not yet received'
async function load() {
  error.value = ''
  try {
    state.value = await api('/api/admin/integrations/stripe/controls')
    const p = state.value.policy
    Object.assign(form, {environment:p.environment, enabled:p.requested_enabled, enforce:p.enforce,
      password:'',reason:'',confirm_recurring:false,confirm_access:false,confirm_mode_change:false,live_confirmation:''})
  } catch (e) { error.value = errorMessage(e) }
}
async function save() {
  if (busy.value || !state.value) return
  busy.value = true; error.value = ''; notice.value = ''
  try {
    await api('/api/admin/integrations/stripe/controls', {method:'POST',
      body:{...form,revision:state.value.policy.revision}})
    notice.value = 'Subscription settings saved. Existing subscriptions, checkout links, tester access and complimentary grants were not changed.'
    await load(); emit('saved')
  } catch (e) { error.value = errorMessage(e) }
  finally { form.password = ''; busy.value = false }
}
onMounted(load)
</script>
<template>
<section class="billing-controls panel settings-panel" aria-labelledby="subscription-controls-heading">
  <header class="section-heading">
    <div><span class="eyebrow">SUBSCRIPTION CONTROLS</span><h2 id="subscription-controls-heading">Ready when you are.</h2></div>
    <span v-if="state" class="badge" :class="{'live-badge':state.policy.environment==='production'}">
      {{label(state.policy.environment)}} · {{state.policy.enabled?'Checkout enabled':'New checkout paused'}}
    </span>
    <button type="button" class="button secondary" :disabled="busy" @click="load">Refresh checks</button>
  </header>
  <p>Activate Stripe subscriptions here without changing server configuration. Pricing, access restrictions and existing recurring payments remain separate.</p>
  <p v-if="error" class="alert error" role="alert">{{error}}</p>
  <p v-if="notice" class="alert info" role="status">{{notice}}</p>
  <p v-if="!state&&!error" role="status">Loading subscription settings…</p>
  <template v-if="state">
    <p v-if="state.policy.emergency_stop" class="alert error">The server emergency checkout stop is active. New subscriptions cannot be enabled here until it is cleared on the server. Existing renewals are not cancelled.</p>
    <div class="control-summary">
      <div><small>Access policy</small><strong>{{state.policy.enforce?'Paid tiers enforced':'Testing access preserved'}}</strong></div>
      <div><small>Protected accounts</small><strong>{{state.impact.protected}} testers / complimentary / administrators</strong></div>
      <div><small>Payment reconciliation</small><strong>{{date(state.worker_seen_at)}}</strong></div>
    </div>
    <p v-if="state.legacy_open_records" class="alert info">{{state.legacy_open_records}} historical billing records still need external review. Retiring the former gateway does not cancel subscriptions in that provider. Historical records remain read-only, and a second subscription stays blocked for those accounts.</p>
    <form class="membership-form" @submit.prevent="save">
      <fieldset :disabled="busy">
        <legend>1. Choose the active environment</legend>
        <div class="mode-choices">
          <label :class="{chosen:form.environment==='sandbox'}"><input v-model="form.environment" type="radio" value="sandbox"><span><strong>Test / Sandbox</strong><small>Use test cards. No real charges or payable referral rewards.</small></span></label>
          <label :class="{chosen:form.environment==='production'}"><input v-model="form.environment" type="radio" value="production"><span><strong>Live</strong><small>Real subscriptions, payments and recurring renewals.</small></span></label>
        </div>
        <p v-if="modeChanged" class="alert info">This changes which environment members see. It does not move or cancel existing subscriptions; reconciliation continues in both environments.</p>
      </fieldset>
      <div class="readiness" v-if="target">
        <strong>{{label(form.environment)}} readiness</strong>
        <span>{{target.configured?'Credentials saved':'Credentials required'}} · {{target.portal_configured?'Portal configured':'Portal required'}} · {{target.published_offers}} published offers</span>
        <span>Signed webhook: {{date(target.webhook_seen_at)}}{{form.environment==='production'&&!target.webhook_recent?' — required within the last 7 days':''}}</span>
      </div>
      <fieldset :disabled="busy">
        <legend>2. Choose what to enable</legend>
        <label class="membership-check"><input v-model="form.enabled" type="checkbox"><span><strong>Enable new subscriptions</strong><small>Show published offers and allow new Stripe Checkout sessions in the selected environment. Saving rechecks the connection, customer portal and published prices.</small></span></label>
        <label class="membership-check"><input v-model="form.enforce" type="checkbox"><span><strong>Enforce Collector / Collector Plus access</strong><small>Live mode only. Subscription-ready accounts need a paid or administrator-assigned tier for protected features. Existing testers, administrators and Complimentary accounts keep full access.</small></span></label>
        <p v-if="form.enforce" class="alert info">{{state.impact.without_live_access}} accounts currently have no verified Live paid period or active manual grant. Their feature access will be restricted under enforcement; their records will not be deleted.</p>
        <p class="small muted">Pausing new subscriptions does not cancel existing renewals or already-issued checkout links. Stripe continues handling those. Use the individual subscription cancellation controls to stop a renewal.</p>
      </fieldset>
      <fieldset :disabled="busy">
        <legend>3. Confirm the change</legend>
        <label v-if="form.enabled" class="membership-check"><input v-model="form.confirm_recurring" type="checkbox" required><span>I understand subscriptions renew automatically, and pausing new sign-ups does not cancel existing billing or checkout links.</span></label>
        <label v-if="modeChanged" class="membership-check"><input v-model="form.confirm_mode_change" type="checkbox" required><span>I confirm this environment change and understand existing subscriptions are not migrated.</span></label>
        <label v-if="accessChanged" class="membership-check"><input v-model="form.confirm_access" type="checkbox" required><span>I reviewed the access-policy change. Protected testers and complimentary accounts must retain access.</span></label>
        <label v-if="liveConfirmation" class="live-confirmation">Type ENABLE LIVE SUBSCRIPTIONS<input v-model="form.live_confirmation" required autocomplete="off" spellcheck="false" placeholder="ENABLE LIVE SUBSCRIPTIONS"></label>
        <label>Reason<input v-model="form.reason" required minlength="5" maxlength="500" placeholder="For example: enable sandbox subscription testing"></label>
        <label>Current administrator password<input v-model="form.password" type="password" required maxlength="128" autocomplete="current-password"></label>
        <button class="button primary" :disabled="busy">{{busy?'Verifying and saving…':'Save subscription controls'}}</button>
      </fieldset>
    </form>
  </template>
</section>
</template>
<style scoped>
.billing-controls{margin-bottom:24px}.billing-controls h2{margin:4px 0 0}.billing-controls fieldset{border:0;padding:0;margin:20px 0;min-width:0}.billing-controls legend{font-weight:700;margin-bottom:12px}.control-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;margin:18px 0}.control-summary small,.control-summary strong,.mode-choices small,.membership-check small{display:block}.control-summary small,.mode-choices small,.membership-check small{font-size:12px;line-height:1.6;opacity:.75}.control-summary strong{font-size:14px;margin-top:5px}.mode-choices{display:grid;grid-template-columns:1fr 1fr;gap:12px}.mode-choices label{display:flex;align-items:flex-start;gap:10px;border:1px solid #d9dfe8;border-radius:12px;padding:14px;cursor:pointer}.mode-choices label.chosen{border-color:#5546d8;background:#f4f2ff}.mode-choices input,.membership-check input{flex:0 0 auto;width:auto;margin-top:5px}.readiness{display:grid;gap:5px;background:#f5f7fa;border-radius:10px;padding:14px;font-size:13px}.live-badge{background:#fff0e6;color:#963700}.live-confirmation{padding:14px;border:1px solid #d8995b;border-radius:10px;background:#fff8ed}.billing-controls .membership-form{max-width:none}.billing-controls .membership-check{margin:10px 0}.billing-controls input{max-width:100%;box-sizing:border-box}@media(max-width:720px){.control-summary,.mode-choices{grid-template-columns:1fr}.billing-controls .section-heading{align-items:flex-start;flex-direction:column;gap:12px}.billing-controls .button{width:100%}}
</style>
