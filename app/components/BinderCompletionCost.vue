<script setup lang="ts">
defineProps<{ pricing: any }>();
const money = (amount: number | null) => amount == null ? 'Not priced yet' : new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(amount);
</script>
<template>
  <section class="completion-cost panel" aria-label="Cost to complete binder">
    <div class="completion-cost-heading"><div><h2>Estimated cost to finish</h2><strong>{{ money(pricing.aud_total) }}</strong></div><span v-if="pricing.priced_quantity < pricing.needed_printings" class="badge amber">{{ pricing.priced_quantity ? 'Partial estimate' : 'Prices unavailable' }}</span></div>
    <p>{{ pricing.priced_quantity }} / {{ pricing.needed_printings }} printings to acquire priced · AUD · Excludes postage</p>
    <p v-if="pricing.already_owned_printings" class="small muted">{{ pricing.already_owned_printings }} already-owned {{ pricing.already_owned_printings === 1 ? 'target needs' : 'targets need' }} a checklist update and {{ pricing.already_owned_printings === 1 ? 'is' : 'are' }} excluded.</p>
    <p v-if="pricing.stale_reference_quantity || pricing.failed_reference_quantity" class="alert warning">Includes outdated or failed-refresh guide values.</p>
    <details class="completion-cost-details"><summary>Estimate details</summary><p>One copy per missing printing, including repeated pockets. This follows your planned binder, which may cover part of a set. Prices are references and are not condition-adjusted.</p><p>{{ pricing.approximate_quantity }} guide estimates included · {{ pricing.unpriced_quantity }} without prices · {{ pricing.stale_quantity }} stale matched quotes excluded · {{ pricing.fx_missing_quantity }} awaiting currency rates.</p><p v-if="!pricing.enabled">Automatic pricing is paused. Available cached estimates are shown.</p></details>
  </section>
</template>
<style scoped>
.completion-cost{padding:20px 24px;margin-bottom:20px}.completion-cost-heading{display:flex;align-items:center;justify-content:space-between;gap:14px}.completion-cost h2{font-size:15px;margin:0 0 8px}.completion-cost strong{font-size:28px}.completion-cost>p{font-size:12px;line-height:1.7;color:var(--muted);margin:8px 0}.completion-cost-details{font-size:12px;margin-top:10px;color:var(--muted)}.completion-cost-details summary{cursor:pointer;color:var(--ink)}.completion-cost-details p{line-height:1.7}.completion-cost .alert{color:var(--ink)}@media(max-width:480px){.completion-cost{padding:17px}.completion-cost-heading{align-items:flex-start;flex-wrap:wrap}.completion-cost strong{font-size:25px}}
</style>
