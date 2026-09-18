<script setup lang="ts">
const props = defineProps<{ cardId: string }>()
const prices = ref<any>(null), error = ref('')
const api = useApi(); let sequence = 0, alive = true
const money = (amount: number | null | undefined, currency = 'AUD') => amount == null ? 'Unavailable' : new Intl.NumberFormat('en-AU', { style: 'currency', currency }).format(amount)
async function load() {
  const request = ++sequence; prices.value = null; error.value = ''
  try { const result = await api('/api/public/catalogue/cards/' + encodeURIComponent(props.cardId) + '/prices'); if (alive && request === sequence) prices.value = result }
  catch (e) { if (alive && request === sequence) error.value = errorMessage(e) }
}
watch(() => props.cardId, load, { immediate: true })
onBeforeUnmount(() => { alive = false; sequence++ })
</script>
<template><section class="public-card-prices"><h2>Source prices · free to view</h2><p v-if="error" class="alert warning">{{ error }}</p><template v-if="prices"><p v-if="prices.last_error" class="alert warning">{{ prices.last_error }}</p><article v-for="printing in prices.printings" :key="printing.id" class="public-price-row"><strong>{{ printing.label }}</strong><template v-if="printing.estimate"><span>{{ printing.estimate.aud == null ? money(printing.estimate.amount, printing.estimate.currency) : money(printing.estimate.aud) + ' AUD' }}</span><small>{{ printing.estimate.source }} · {{ printing.estimate.approximate ? 'Approximate reference' : 'Printing-matched reference' }}<template v-if="printing.estimate.stale"> · Last-known / stale</template></small></template><span v-else class="muted">No usable reference for this printing.</span></article><details v-if="prices.references.length" open><summary>Available reference values</summary><p v-for="(r, i) in prices.references" :key="i" class="small">{{ r.source }} · {{ r.metric }} · {{ r.variant }}: {{ money(r.amount, r.currency) }} {{ r.currency }}<template v-if="r.aud != null"> ≈ {{ money(r.aud) }} AUD</template><span v-if="r.stale"> · Last-known / stale</span></p></details><p class="data-note">Estimates may use unmatched or stale Cardmarket and vendor references. Condition, edition and language are not always confirmed. A missing price is never replaced with zero.</p><p class="data-note">Last successful check: {{ prices.fetched_at ? new Date(prices.fetched_at).toLocaleString() : 'Not checked yet' }}. Prices update through the shared server cache, not a request to the provider for every visitor.</p></template></section></template>
