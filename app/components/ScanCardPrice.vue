<script setup lang="ts">
const props = defineProps<{ price?: any, from?: boolean }>()
const amount = computed(() => {
  if (!props.price) return ''
  const currency = props.price.aud == null ? props.price.currency : 'AUD'
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency }).format(props.price.aud ?? props.price.amount) + ' ' + currency
})
</script>
<template>
  <span class="scan-card-price" data-testid="scan-card-price">
    <template v-if="price"><strong>{{ price.approximate ? 'Approx. ' : '' }}{{ from ? 'From ' : '' }}{{ amount }}</strong><small>{{ price.source }}{{ price.approximate ? ' · Printing not confirmed' : '' }}</small><small v-if="price.stale || price.fetch_error">Last-known price · may be outdated</small></template>
    <span v-else class="muted">Price not available</span>
  </span>
</template>
<style scoped>
.scan-card-price{display:grid;gap:3px;line-height:1.6;overflow-wrap:anywhere}.scan-card-price strong{color:var(--ink);font-size:14px}.scan-card-price small,.scan-card-price>.muted{color:var(--muted);font-size:11px}
</style>
