<script setup lang="ts">
import { CURRENT_FEATURES } from '../../shared/platform.mjs'
import { planFeatures } from '../../shared/binder-types.mjs'
import { productGroups, offerTaxLabel } from '../../shared/stripe-products.mjs'
definePageMeta({ layout: 'marketing' })
useMarketingSeo('Collector & Collector Plus', 'Find your collecting plan. Explore current subscription products, features and monthly or annual prices. Existing testing access is protected.', '/pricing')
const { data: billing } = await useFetch<any>('/api/public/subscription-offers', { default: () => ({ enabled: false, offers: [] }) })
const live = computed(() => billing.value?.enabled && billing.value?.environment === 'production')
const cadence = ref('MONTHLY'), brokenImages = reactive<Record<string, boolean>>({})
const defaults = [{ code: 'collector', name: 'Collector', description: 'A card checklist without the paperwork. Generate a set or series binder, then tap to mark each find.' }, { code: 'plus', name: 'Collector Plus', description: 'Everything in Collector, with tools to value, organise and personalise your collection.' }]
const groups = computed(() => productGroups(billing.value?.offers || []))
const plans = computed(() => {
  if (groups.value.some(g => g.product.id)) return groups.value.map(g => ({ ...g, name: g.product.name, description: g.product.description, features: g.product.marketing_features }))
  return defaults.map(p => ({ ...p, product: { id: '', images: [] as string[], unit_label: '' }, features: planFeatures(p.code).map(f => ({ name: f.label })), offers: (billing.value?.offers || []).filter((o: any) => o.plan_code === p.code) }))
})
const hasCadence = (value: string) => (billing.value?.offers || []).some((o: any) => o.cadence === value)
watch(() => billing.value, () => { if (!hasCadence(cadence.value) && hasCadence('ANNUAL')) cadence.value = 'ANNUAL' }, { immediate: true })
const price = (plan: any) => plan.offers.find((o: any) => o.cadence === cadence.value)
const money = (n: number) => new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(n / 100)
function annualSaving(plan: any) {
  const month = plan.offers.find((o: any) => o.cadence === 'MONTHLY'), year = plan.offers.find((o: any) => o.cadence === 'ANNUAL')
  return month && year && month.tax_mode === year.tax_mode && month.tax_behavior === year.tax_behavior && month.tax_inclusive === year.tax_inclusive
    ? Math.max(0, month.total_minor * 12 - year.total_minor) : 0
}
</script>
<template>
<section class="m-container m-page-hero"><span class="m-eyebrow">PLANS & ACCESS</span><h1>Your collection.<br><em>Your level of detail.</em></h1><p class="m-lead">Choose the collecting experience that fits you. Existing invited testers keep their full access, with no payment required.</p>
  <div v-if="live" class="billing-cadence" aria-label="Billing frequency"><button type="button" :aria-pressed="cadence==='MONTHLY'" :disabled="!hasCadence('MONTHLY')" @click="cadence='MONTHLY'">Monthly</button><button type="button" :aria-pressed="cadence==='ANNUAL'" :disabled="!hasCadence('ANNUAL')" @click="cadence='ANNUAL'">Yearly</button></div>
</section>
<section class="m-container m-plan-grid stripe-plan-grid"><article v-for="plan in plans" :key="plan.code" class="m-plan stripe-plan" :class="plan.code==='plus'?'m-plan-current':'m-plan-future'">
  <div class="stripe-plan-heading"><div><span class="m-plan-label">{{ live&&plan.offers.length?'PLATFORM MEMBERSHIP':'PLANNED MEMBERSHIP · NOT ON SALE' }}</span><h2>{{plan.name}}</h2></div><img v-if="plan.product.images[0]&&!brokenImages[plan.code]" :src="plan.product.images[0]" :alt="plan.name" width="72" height="72" loading="lazy" referrerpolicy="no-referrer" @error="brokenImages[plan.code]=true"></div>
  <p class="stripe-description">{{plan.description}}</p>
  <template v-if="live&&price(plan)"><div class="stripe-amount"><strong>{{money(price(plan).total_minor)}}</strong><span>/ {{cadence==='MONTHLY'?'month':'year'}}<template v-if="plan.product.unit_label"> / {{plan.product.unit_label}}</template></span></div><p class="stripe-tax-note">{{offerTaxLabel(price(plan))}}</p><p v-if="cadence==='ANNUAL'&&annualSaving(plan)>0" class="stripe-saving">Save {{money(annualSaving(plan))}} compared with 12 monthly payments.</p></template>
  <p v-else class="stripe-amount"><strong>{{live?'Not offered for this period':'Pricing to be announced.'}}</strong></p>
  <ul class="stripe-feature-list"><li v-for="(feature,index) in plan.features" :key="index"><AppIcon name="check" :size="18"/><span>{{feature.name}}</span></li></ul>
  <div class="stripe-plan-footer"><template v-if="live&&price(plan)"><NuxtLink :to="{path:'/membership',query:{plan:plan.code,cadence}}" class="m-button">Choose {{plan.name}}<AppIcon name="arrow" :size="18"/></NuxtLink><p class="m-fine">Recurring subscription. Review the full terms before continuing to Stripe.</p></template><template v-else><p v-if="!live" class="m-fine">New subscription checkout is paused. Existing renewals are not cancelled.</p><NuxtLink to="/early-access" class="m-button">Request testing access<AppIcon name="arrow" :size="18"/></NuxtLink></template></div>
</article></section>
<section class="m-container m-plan-footnote"><h2>Already testing? Keep everything.</h2><p>Existing invited testers retain all {{CURRENT_FEATURES.length}} current feature groups, including both binder types. Their testing grants have no automatic expiry and stay separate from paid subscriptions. Syncing or publishing an offer does not subscribe, charge or downgrade an existing tester.</p><p>Card-sale payments are arranged directly between collectors. Stripe handles platform subscription payments only.</p><NuxtLink to="/login" class="m-text-link">Back to your collection<AppIcon name="arrow" :size="18"/></NuxtLink></section>
</template>
<style scoped>
.stripe-plan-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px}.stripe-plan-grid:has(>.stripe-plan:only-child){grid-template-columns:minmax(0,1fr)}@media(max-width:760px){.stripe-plan-grid{grid-template-columns:minmax(0,1fr)}}
.billing-cadence{display:inline-flex;padding:5px;border:1px solid #ded9ed;background:#f4f1fa;border-radius:999px;margin-top:28px;gap:6px}.billing-cadence button{border:0;background:transparent;border-radius:999px;padding:12px 26px;font:inherit;font-weight:650;cursor:pointer;color:inherit}.billing-cadence button[aria-pressed=true]{background:#fff;box-shadow:0 2px 10px #20134112}.billing-cadence button:disabled{opacity:.4;cursor:not-allowed}.stripe-plan{display:flex;flex-direction:column;min-width:0}.stripe-plan-heading{display:flex;justify-content:space-between;gap:20px;align-items:center}.stripe-plan-heading img{width:72px;height:72px;object-fit:contain;border-radius:16px;flex:none}.stripe-description{white-space:pre-line;overflow-wrap:anywhere;min-height:54px}.stripe-amount{display:flex;align-items:baseline;flex-wrap:wrap;gap:8px;margin-top:24px}.stripe-amount strong{font-size:clamp(28px,3vw,44px);letter-spacing:-.04em}.stripe-amount span{font-size:15px;opacity:.7}.stripe-tax-note,.stripe-saving{font-size:13px;line-height:1.6}.stripe-saving{font-weight:650}.stripe-feature-list{margin:24px 0!important}.stripe-feature-list span{overflow-wrap:anywhere}.stripe-plan-footer{margin-top:auto;padding-top:18px}.stripe-plan-footer .m-button{width:100%;justify-content:center}.stripe-plan-footer .m-fine{margin-top:16px}.stripe-plan-grid:has(>.stripe-plan:only-child){max-width:680px}@media(max-width:620px){.stripe-plan-heading{gap:12px}.stripe-plan-heading img{width:56px;height:56px}.stripe-description{min-height:0}}
</style>
