<script setup lang="ts">
import { offerTaxLabel } from '../../shared/stripe-products.mjs'
import { pricingPlans, pricingCadence, annualSaving } from '../../shared/pricing-table.mjs'
import type { PricingOffer, PricingPlan } from '../../shared/pricing-table.mjs'
const props = defineProps<{ offers: PricingOffer[], mode: 'live' | 'paused' | 'preview' }>()
const cadence = ref('MONTHLY'), brokenImages = reactive<Record<string, boolean>>({})
const displayOffers = computed(() => props.mode === 'paused' ? [] : (Array.isArray(props.offers) ? props.offers : []))
const plans = computed(() => pricingPlans(displayOffers.value, props.mode !== 'preview').map(plan => ({ ...plan, selected: plan.offers.find(o => o.cadence === cadence.value) })))
const hasCadence = (value: string) => displayOffers.value.some(o => o.cadence === value)
watch(displayOffers, offers => { cadence.value = pricingCadence(offers, cadence.value) }, { immediate: true })
const imageKey = (plan: PricingPlan) => plan.product.images[0] || plan.code
const money = (n: number) => new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(n / 100)
</script>
<template>
<div v-if="mode !== 'paused' && displayOffers.length" class="m-container pricing-frequency">
  <div class="billing-cadence" role="group" aria-label="Billing frequency">
    <button type="button" :aria-pressed="cadence === 'MONTHLY'" :disabled="!hasCadence('MONTHLY')" @click="cadence = 'MONTHLY'">Monthly</button>
    <button type="button" :aria-pressed="cadence === 'ANNUAL'" :disabled="!hasCadence('ANNUAL')" @click="cadence = 'ANNUAL'">Yearly</button>
  </div>
</div>
<section class="m-container m-plan-grid stripe-plan-grid">
  <article v-for="plan in plans" :key="plan.code" class="m-plan stripe-plan" :class="plan.code === 'plus' ? 'm-plan-current' : 'm-plan-future'">
    <div class="stripe-plan-heading"><div>
      <span class="m-plan-label">{{ mode === 'preview' ? 'TEST PREVIEW · NOT ON SALE' : mode === 'live' && plan.offers.length ? 'PLATFORM MEMBERSHIP' : 'PLANNED MEMBERSHIP · NOT ON SALE' }}</span>
      <h2>{{ plan.name }}</h2>
    </div><img v-if="plan.product.images[0] && !brokenImages[imageKey(plan)]" :src="plan.product.images[0]" :alt="plan.name" width="72" height="72" loading="lazy" referrerpolicy="no-referrer" @error="brokenImages[imageKey(plan)] = true"></div>
    <p class="stripe-description">{{ plan.description }}</p>
    <template v-if="mode !== 'paused' && plan.selected">
      <div class="stripe-amount"><strong>{{ money(plan.selected.total_minor) }}</strong><span>/ {{ cadence === 'MONTHLY' ? 'month' : 'year' }}<template v-if="plan.product.unit_label"> / {{ plan.product.unit_label }}</template></span></div>
      <p class="stripe-tax-note">{{ offerTaxLabel(plan.selected) }}</p>
      <p v-if="cadence === 'ANNUAL' && annualSaving(plan) > 0" class="stripe-saving">Save {{ money(annualSaving(plan)) }} compared with 12 monthly payments.</p>
    </template>
    <p v-else class="stripe-amount"><strong>{{ mode === 'paused' ? 'Pricing to be announced.' : 'Not offered for this period' }}</strong></p>
    <ul class="stripe-feature-list"><li v-for="(feature, index) in plan.features" :key="index"><AppIcon name="check" :size="18"/><span>{{ feature.name }}</span></li></ul>
    <div class="stripe-plan-footer">
      <p v-if="mode === 'preview'" class="m-fine preview-purchase-note">Preview only. Checkout and subscription changes are unavailable here.</p>
      <template v-else-if="mode === 'live' && plan.selected"><NuxtLink :to="{ path: '/membership', query: { plan: plan.code, cadence } }" class="m-button">Choose {{ plan.name }}<AppIcon name="arrow" :size="18"/></NuxtLink><p class="m-fine">Recurring subscription. Review the full terms before continuing to Stripe.</p></template>
      <template v-else><p v-if="mode === 'paused'" class="m-fine">New subscription checkout is paused. Existing renewals are not cancelled.</p><NuxtLink to="/early-access" class="m-button">Request testing access<AppIcon name="arrow" :size="18"/></NuxtLink></template>
    </div>
  </article>
</section>
</template>
<style scoped>

.stripe-plan-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px}.stripe-plan-grid:has(>.stripe-plan:only-child){grid-template-columns:minmax(0,1fr)}@media(max-width:760px){.stripe-plan-grid{grid-template-columns:minmax(0,1fr)}}
.billing-cadence{display:inline-flex;padding:5px;border:1px solid #ded9ed;background:#f4f1fa;border-radius:999px;margin-top:28px;gap:6px}.billing-cadence button{border:0;background:transparent;border-radius:999px;padding:12px 26px;font:inherit;font-weight:650;cursor:pointer;color:inherit}.billing-cadence button[aria-pressed=true]{background:#fff;box-shadow:0 2px 10px #20134112}.billing-cadence button:disabled{opacity:.4;cursor:not-allowed}.stripe-plan{display:flex;flex-direction:column;min-width:0}.stripe-plan-heading{display:flex;justify-content:space-between;gap:20px;align-items:center}.stripe-plan-heading img{width:72px;height:72px;object-fit:contain;border-radius:16px;flex:none}.stripe-description{white-space:pre-line;overflow-wrap:anywhere;min-height:54px}.stripe-amount{display:flex;align-items:baseline;flex-wrap:wrap;gap:8px;margin-top:24px}.stripe-amount strong{font-size:clamp(28px,3vw,44px);letter-spacing:-.04em}.stripe-amount span{font-size:15px;opacity:.7}.stripe-tax-note,.stripe-saving{font-size:13px;line-height:1.6}.stripe-saving{font-weight:650}.stripe-feature-list{margin:24px 0!important}.stripe-feature-list span{overflow-wrap:anywhere}.stripe-plan-footer{margin-top:auto;padding-top:18px}.stripe-plan-footer .m-button{width:100%;justify-content:center}.stripe-plan-footer .m-fine{margin-top:16px}.stripe-plan-grid:has(>.stripe-plan:only-child){max-width:680px}@media(max-width:620px){.stripe-plan-heading{gap:12px}.stripe-plan-heading img{width:56px;height:56px}.stripe-description{min-height:0}}

.pricing-frequency{margin-top:-28px;margin-bottom:28px}.preview-purchase-note{font-weight:650}
</style>
