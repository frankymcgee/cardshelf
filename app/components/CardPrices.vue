<script setup lang="ts">
const props = defineProps<{ cardId: string }>();
const api = useApi(), notice = useNotice();
const data = ref<any>(null), error = ref(''), busy = ref(false), waiting = ref(false);
let sequence = 0, timer: ReturnType<typeof setTimeout> | undefined, alive = true;
const money = (amount: number | null, currency: string) => amount == null ? 'Unavailable' : new Intl.NumberFormat('en-AU', { style: 'currency', currency }).format(amount);
const date = (value: string | null) => value ? new Date(value).toLocaleString() : 'Not supplied';
async function load() {
  const request = ++sequence, id = props.cardId;
  try { const value = await api('/api/cards/' + encodeURIComponent(id) + '/prices'); if (alive && request === sequence) { data.value = value; error.value = ''; } }
  catch (e) { if (alive && request === sequence) error.value = errorMessage(e); }
}
watch(() => props.cardId, () => { clearTimeout(timer); data.value = null; waiting.value = false; load(); }, { immediate: true });
onBeforeUnmount(() => { alive = false; sequence++; clearTimeout(timer); });
async function refresh() {
  if (busy.value) return;
  busy.value = true;
  const id = props.cardId, before = data.value?.attempted_at;
  try {
    const result = await api('/api/prices/refresh', { method: 'POST', body: { card_id: id } });
    notice.show(result.message || (result.already_queued ? 'Price check already queued.' : 'Price check queued.'));
    if (id !== props.cardId || !alive) return;
    await load();
    if (!result.recent) {
      waiting.value = true; let remaining = 12;
      const poll = async () => {
        if (!alive || id !== props.cardId) return;
        await load();
        if (!alive || id !== props.cardId) return;
        if (data.value?.attempted_at !== before || --remaining <= 0) { waiting.value = false; return; }
        timer = setTimeout(poll, 5000);
      };
      clearTimeout(timer); timer = setTimeout(poll, 5000);
    }
  } catch (e) { notice.show(errorMessage(e), 'error'); }
  finally { busy.value = false; }
}
</script>
<template>
  <section class="card-prices">
    <div class="section-heading"><h3>Market prices</h3><button class="text-button" :disabled="busy || waiting || data?.enabled === false" @click="refresh">{{ waiting ? 'Price check queued…' : 'Check prices' }}</button></div>
    <p v-if="error" class="alert warning">{{ error }}</p>
    <template v-if="data">
      <p class="muted small">Last successful check: {{ date(data.fetched_at) }}</p>
      <p v-if="data.last_error" class="alert warning">Latest refresh failed. Previous prices are retained but excluded from totals until a successful refresh. {{ data.last_error }}</p>
      <div v-for="p in data.printings" :key="p.id" class="printing-price">
        <strong>{{ p.label }}</strong>
        <template v-if="p.price"><span>{{ p.price.aud == null ? money(p.price.amount, p.price.currency) : money(p.price.aud, 'AUD') + ' AUD' }}</span><small class="muted">{{ p.price.source }} · {{ money(p.price.amount, p.price.currency) }} {{ p.price.currency }} · {{ p.price.metric }}</small><small class="muted">Source updated {{ date(p.price.source_updated_at) }}<template v-if="p.price.fx_date"> · AUD rate date {{ p.price.fx_date }}</template></small><span v-if="p.price.stale" class="badge amber">Stale / source date unavailable</span><span v-if="p.price.aud == null" class="badge">AUD rate unavailable</span></template>
        <span v-else class="muted small">No reliably matched printing price available</span>
      </div>
      <details v-if="data.references.length"><summary>Cardmarket card-level references (not in totals)</summary><p v-for="r in data.references" :key="r.metric" class="small">{{ r.metric }}: {{ money(r.amount, r.currency) }} {{ r.currency }}<template v-if="r.aud != null"> ≈ {{ money(r.aud,'AUD') }} AUD</template> · {{ date(r.source_updated_at) }}<span v-if="r.stale" class="badge amber">Stale</span></p><p class="data-note">These aggregate fields do not establish an exact printing match.</p></details>
      <details v-if="data.history.length"><summary>Recorded price history</summary><div class="table-scroll"><table><thead><tr><th>Source update</th><th>Market / printing</th><th>Price</th></tr></thead><tbody><tr v-for="(h, i) in data.history.slice(0,30)" :key="i"><td>{{ date(h.source_updated_at) }}</td><td>{{ h.source }} / {{ h.variant }}</td><td>{{ money(h.amount,h.currency) }} {{ h.currency }}</td></tr></tbody></table></div><p class="data-note">Up to 30 recent observations shown. History accumulates from activation; past prices are not invented.</p></details>
    </template>
    <p v-else-if="!error" class="muted small">Loading prices…</p>
    <p class="data-note">Indicative market prices, not an appraisal, sale guarantee or condition-specific value. English and Japanese records are never substituted for one another.</p>
  </section>
</template>
