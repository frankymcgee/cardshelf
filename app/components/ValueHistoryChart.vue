<script setup lang="ts">
import { historyCutoff, historySegments } from '../../shared/value-history.mjs';
interface Point { date: string; value: number | null; detail?: string }
const props = withDefaults(defineProps<{ title: string; points: Point[]; currency?: string; today?: string; days?: number }>(), { currency: 'AUD', days: 30 });
const emit = defineEmits<{ 'update:days': [value: number] }>();
const today = computed(() => props.today || new Date().toISOString().slice(0, 10));
const cutoff = computed(() => historyCutoff(today.value, props.days));
const visible = computed(() => props.points.filter(point => point.date >= cutoff.value && point.date <= today.value).sort((a, b) => a.date.localeCompare(b.date)));
const index = ref(0), root = ref<HTMLElement | null>(null), width = ref(640);
const selected = computed(() => visible.value[index.value]);
watch(visible, value => { index.value = Math.max(0, value.length - 1); }, { immediate: true });
let observer: ResizeObserver | undefined;
onMounted(() => {
  observer = new ResizeObserver(entries => { width.value = Math.max(260, entries[0]?.contentRect.width || 640); });
  if (root.value) observer.observe(root.value);
});
onBeforeUnmount(() => observer?.disconnect());
const money = (value: number | null) => value == null ? 'Unpriced' : new Intl.NumberFormat('en-AU', { style: 'currency', currency: props.currency }).format(value);
const dayLabel = (date: string) => new Date(date + 'T00:00:00Z').toLocaleDateString('en-AU', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const priced = computed(() => visible.value.filter(point => point.value != null && Number.isFinite(point.value)));
const ceiling = computed(() => Math.max(1, ...priced.value.map(point => point.value!)) * 1.12);
const x = (date: string) => 64 + (Date.parse(date) - Date.parse(cutoff.value)) / ((props.days - 1) * 86400000) * (width.value - 82);
const y = (value: number) => 170 - value / ceiling.value * 148;
const paths = computed(() => historySegments(visible.value).filter(segment => segment.length > 1).map(segment => segment.map((i, n) => `${n ? 'L' : 'M'}${x(visible.value[i]!.date)},${y(visible.value[i]!.value!)}`).join(' ')));
const axis = (value: number) => new Intl.NumberFormat('en-AU', { style: 'currency', currency: props.currency, notation: 'compact', maximumFractionDigits: 1 }).format(value);
const description = computed(() => `${props.title}, ${props.currency}, last ${props.days} days. ${priced.value.length} priced daily observations. Missing days are gaps. Use the observation slider or data table for exact values.`);
</script>
<template>
  <section ref="root" class="value-chart" :aria-label="title">
    <div class="chart-heading"><h3>{{ title }}</h3><div class="chart-ranges" role="group" :aria-label="title + ' period'"><button v-for="period in [7, 30, 90]" :key="period" type="button" :aria-pressed="days === period" @click="emit('update:days', period)">{{ period }} days</button></div></div>
    <p class="chart-unit">{{ currency }} · Daily observations · UTC</p>
    <svg v-if="priced.length" class="history-plot" :viewBox="`0 0 ${width} 208`" role="img" :aria-label="description">
      <title>{{ description }}</title>
      <g v-for="fraction in [0, 0.5, 1]" :key="fraction" class="chart-axis"><line x1="64" :x2="width - 18" :y1="y(ceiling * fraction)" :y2="y(ceiling * fraction)" /><text x="54" :y="y(ceiling * fraction) + 4" text-anchor="end">{{ axis(ceiling * fraction) }}</text></g>
      <path v-for="(path, i) in paths" :key="i" :d="path" class="history-line" />
      <template v-for="(point, i) in visible" :key="point.date"><circle v-if="point.value != null" :cx="x(point.date)" :cy="y(point.value)" :r="i === index ? 5 : 3.5" class="history-dot" @mouseenter="index = i" @click="index = i"><title>{{ dayLabel(point.date) }}: {{ money(point.value) }}</title></circle></template>
      <g class="chart-axis"><text x="64" y="199">{{ dayLabel(cutoff) }}</text><text :x="width - 18" y="199" text-anchor="end">{{ dayLabel(today) }}</text></g>
    </svg>
    <p v-else class="history-empty" role="status">{{ visible.length ? 'No priced observations in this period.' : 'No history recorded in this period yet.' }}</p>
    <div v-if="selected" class="chart-observation" aria-live="polite"><div><span>{{ dayLabel(selected.date) }}</span><strong>{{ money(selected.value) }} <small>{{ currency }}</small></strong></div><p v-if="selected.detail">{{ selected.detail }}</p></div>
    <label v-if="visible.length > 1" class="chart-slider">Inspect observation<input v-model.number="index" type="range" min="0" :max="visible.length - 1" step="1" :aria-valuetext="selected ? selected.date + ': ' + money(selected.value) + ' ' + currency : ''" /></label>
    <p v-if="visible.length === 1" class="small muted">First observation saved. A trend appears after another day is recorded.</p>
    <details v-if="visible.length" class="history-data"><summary>View history data ({{ visible.length }} days)</summary><div class="table-scroll"><table><caption class="sr-only">{{ title }} in {{ currency }}</caption><thead><tr><th>Date (UTC)</th><th>{{ currency }}</th><th>Observation</th></tr></thead><tbody><tr v-for="point in visible" :key="point.date"><td>{{ point.date }}</td><td>{{ money(point.value) }}</td><td>{{ point.detail || 'Recorded price' }}</td></tr></tbody></table></div></details>
  </section>
</template>
<style scoped>
.value-chart{min-width:0;width:100%;margin:22px 0;padding:20px 0;border-top:1px solid var(--line)}
.chart-heading{display:flex;justify-content:space-between;align-items:center;gap:14px;flex-wrap:wrap}.chart-heading h3{font-size:16px;margin:0}.chart-ranges{display:flex;gap:4px;background:var(--surface-soft);padding:4px;border:1px solid var(--line);border-radius:10px}.chart-ranges button{background:transparent;color:var(--muted);border:0;border-radius:7px;padding:8px 10px;min-height:36px;font-size:12px;cursor:pointer}.chart-ranges button[aria-pressed=true]{background:var(--action);color:var(--on-action)}.chart-ranges button:focus-visible,.chart-slider input:focus-visible{outline:2px solid var(--action);outline-offset:3px}
.chart-unit{font-size:12px;color:var(--muted);margin:12px 0 4px}.history-plot{display:block;width:100%;overflow:visible}.chart-axis line{stroke:var(--line);stroke-dasharray:3 4}.chart-axis text{fill:var(--muted);font-size:11px}.history-line{fill:none;stroke:var(--action);stroke-width:2.5;stroke-linejoin:round}.history-dot{fill:var(--action);stroke:var(--paper);stroke-width:1.5;cursor:pointer}.chart-observation{padding:12px 14px;background:var(--surface-soft);border:1px solid var(--line);border-radius:10px;margin-top:8px}.chart-observation>div{display:flex;justify-content:space-between;align-items:center;gap:12px}.chart-observation span{color:var(--muted);font-size:12px}.chart-observation strong{font-size:18px}.chart-observation small{font-size:11px}.chart-observation p{font-size:12px;line-height:1.6;margin:7px 0 0;overflow-wrap:anywhere}.chart-slider{display:grid;gap:7px;font-size:12px;color:var(--muted);margin-top:14px}.chart-slider input{width:100%;padding:0;accent-color:var(--action);min-height:28px}.history-empty{padding:34px 16px;text-align:center;background:var(--surface-soft);border-radius:12px;color:var(--muted)}.history-data{margin-top:14px;font-size:12px}.history-data summary{cursor:pointer}.history-data .table-scroll{margin-top:12px;max-height:280px;overflow:auto}.history-data table{font-size:12px}.history-data td:first-child{white-space:nowrap}.history-data td{vertical-align:top}.sr-only{position:absolute;width:1px;height:1px;padding:0;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap}
@media(max-width:480px){.chart-heading{gap:10px}.chart-heading h3{font-size:15px}.chart-ranges button{min-height:40px}.chart-observation strong{font-size:16px}.value-chart{margin-top:18px}}
</style>
