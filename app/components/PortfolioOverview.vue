<script setup lang="ts">
import { historyCutoff, historySegments } from '../../shared/value-history.mjs';
import { gameName } from '../../shared/games.mjs';
const props = defineProps<{ history: any; portfolio?: any }>();
const days = ref(30);
const insightsOpen = ref(false), insightsId = useId();
const cutoff = computed(() => historyCutoff(props.history.today, days.value));
const points = computed(() => props.history.points.filter((point: any) => point.snapshot_date >= cutoff.value && point.snapshot_date <= props.history.today)
  .map((point: any) => ({ date: point.snapshot_date, value: point.valuation.aud_total })));
const priced = computed(() => points.value.filter((point: any) => point.value != null));
const bounds = computed(() => {
  const values = priced.value.map((point: any) => point.value);
  const min = Math.min(...values), max = Math.max(...values);
  return { min, span: max - min || Math.max(1, max * .1) };
});
const x = (date: string) => 10 + (Date.parse(date) - Date.parse(cutoff.value)) / ((days.value - 1) * 86400000) * 620;
const y = (value: number) => 78 - (value - bounds.value.min) / bounds.value.span * 62;
const lines = computed(() => historySegments(points.value).filter(segment => segment.length > 1).map(segment => segment.map((i, n) => {
  const point = points.value[i];
  return `${n ? 'L' : 'M'}${x(point.date)},${y(point.value)}`;
}).join(' ')));
const change = computed(() => props.history.changes?.[days.value]);
const movers = computed(() => props.portfolio?.movers?.[days.value]);
const allocation = computed<any[]>(() => props.portfolio?.allocation || []);
const allocated = computed(() => allocation.value.reduce((sum, row) => sum + (row.aud_total ?? 0), 0));
const money = (value: number | null, signed = false) => value == null ? 'Not priced' : new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', ...(signed ? { signDisplay: 'exceptZero' as const } : {}) }).format(value);
const date = (value: string) => new Date(value + 'T00:00:00Z').toLocaleDateString('en-AU', { day: 'numeric', month: 'short', timeZone: 'UTC' });
</script>
<template>
  <section class="portfolio-overview" aria-label="Portfolio overview">
    <div class="portfolio-heading"><h3>Portfolio trend</h3><div class="portfolio-controls"><div class="portfolio-period" role="group" aria-label="Portfolio period"><button v-for="period in [7, 30, 90]" :key="period" type="button" :aria-pressed="days === period" @click="days = period">{{ period }}D</button></div><button v-if="portfolio" class="portfolio-insights-button" type="button" aria-label="Portfolio insights" :aria-expanded="insightsOpen" :aria-controls="insightsId" @click="insightsOpen = !insightsOpen">Insights</button></div></div>
    <div class="portfolio-trend-row" :class="{ 'has-trend': priced.length }">
    <svg v-if="priced.length" viewBox="0 0 640 90" preserveAspectRatio="none" class="portfolio-sparkline" role="img" :aria-label="'Portfolio trend in AUD over ' + days + ' days. ' + priced.length + ' priced observations; missing days are gaps.'">
      <path v-for="(line, i) in lines" :key="i" :d="line" />
      <template v-for="point in points" :key="point.date"><circle v-if="point.value != null" :cx="x(point.date)" :cy="y(point.value)" r="3"><title>{{ date(point.date) }}: {{ money(point.value) }} AUD</title></circle></template>
    </svg>
    <p v-else class="small muted portfolio-empty">{{ points.length ? 'No priced trend available yet.' : 'Daily tracking starts with your first observation.' }}</p>
    <div v-if="change?.total_aud != null" class="portfolio-change"><p><strong>{{ money(change.total_aud, true) }}<template v-if="change.percent != null"> ({{ change.percent > 0 ? '+' : '' }}{{ change.percent }}%)</template></strong><span>{{ date(change.from) }}–{{ date(change.to) }} · recorded value</span></p><small>Prices & rates {{ money(change.price_fx_aud, true) }} · copies +{{ change.added_quantity }}/−{{ change.removed_quantity }}</small></div>
    <p v-else class="small muted">{{ priced.length === 1 ? 'First observation saved. Your trend grows as daily values are recorded.' : 'Your trend needs two priced daily observations.' }}</p>
    </div>
    <p v-if="!history.enabled" class="small muted">Recording paused. Showing saved observations.</p>
    <div v-if="portfolio" v-show="insightsOpen" :id="insightsId" class="portfolio-insights">
      <div class="portfolio-insight-grid">
        <section aria-label="Value by game"><h4>Value by game</h4><p v-if="!allocation.length" class="small muted">Add owned cards to see your collection here.</p><div v-for="row in allocation" :key="row.game" class="portfolio-game"><div><strong>{{ gameName(row.game) }}</strong><span>{{ money(row.aud_total) }}</span></div><progress :value="row.aud_total ?? 0" :max="Math.max(1, allocated)" :aria-label="gameName(row.game) + ' share of priced value'" /><small>{{ row.priced_quantity }} / {{ row.quantity }} copies priced<template v-if="row.approximate_quantity"> · {{ row.approximate_quantity }} guide estimates</template></small></div></section>
        <section aria-label="Biggest movers"><h4>Biggest movers</h4><p class="small muted">Estimated changes on retained copies, including currency movements.</p><p v-if="!movers" class="small muted">Movers need two recorded days with comparable prices.</p><template v-else><p class="small muted">{{ date(movers.from) }}–{{ date(movers.to) }} · {{ movers.comparable_printings }} comparable printings</p><template v-for="group in [{ label: 'Gainers', rows: movers.gainers }, { label: 'Decliners', rows: movers.decliners }]" :key="group.label"><h5 v-if="group.rows.length">{{ group.label }}</h5><NuxtLink v-for="item in group.rows" :key="item.printing_id" :to="'/cards?card=' + encodeURIComponent(item.card_id)" class="portfolio-mover"><div><strong>{{ item.name }}</strong><small>{{ item.set_name }} · {{ item.label }} · {{ item.language.toUpperCase() }} · {{ item.quantity }} retained {{ item.quantity === 1 ? 'copy' : 'copies' }}</small></div><span>{{ money(item.change_aud, true) }}<small>{{ item.percent > 0 ? '+' : '' }}{{ item.percent }}%</small></span></NuxtLink></template><p v-if="!movers.gainers.length && !movers.decliners.length" class="small muted">{{ movers.comparable_printings ? 'No comparable price movement of one cent or more.' : 'No retained printings have comparable prices in this period.' }}</p></template></section>
      </div>
    </div>
  </section>
</template>
<style scoped>
.portfolio-controls{display:flex;gap:8px;align-items:center}.portfolio-insights-button{min-height:36px;padding:0 10px;border:1px solid var(--line);border-radius:8px;background:var(--paper);color:var(--ink);font-size:11px;cursor:pointer}.portfolio-insights-button[aria-expanded=true]{background:var(--accent-soft);color:var(--primary)}.portfolio-insights-button:focus-visible{outline:2px solid var(--action);outline-offset:3px}.portfolio-insights{border-top:1px solid var(--line);padding-top:10px}
.portfolio-overview{margin-top:16px;border-top:1px solid var(--line);padding-top:14px;min-width:0}.portfolio-heading{display:flex;align-items:center;justify-content:space-between;gap:12px}.portfolio-heading h3{font-size:14px;margin:0}.portfolio-period{display:flex;gap:4px}.portfolio-period button{min-height:36px;min-width:40px;border:1px solid var(--line);border-radius:8px;background:var(--paper);color:var(--muted);cursor:pointer;font-size:11px}.portfolio-period button[aria-pressed=true]{background:var(--action);color:var(--on-action);border-color:var(--action)}.portfolio-period button:focus-visible{outline:2px solid var(--action);outline-offset:3px}.portfolio-sparkline{width:100%;height:76px;display:block;margin:4px 0}.portfolio-sparkline path{fill:none;stroke:var(--primary);stroke-width:2.5;vector-effect:non-scaling-stroke}.portfolio-sparkline circle{fill:var(--primary);vector-effect:non-scaling-stroke}.portfolio-change p{display:flex;align-items:baseline;flex-wrap:wrap;gap:6px 12px;margin:5px 0}.portfolio-change strong{font-size:14px}.portfolio-change span,.portfolio-change>small{font-size:11px;color:var(--muted)}.portfolio-insights{margin-top:12px}.portfolio-insight-grid{display:grid;grid-template-columns:1fr 1.3fr;gap:24px;padding:6px 0}.portfolio-insight-grid h4{font-size:14px;margin:6px 0 14px}.portfolio-insight-grid h5{font-size:12px;margin:16px 0 6px}.portfolio-game{margin:14px 0}.portfolio-game>div{display:flex;gap:12px;justify-content:space-between;font-size:12px}.portfolio-game progress{width:100%;height:6px;accent-color:var(--primary);margin:7px 0}.portfolio-game>small,.portfolio-mover small{display:block;font-size:11px;color:var(--muted);line-height:1.6}.portfolio-mover{display:flex;justify-content:space-between;gap:14px;border-top:1px solid var(--line);padding:10px 0;font-size:12px;min-width:0}.portfolio-mover>div{min-width:0;overflow-wrap:anywhere}.portfolio-mover>span{text-align:right;white-space:nowrap;font-weight:700}.portfolio-empty{margin:14px 0}@media(max-width:600px){.portfolio-insight-grid{grid-template-columns:1fr;gap:12px}.portfolio-change p{display:block}.portfolio-change span{display:block;margin-top:4px}.portfolio-sparkline{height:64px}}

@media(max-width:600px){.portfolio-overview{margin-top:8px;padding-top:8px}.portfolio-heading{gap:6px;flex-wrap:wrap}.portfolio-heading h3{font-size:13px}.portfolio-controls{gap:6px}.portfolio-period button{min-height:30px;min-width:32px}.portfolio-insights-button{min-height:30px;padding:0 8px}.portfolio-trend-row.has-trend{display:grid;grid-template-columns:3fr 5fr;align-items:center;gap:10px;margin-top:5px}.portfolio-trend-row.has-trend .portfolio-sparkline{height:54px;margin:0}.portfolio-change p{margin:0}.portfolio-change strong{font-size:13px;line-height:1.4}.portfolio-change span{font-size:10px;line-height:1.4;margin-top:2px}.portfolio-change>small{display:block;font-size:10px;line-height:1.4}.portfolio-trend-row>.small{font-size:11px;line-height:1.5;margin:6px 0}}
</style>
