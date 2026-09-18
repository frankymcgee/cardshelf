<script setup lang="ts">
import { cardmarketHighlights, cardmarketMetricLabel, cardmarketGroupLabel, priceAvailabilityMessage, missingPrintingMessage } from '../../shared/price-display.mjs';
import type { DisplayQuote } from '../../shared/price-display.mjs';
interface PrintingPrice { id: string; key: string; label: string; source: string; price: DisplayQuote | null }
interface PricesResponse {
  enabled: boolean; fetched_at: string | null; attempted_at: string | null; last_error: string;
  printings: PrintingPrice[]; references: DisplayQuote[]; history: DisplayQuote[];
}
const props = defineProps<{ cardId: string }>();
const api = useApi(), notice = useNotice();
const data = ref<PricesResponse | null>(null), error = ref(''), busy = ref(false), waiting = ref(false);
let sequence = 0, timer: ReturnType<typeof setTimeout> | undefined, alive = true;
const money = (amount: number | null, currency: string) => amount == null ? 'Unavailable' : new Intl.NumberFormat('en-AU', { style: 'currency', currency, currencyDisplay: 'narrowSymbol' }).format(amount);
const highlights = computed(() => cardmarketHighlights(data.value?.references || []));
const availability = computed(() => data.value ? priceAvailabilityMessage(data.value) : '');
const date = (value: string | null | undefined) => value ? new Date(value).toLocaleString() : 'Not supplied';
async function load() {
  const request = ++sequence, id = props.cardId;
  try { const value = await api<PricesResponse>('/api/cards/' + encodeURIComponent(id) + '/prices'); if (alive && request === sequence) { data.value = value; error.value = ''; } }
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
    if (id !== props.cardId || !alive) return;
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
    <p v-if="error" class="alert warning" role="alert">{{ error }}</p>
    <template v-if="data">
      <p class="muted small">Last successful check: {{ date(data.fetched_at) }}</p>
      <p v-if="data.enabled === false" class="muted small">Automatic pricing is disabled. Previously cached observations may still be shown.</p>
      <p v-if="data.last_error" class="alert warning">Latest refresh failed. Previous prices are retained but excluded from totals until a successful refresh. {{ data.last_error }}</p>
      <p v-if="availability" class="alert info" role="status">{{ availability }}</p>

      <!-- A reference is presented once per provider category, never attached to
           every printing or promoted to a matched collection value. -->
      <section v-if="highlights.length" class="cm-references" aria-label="Cardmarket reference prices">
        <div class="cm-heading"><h4>Cardmarket</h4><span class="badge">Reference prices</span></div>
        <p class="data-note">Printing not confirmed · Not included in collection or binder totals.</p>
        <div v-for="reference in highlights" :key="reference.variant" class="cm-reference-quote">
          <strong>{{ cardmarketGroupLabel(reference.variant) }}</strong>
          <span class="cm-reference-amount">{{ reference.aud == null ? money(reference.amount, reference.currency) + ' ' + reference.currency : '≈ ' + money(reference.aud, 'AUD') + ' AUD' }}</span>
          <span class="small">{{ cardmarketMetricLabel(reference.metric) }} · {{ money(reference.amount, reference.currency) }} {{ reference.currency }}</span>
          <span class="small muted">Source updated {{ date(reference.source_updated_at) }}<template v-if="reference.fx_date"> · AUD rate date {{ reference.fx_date }}</template></span>
          <div class="cm-flags"><span v-if="reference.stale" class="badge amber">Stale / source date unavailable</span><span v-if="reference.fetch_error" class="badge amber">Latest refresh failed</span><span v-if="reference.aud == null" class="badge">AUD rate unavailable</span></div>
        </div>
        <p class="data-note">These are the provider’s card-level and holo-category references, not confirmation of the selected finish, edition, language of a marketplace sale or card condition. Different metrics are not independent price sources.</p>
        <details v-if="data.references.length > highlights.length">
          <summary>All Cardmarket reference metrics</summary>
          <div class="table-scroll"><table><thead><tr><th>Category</th><th>Metric</th><th>EUR</th><th>Approx. AUD</th><th>Source updated</th></tr></thead><tbody>
            <tr v-for="reference in data.references" :key="reference.variant + ':' + reference.metric"><td>{{ cardmarketGroupLabel(reference.variant) }}</td><td>{{ cardmarketMetricLabel(reference.metric) }}</td><td>{{ money(reference.amount, reference.currency) }}</td><td>{{ money(reference.aud ?? null, 'AUD') }}</td><td>{{ date(reference.source_updated_at) }}<span v-if="reference.stale" class="badge amber">Stale</span></td></tr>
          </tbody></table></div>
          <p class="data-note">The highlighted metric prefers trend, then a 30-day average, 7-day average, average selling price or 1-day average. Original metric labels and timestamps are retained.</p>
        </details>
      </section>
      <p v-else-if="data.fetched_at && !data.last_error" class="muted small">No supported Cardmarket reference was supplied in the last successful feed response.</p>

      <h4 class="tcg-heading">TCGplayer printing prices</h4>
      <div v-for="printing in data.printings" :key="printing.id" class="printing-price">
        <strong>{{ printing.label }}</strong>
        <template v-if="printing.price">
          <span>{{ printing.price.aud == null ? money(printing.price.amount, printing.price.currency) : money(printing.price.aud, 'AUD') + ' AUD' }}</span>
          <small class="muted">{{ printing.price.source }} · {{ money(printing.price.amount, printing.price.currency) }} {{ printing.price.currency }} · Market price</small>
          <small class="muted">Source updated {{ date(printing.price.source_updated_at) }}<template v-if="printing.price.fx_date"> · AUD rate date {{ printing.price.fx_date }}</template></small>
          <span v-if="printing.price.stale" class="badge amber">Stale / source date unavailable</span><span v-if="printing.price.aud == null" class="badge">AUD rate unavailable</span>
        </template>
        <span v-else class="muted small">{{ missingPrintingMessage(printing, data) }}</span>
      </div>
      <details v-if="data.history.length"><summary>Recorded price history</summary><div class="table-scroll"><table><thead><tr><th>Source update</th><th>Market / category</th><th>Metric</th><th>Price</th></tr></thead><tbody><tr v-for="(history, index) in data.history.slice(0, 30)" :key="index"><td>{{ date(history.source_updated_at) }}</td><td>{{ history.source }} / {{ history.variant }}</td><td>{{ history.source === 'Cardmarket' ? cardmarketMetricLabel(history.metric) : history.metric }}</td><td>{{ money(history.amount, history.currency) }} {{ history.currency }}</td></tr></tbody></table></div><p class="data-note">Up to 30 recent observations shown. A 7-day or 30-day average is one provider observation, not a reconstructed sale history. Reference observations are not part of collection totals.</p></details>
    </template>
    <p v-else-if="!error" class="muted small">Loading prices…</p>
    <p class="data-note">Indicative market prices, not an appraisal, sale guarantee or condition-specific value. Both marketplaces are supplied through the existing TCGdex feed; no extra API key is needed. English and Japanese card records are never substituted for one another.</p>
  </section>
</template>
<style scoped>
.cm-references{border:1px solid var(--border,#dcdfe7);border-radius:12px;padding:16px;margin:16px 0;min-width:0}
.cm-heading{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}
.cm-heading h4,.tcg-heading{margin:0;font-size:1rem}
.cm-reference-quote{display:grid;gap:6px;padding:14px 0;overflow-wrap:anywhere}
.cm-reference-quote+.cm-reference-quote{border-top:1px solid var(--border,#dcdfe7)}
.cm-reference-amount{font-size:1.35rem;font-weight:700}
.cm-flags{display:flex;gap:6px;flex-wrap:wrap}.cm-flags:empty{display:none}
.tcg-heading{margin-top:20px}.cm-references .table-scroll{max-width:100%;margin-top:12px}
.cm-references .data-note{line-height:1.5}
@media(max-width:480px){.cm-references{padding:12px}.cm-reference-amount{font-size:1.2rem}}
</style>
