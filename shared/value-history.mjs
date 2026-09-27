/** @typedef {{source:string,variant:string,currency:string,metric:string,amount:number,source_updated_at?:string|null}} PriceObservation */
/** @param {PriceObservation[]} history */
export function cardHistorySeries(history) {
  /** @type {Map<string,{id:string,label:string,currency:string,points:Map<string,{date:string,value:number,detail:string,timestamp:number}>}>} */
  const groups = new Map();
  for (const row of history) {
    const timestamp = Date.parse(row.source_updated_at || '');
    if (!Number.isFinite(timestamp) || !Number.isFinite(row.amount) || row.amount <= 0 || !/^[A-Z]{3}$/.test(row.currency)) continue;
    const id = JSON.stringify([row.source, row.variant, row.currency, row.metric]);
    if (!groups.has(id)) groups.set(id, { id, label: `${row.source} · ${row.variant} · ${row.metric} · ${row.currency}`, currency: row.currency, points: new Map() });
    const group = groups.get(id), date = new Date(timestamp).toISOString().slice(0, 10);
    if (!group.points.has(date) || group.points.get(date).timestamp < timestamp) {
      group.points.set(date, { date, value: row.amount, detail: `Provider updated ${new Date(timestamp).toISOString()}`, timestamp });
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
