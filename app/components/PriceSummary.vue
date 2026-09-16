<script setup lang="ts">
const props = defineProps<{ binderId?: string; refreshKey?: number }>();
const api = useApi(), auth = useAuth(), notice = useNotice();
const data = ref<any>(null), error = ref(''), busy = ref(false);
let alive = true, sequence = 0;
async function load() {
  const request = ++sequence;
  try { const value = await api('/api/prices/summary', { query: props.binderId ? { binder_id: props.binderId } : {} }); if (alive && request === sequence) { data.value = value; error.value = ''; } }
  catch (e) { if (alive && request === sequence) error.value = errorMessage(e); }
}
watch(() => [props.binderId, props.refreshKey], load, { immediate: true });
onBeforeUnmount(() => { alive = false; sequence++; });
async function refresh() {
  busy.value = true;
  try {
    if (auth.state.value.user?.role === 'admin' && data.value?.enabled) {
      const result = await api('/api/prices/refresh', { method: 'POST', body: {} });
      notice.show(result.already_queued ? 'A price refresh is already queued.' : 'Due tracked cards are queued. Check progress in Data & settings.');
    }
    await load();
  } catch (e) { notice.show(errorMessage(e), 'error'); }
  finally { busy.value = false; }
}
const total = computed(() => data.value?.valuation.aud_total == null ? 'Not priced yet' : new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(data.value.valuation.aud_total));
</script>
<template>
  <section class="panel price-summary">
    <div class="section-heading"><div><h2>{{ binderId ? 'Planned binder value' : 'Collection market estimate' }}</h2><p>Converted overseas-market reference · AUD · not condition-adjusted</p></div><button class="button secondary" :disabled="busy" @click="refresh"><AppIcon name="refresh" :size="16" />Refresh</button></div>
    <p v-if="error" class="alert warning">Prices are unavailable: {{ error }}</p>
    <template v-else-if="data">
      <strong class="price-total">{{ total }}</strong>
      <p class="small">{{ data.valuation.priced_quantity }} / {{ data.valuation.quantity }} {{ binderId ? 'planned pockets' : 'owned copies' }} priced</p>
      <div class="button-row"><span class="badge">{{ data.valuation.unpriced_quantity }} no printing price</span><span class="badge amber">{{ data.valuation.stale_quantity }} stale / failed</span><span class="badge">{{ data.valuation.fx_missing_quantity }} awaiting currency rate</span></div>
      <p v-if="data.rates.length" class="muted small">AUD conversion: <span v-for="(rate, i) in data.rates" :key="rate.currency">{{ i ? ' · ' : '' }}{{ rate.currency }} × {{ Number(rate.aud_rate).toFixed(4) }} ({{ String(rate.rate_date).slice(0,10) }})</span></p>
      <p class="data-note">Only recent, matched TCGplayer printing prices with recent exchange rates are totalled. Missing and stale prices are excluded, so this may be a partial estimate. Provider mappings can be incorrect.</p>
      <p v-if="binderId" class="data-note">This is the cost reference for the planned layout, not proof of cards physically in this binder. Repeated pockets count as repeated planned purchases; collection totals use actual owned quantities.</p>
      <p class="muted small">{{ data.enabled ? 'Tracked cards are checked approximately every ' + data.refresh_hours + ' hours as the worker processes the queue.' : 'Automatic price tracking is disabled.' }} Refreshing cannot make the upstream source newer.</p>
    </template>
    <p v-else class="muted small">Loading market estimates…</p>
  </section>
</template>
