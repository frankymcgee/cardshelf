<script setup lang="ts">
const props = defineProps<{ references: any[]; printings?: any[] }>()
const rows = computed<any[]>(() => (props.references || []).filter((r: any) => ['ygoprodeck', 'mtgjson'].includes(r.provider)))
const money = (amount: number | null | undefined, currency = 'AUD') => amount == null ? 'Unavailable' : new Intl.NumberFormat('en-AU', { style: 'currency', currency }).format(amount)
function label(r: any) { return (props.printings || []).find((p: any) => p.key === r.variant)?.label || (r.variant === 'all-printings' ? 'Across multiple printings' : r.variant) }
</script>
<template><section v-if="rows.length" class="source-reference-prices"><h4>Additional source references</h4><article v-for="(r, i) in rows" :key="r.source + ':' + r.variant + ':' + i"><strong>{{ r.source }} · {{ label(r) }}</strong><span>{{ money(r.amount, r.currency) }} {{ r.currency }}<template v-if="r.aud != null"> ≈ {{ money(r.aud) }} AUD</template></span><small>{{ r.metric === 'setPrice' ? 'Set / rarity guide' : r.metric === 'retail' ? 'Retail reference' : 'Lowest across multiple versions' }} · Approximate</small><p class="data-note">{{ r.estimate_note }}</p><small>Source updated: {{ r.source_updated_at ? new Date(r.source_updated_at).toLocaleDateString() : 'Not supplied' }}<template v-if="r.stale"> · Last-known / stale</template></small></article></section></template>
