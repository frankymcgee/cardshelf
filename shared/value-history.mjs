import { cardmarketGroupLabel, cardmarketMetricLabel } from './price-display.mjs';
const variants = { normal: 'Normal', holo: 'Holo', reverse: 'Reverse holo', foil: 'Foil', etched: 'Etched foil', 'card-reference': 'Card-level reference', 'vendor-reference': 'Vendor reference' };
const metrics = { marketPrice: 'Market price', retail: 'Retail reference' };
/** @typedef {{source:string,variant:string,currency:string,metric:string,amount:number,source_updated_at?:string|null}} PriceObservation */
/** @param {PriceObservation[]} history */
export function cardHistorySeries(history) {
  /** @type {Map<string,{id:string,label:string,currency:string,points:Map<string,{date:string,value:number,detail:string,timestamp:number}>}>} */
  const groups = new Map();
  for (const row of history) {
    const timestamp = Date.parse(row.source_updated_at || '');
    if (!Number.isFinite(timestamp) || !Number.isFinite(row.amount) || row.amount <= 0 || !/^[A-Z]{3}$/.test(row.currency)) continue;
    const id = JSON.stringify([row.source, row.variant, row.currency, row.metric]);
    const variant = row.source === 'Cardmarket' ? cardmarketGroupLabel(row.variant) : variants[row.variant] || row.variant;
    const metric = row.source === 'Cardmarket' ? cardmarketMetricLabel(row.metric) : metrics[row.metric] || row.metric;
    if (!groups.has(id)) groups.set(id, { id, label: `${row.source} · ${variant} · ${metric} · ${row.currency}`, currency: row.currency, points: new Map() });
    const group = groups.get(id), date = new Date(timestamp).toISOString().slice(0, 10);
    if (!group.points.has(date) || group.points.get(date).timestamp < timestamp) {
      const updated = new Date(timestamp).toLocaleString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' });
      group.points.set(date, { date, value: row.amount, detail: `Provider updated ${updated} UTC`, timestamp });
    }
  }
  return [...groups.values()].sort((a, b) => a.label.localeCompare(b.label)).map(group => ({ ...group, points: [...group.points.values()].sort((a, b) => a.date.localeCompare(b.date)) }));
}

/** @param {string} today @param {number} days */
export function historyCutoff(today, days) {
  return new Date(Date.parse(today + 'T00:00:00Z') - (days - 1) * 86400000).toISOString().slice(0, 10);
}

/** @param {{date:string,value:number|null}[]} points */
export function historySegments(points) {
  /** @type {number[][]} */
  const segments = [];
  let previous = -1;
  points.forEach((point, index) => {
    if (point.value == null || !Number.isFinite(point.value)) { previous = -1; return; }
    if (previous < 0 || Date.parse(point.date) - Date.parse(points[previous].date) > 86400000) segments.push([]);
    segments.at(-1).push(index); previous = index;
  });
  return segments;
}
