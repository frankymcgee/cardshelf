<script setup lang="ts">
const props = defineProps<{ history: any; binder?: boolean }>();
const days = ref(30);
const points = computed(() => props.history.points.map((point: any) => {
  const value = point.valuation;
  return { date: point.snapshot_date, value: value.aud_total,
    detail: `${value.priced_quantity} / ${value.quantity} ${props.binder ? 'planned pockets' : 'owned copies'} priced · ${value.approximate_quantity} approximate · ${value.unpriced_quantity + value.stale_quantity + value.fx_missing_quantity} excluded · ${value.stale_reference_quantity} stale references · ${value.failed_reference_quantity} failed references` };
}));
const change = computed(() => props.history.changes?.[days.value]);
const money = (amount: number) => new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', signDisplay: 'exceptZero' }).format(amount);
</script>
<template>
  <div class="collection-history">
    <ValueHistoryChart v-model:days="days" :title="binder ? 'Planned binder value history' : 'Collection value history'" :points="points" :today="history.today" />
    <template v-if="change?.total_aud != null">
      <p class="history-change"><strong>{{ money(change.total_aud) }}</strong><span v-if="change.percent != null"> ({{ change.percent > 0 ? '+' : '' }}{{ change.percent }}%)</span> in recorded value<br><small>{{ change.from }} to {{ change.to }} · AUD</small></p>
      <dl class="history-breakdown"><div><dt>Prices & currency rates</dt><dd>{{ money(change.price_fx_aud) }}</dd></div><div><dt>{{ binder ? 'Pockets added / removed' : 'Cards added / removed' }}</dt><dd>{{ money(change.quantity_aud) }}</dd><small>+{{ change.added_quantity }} / −{{ change.removed_quantity }} copies</small></div><div><dt>Coverage & source changes</dt><dd>{{ money(change.coverage_aud) }}</dd></div></dl>
    </template>
    <p v-else class="small muted">Value changes need two priced daily observations.</p>
    <p v-if="!history.enabled" class="alert info">History recording is paused while automatic pricing is disabled. Previously recorded observations remain available.</p>
    <details class="history-method"><summary>How this history works</summary><p>History starts when observations are recorded. Today can update when viewed and as the worker runs; earlier UTC days are preserved. Missing days and unpriced values stay as gaps. The server retains up to 366 days of observations.</p><p>Each total uses quantities and AUD rates recorded on that day. Changes are estimates, not investment returns: prices and currency movements apply to retained copies with the same price basis; added or removed copies are shown separately. Missing prices and provider or metric switches affect coverage. Approximate or stale references may still be included, as itemised above.</p><p v-if="binder">This graph tracks planned pockets, including repeats. It does not establish which physical copies are in the binder and is not added to your owned collection value.</p></details>
  </div>
</template>
<style scoped>
.history-change{font-size:14px;line-height:1.7}.history-change>strong{font-size:22px}.history-change small{color:var(--muted)}.history-breakdown{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:16px 0}.history-breakdown>div{border:1px solid var(--line);border-radius:10px;padding:14px;background:var(--surface-soft)}.history-breakdown dt{font-size:12px;color:var(--muted);line-height:1.5}.history-breakdown dd{font-weight:700;font-size:18px;margin:9px 0 4px;overflow-wrap:anywhere}.history-breakdown small{font-size:11px;color:var(--muted)}.history-method{font-size:12px;line-height:1.7;color:var(--muted);margin:16px 0}.history-method summary{cursor:pointer;color:var(--ink)}@media(max-width:600px){.history-breakdown{grid-template-columns:1fr}.history-breakdown>div{padding:12px}.history-breakdown dd{font-size:17px}}
</style>
