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
const money = (value: number | null) => value == null ? 'Not priced yet' : new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(value);
const total = computed(() => data.value?.valuation.aud_total == null ? 'Not priced yet' : new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(data.value.valuation.aud_total));
</script>
<template>
  <section class="panel price-summary">
    <div class="section-heading"><div><h2>{{ binderId ? 'Planned binder value' : 'Collection market estimate' }}</h2><p>Converted overseas-market reference · AUD · not condition-adjusted</p></div><button class="button secondary" :disabled="busy" @click="refresh"><AppIcon name="refresh" :size="16" />Refresh</button></div>
    <p v-if="error" class="alert warning">Prices are unavailable: {{ error }}</p>
    <template v-else-if="data">
      <strong class="price-total">{{ total }}</strong>
      <p class="small">{{ data.valuation.priced_quantity }} / {{ data.valuation.quantity }} {{ binderId ? 'planned pockets' : 'owned copies' }} priced</p>
      <div class="button-row"><span class="badge">{{ data.valuation.unpriced_quantity }} no available estimate</span><span class="badge amber">{{ data.valuation.stale_quantity }} stale matched quotes excluded</span><span class="badge">{{ data.valuation.fx_missing_quantity }} awaiting currency rate</span></div>
      <div v-if="data.valuation.approximate_quantity" class="estimate-breakdown alert info"><div><strong>Includes {{ money(data.valuation.approximate_aud_total) }} in Cardmarket approximations</strong><br><span>{{ data.valuation.approximate_quantity }} {{ binderId ? 'planned pockets' : 'owned copies' }} use unconfirmed reference values. Matched TCGplayer portion: {{ money(data.valuation.matched_aud_total) }}.</span></div></div>
      <p v-if="data.valuation.stale_reference_quantity || data.valuation.failed_reference_quantity" class="alert warning">Included Cardmarket estimates: {{ data.valuation.stale_reference_quantity }} copies have stale/unknown source dates; {{ data.valuation.failed_reference_quantity }} have a failed latest refresh. These counts can overlap. Amounts remain visible but may be inaccurate.</p>
      <div v-if="binderId && data.owned_reference" class="panel owned-binder-estimate"><strong>Owned cards represented in this layout: {{ money(data.owned_reference.aud_total) }}</strong><p class="small">{{ data.owned_reference.priced_quantity }} / {{ data.owned_reference.quantity }} represented owned copies priced<template v-if="data.owned_reference.approximate_quantity"> · {{ money(data.owned_reference.approximate_aud_total) }} from Cardmarket approximations</template>. This is not a physical-copy allocation.</p></div>
      <p v-if="data.rates.length" class="muted small">AUD conversion: <span v-for="(rate, i) in data.rates" :key="rate.currency">{{ i ? ' · ' : '' }}{{ rate.currency }} × {{ Number(rate.aud_rate).toFixed(4) }} ({{ String(rate.rate_date).slice(0,10) }})</span></p>
      <p class="data-note">Recent matched TCGplayer prices are preferred. Where unavailable or unusable, Cardmarket card-level/holo-category references contribute explicitly labelled approximations, including last-known values after a failed or stale check. Exact printing, sale language, condition and provider mapping may be wrong. Missing prices and missing or outdated AUD exchange rates are still excluded; no price or conversion rate is invented.</p>
      <p v-if="binderId" class="data-note">This is the cost reference for the planned layout, not proof of cards physically in this binder. Repeated pockets count as repeated planned purchases; collection totals use actual owned quantities.</p>
      <p class="muted small">{{ data.enabled ? 'Tracked cards are checked approximately every ' + data.refresh_hours + ' hours as the worker processes the queue.' : 'Automatic price tracking is disabled.' }} Refreshing cannot make the upstream source newer.</p>
    </template>
    <p v-else class="muted small">Loading market estimates…</p>
  </section>
</template>
<style scoped>
.estimate-breakdown{align-items:flex-start}.estimate-breakdown strong{font-size:13px}.owned-binder-estimate{padding:14px;margin-top:16px;border-color:var(--line);background:var(--surface-soft)}.owned-binder-estimate p{margin:6px 0 0;color:var(--muted)}
</style>
