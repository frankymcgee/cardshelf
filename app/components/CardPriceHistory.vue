<script setup lang="ts">
import { cardHistorySeries } from '../../shared/value-history.mjs';
import type { PriceObservation } from '../../shared/value-history.mjs';
const props = defineProps<{ history: PriceObservation[] }>();
const days = ref(30), choice = ref('');
const series = computed(() => cardHistorySeries(props.history));
watch(series, values => { if (!values.some(value => value.id === choice.value)) choice.value = values.find(value => value.label.startsWith('TCGplayer'))?.id || values[0]?.id || ''; }, { immediate: true });
const selected = computed(() => series.value.find(value => value.id === choice.value));
</script>
<template>
  <div class="card-history">
    <label v-if="series.length" class="price-series">Price series<select v-model="choice"><option v-for="item in series" :key="item.id" :value="item.id">{{ item.label }}</option></select></label>
    <p v-if="selected" class="selected-series small muted">{{ selected.label }}</p>
    <ValueHistoryChart v-model:days="days" title="Card price history" :points="selected?.points || []" :currency="selected?.currency || 'USD'" />
    <p class="data-note">Actual provider observations, in the selected source currency. Finishes, metrics and currencies stay separate. Historical AUD rates and past sale prices are not reconstructed. A provider’s 7-day or 30-day average is one observation, not daily sales. References may not match the exact printing or condition.</p>
  </div>
</template>
<style scoped>
.card-history{margin-top:24px;min-width:0}.price-series{display:grid;gap:8px;font-size:12px;color:var(--muted)}.price-series select{width:100%;min-width:0;max-width:100%;text-overflow:ellipsis}.card-history .data-note{line-height:1.6}.selected-series{line-height:1.6;overflow-wrap:anywhere}
</style>
