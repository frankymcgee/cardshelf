<script setup lang="ts">
import { productPresentation, offerTaxLabel } from '../../shared/stripe-products.mjs'
const emit = defineEmits<{ synced: [] }>()
const api = useApi(), environment = ref('sandbox'), data = ref<any>(null), busy = ref(false), error = ref(''), notice = ref('')
const form = reactive({ managed: false, daily: false, mirror_plans: false, password: '', confirm: false })
const path = (suffix = '') => '/api/admin/integrations/stripe/products' + suffix + '?environment=' + environment.value
const date = (value: any) => value ? new Date(value).toLocaleString('en-AU') : 'Not yet'
const money = (n: number) => new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(n / 100)
async function load() {
  try {
    data.value = await api<any>(path())
    Object.assign(form, { managed: data.value.settings.managed, daily: data.value.settings.daily, mirror_plans: data.value.settings.mirror_plans })
  } catch (e) { error.value = errorMessage(e) }
}
async function run(task: () => Promise<void>) {
  if (busy.value) return
  busy.value = true; error.value = ''; notice.value = ''
  try { await task(); emit('synced') } catch (e) { error.value = errorMessage(e) }
  finally { form.password = ''; form.confirm = false; await load(); busy.value = false }
}
async function sync() {
  await run(async () => {
    const result = await api<any>(path('/sync'), { method: 'POST', body: {} })
    notice.value = result.busy ? 'Another sync is running. Refresh shortly.' : `Synced ${result.products} products and ${result.published_offers} prices. No existing subscription was changed.`
  })
}
async function save() {
  await run(async () => {
    await api(path('/settings'), { method: 'POST', body: { ...form, revision: data.value.settings.revision } })
    if (form.managed) {
      const result = await api<any>(path('/sync'), { method: 'POST', body: {} })
      notice.value = result.busy ? 'Settings saved. Another sync is running.' : 'Settings saved and Stripe products synced. Billing activation and existing access are unchanged.'
    } else notice.value = 'Sync stopped. Existing offers, subscriptions and renewals are not cancelled.'
  })
}
watch(environment, () => { data.value = null; error.value = ''; notice.value = ''; form.password = ''; form.confirm = false; load() })
onMounted(load)
</script>
<template>
<section class="panel platform-admin-panel spaced stripe-sync">
  <div class="section-heading"><div><span class="eyebrow">STRIPE PRODUCT CATALOGUE</span><h2>Manage it once. Keep it in sync.</h2><p class="small muted">Products, descriptions, images, unit labels, marketing features and recurring prices come from Stripe. Existing paid subscriptions keep their accepted terms.</p></div>
    <label>Catalogue environment<select v-model="environment" :disabled="busy"><option value="sandbox">Test / Sandbox</option><option value="production">Live / Production</option></select></label>
  </div>
  <p class="small muted">Review the website without enabling payments: <NuxtLink to="/admin/integrations/stripe-preview" class="text-button">Preview Stripe Test pricing</NuxtLink>. This administrator-only preview always uses Test / Sandbox products, even when Live is selected here.</p>
  <p v-if="error" class="alert error" role="alert">{{ error }}</p><p v-if="notice" class="alert info" role="status">{{ notice }}</p>
  <p v-if="!data&&!error" role="status">Loading sync settings…</p>
  <template v-if="data">
    <div class="sync-facts"><div><small>Last successful sync</small><strong>{{ date(data.settings.last_success_at) }}</strong></div><div><small>Next automatic sync</small><strong>{{ data.settings.managed&&data.settings.daily?date(data.settings.next_sync_at):'Manual only / disabled' }}</strong></div><div><small>Published prices</small><strong>{{ data.offers.filter((o:any)=>o.published).length }}</strong></div></div>
    <p v-if="data.settings.last_error" class="alert error">{{ data.settings.last_error }} The last complete catalogue is retained; a failed sync does not publish partial results.</p>
    <p v-for="message in data.settings.summary?.warnings||[]" :key="message" class="small muted">{{ message }}</p>
    <div class="button-row"><button class="button primary" :disabled="busy||!data.settings.managed||!data.configured" @click="sync">{{ busy?'Working…':'Sync now' }}</button><button class="button secondary" :disabled="busy" @click="load">Refresh status</button><NuxtLink to="/admin/integrations/stripe" class="button secondary">Stripe connection & activation</NuxtLink></div>
    <details class="spaced"><summary>One-time sync setup</summary>
      <p class="small muted">Use products named Collector and Collector Plus. For custom names set <code>cardshelf_plan=collector</code> or <code>cardshelf_plan=plus</code> in Stripe metadata. Monthly and annual prices are selected separately; archived prices are ignored. Product renames retain the established tier mapping.</p>
      <p class="small muted">Tax defaults to Stripe Tax. Complete Tax settings and choose your price’s tax behavior. For a fixed rate set <code>cardshelf_tax_mode=fixed</code> and <code>cardshelf_tax_rate=txr_…</code> in the product metadata; to deliberately collect no tax use <code>cardshelf_tax_mode=none</code>. CardShelf never guesses a tax rate. Full setup: <code>docs/STRIPE_PRODUCTS.md</code>.</p>
      <form class="form-stack spaced" @submit.prevent="save">
        <label class="sync-check"><input v-model="form.managed" type="checkbox"><span>Manage new subscription products and prices in Stripe. Successful syncs replace manually published offers for this environment.</span></label>
        <label class="sync-check"><input v-model="form.daily" type="checkbox" :disabled="!form.managed"><span>Automatically sync every 24 hours while Stripe-managed products are enabled.</span></label>
        <label v-if="environment==='production'" class="sync-check"><input v-model="form.mirror_plans" type="checkbox"><span>Keep Pricing & plans details in sync with Live Stripe products (read-only here).</span></label>
        <p v-else class="small muted">Test catalogue changes never overwrite Live platform plans or appear on the public pricing page.</p>
        <label>Administrator password<input v-model="form.password" type="password" autocomplete="current-password" required></label>
        <label class="sync-check"><input v-model="form.confirm" type="checkbox" required><span>I understand that syncing updates new offers and website content, but does not enable billing, change access grants or reprice existing subscriptions.</span></label>
        <button class="button secondary" :disabled="busy||!data.configured">{{form.managed?'Save settings & sync':'Save settings'}}</button>
      </form>
    </details>
    <div class="sync-products spaced"><article v-for="p in data.products" :key="p.plan_code" class="sync-product"><span class="badge">{{p.plan_code}} · {{p.active?'Synced':'Archived / not selected'}}</span><h3>{{p.presentation.name}}</h3><img v-if="productPresentation(p.presentation).images[0]" :src="productPresentation(p.presentation).images[0]" :alt="p.presentation.name" loading="lazy" referrerpolicy="no-referrer"><p class="product-copy">{{p.presentation.description}}</p><p v-if="p.presentation.unit_label" class="small muted">Unit: {{p.presentation.unit_label}}</p><ul><li v-for="(feature,index) in p.presentation.marketing_features" :key="index">{{feature.name}}</li></ul><p v-for="o in data.offers.filter((o:any)=>o.published&&o.plan_code===p.plan_code)" :key="o.id"><strong>{{money(o.total_minor)}} / {{o.cadence==='MONTHLY'?'month':'year'}}</strong><br><small>{{offerTaxLabel(o)}}</small></p></article></div>
  </template>
</section>
</template>
<style scoped>
.stripe-sync{margin-bottom:28px}.stripe-sync .section-heading{gap:24px;align-items:flex-start}.stripe-sync code{overflow-wrap:anywhere}.sync-facts{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;margin:20px 0}.sync-facts small,.sync-facts strong{display:block}.sync-facts small{color:var(--muted);margin-bottom:5px}.sync-check{display:flex;align-items:flex-start;gap:12px}.sync-check input{width:auto;margin-top:4px;flex:none}.sync-products{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}.sync-product{padding:20px;border:1px solid var(--line);border-radius:16px;overflow-wrap:anywhere}.sync-product img{width:72px;height:72px;object-fit:contain;float:right;margin:0 0 12px 12px}.product-copy{white-space:pre-line}.sync-product ul{padding-left:20px}.sync-product li{margin:8px 0}@media(max-width:700px){.sync-facts,.sync-products{grid-template-columns:1fr}.stripe-sync .section-heading{display:block}.stripe-sync .section-heading label{margin-top:18px}}
</style>
