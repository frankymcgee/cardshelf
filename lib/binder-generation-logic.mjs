import { createHash } from 'node:crypto';
import { ensure } from './errors.mjs';
import * as v from './validate.mjs';
import { binderType } from './tracking-logic.mjs';
import { TRACKING_COLOUR } from '../shared/binder-types.mjs';
const MAX_SLOTS = 9600;
const compareNumber = new Intl.Collator('en', { numeric: true, sensitivity: 'base' }).compare;
export function generationInput(input) {
  const o = v.object(input), type = binderType(o.binder_type);
  ensure(type !== 'tracking' || !v.bool(o.owned_only ?? false, 'Owned cards only'), 400, 'Tracking binders start with a full, uncollected checklist; disable Owned cards only.');
  ensure(Array.isArray(o.set_ids) && o.set_ids.length > 0 && o.set_ids.length <= 50, 400, 'Choose between 1 and 50 imported sets.');
  const set_ids = [...new Set(o.set_ids.map(id => v.cardId(id)))].sort();
  ensure(new Set(set_ids.map(id => id.split(':')[0])).size === 1, 400, 'Choose sets in one language per generation.');
  return { binder_type: type, title: v.text(o.title, 'Binder name', 1, 85), description: v.text(o.description ?? '', 'Description', 0, 1000),
    color: type === 'tracking' ? TRACKING_COLOUR : v.binderInput({ title: o.title, columns: o.columns, rows: o.rows, page_count: 1, color: o.color }).color,
    columns: v.oneOf(o.columns, 'Columns', [2,3,4]), rows: v.oneOf(o.rows, 'Rows', [2,3,4]),
    set_ids, selection: v.oneOf(o.selection ?? 'designs', 'Printing selection', ['designs','printings']),
    owned_only: v.bool(o.owned_only ?? false, 'Owned cards only'),
    new_page_per_set: v.bool(o.new_page_per_set ?? true, 'Start sets on a new page') };
}
const rank = p => ({ normal: 0, holo: 1, reverse: 2, unspecified: 3 }[p.key] ?? 4);
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function generationHash(options) { return hash(options); }
export function makeBinderPlan(options, sets, candidates) {
  ensure(candidates.length <= MAX_SLOTS, 400, 'This selection exceeds 9,600 printings. Select fewer sets.');
  const orderedSets = [...sets].sort((a,b) => ((Date.parse(a.release_date ?? '') || 0) - (Date.parse(b.release_date ?? '') || 0)) || compareNumber(a.name,b.name) || a.id.localeCompare(b.id));
  ensure(orderedSets.length === options.set_ids.length && orderedSets.every(s => options.set_ids.includes(s.id)), 404, 'One or more selected sets are not imported.');
  const pageSize = options.columns * options.rows, capacity = pageSize * 60;
  const slots = [], summary = [];
  let position = 0;
  for (const set of orderedSets) {
    let rows = candidates.filter(p => p.set_id === set.id && (!options.owned_only || Number(p.quantity) > 0));
    rows.sort((a,b) => compareNumber(a.local_id,b.local_id) || a.card_id.localeCompare(b.card_id) ||
      rank(a)-rank(b) || a.key.localeCompare(b.key) || a.printing_id.localeCompare(b.printing_id));
    if (options.selection === 'designs') {
      const seen = new Set();
      rows = rows.filter(p => { if (seen.has(p.card_id)) return false; seen.add(p.card_id); return true; });
    }
    if (rows.length && slots.length && options.new_page_per_set) position = Math.ceil(position/pageSize)*pageSize;
    const first = position;
    for (const p of rows) slots.push({ position: position++, printing_id: p.printing_id, card_id: p.card_id,
      name: p.name, local_id: p.local_id, label: p.label, set_id: set.id, owned: options.binder_type !== 'tracking' && Number(p.quantity) > 0 });
    summary.push({ id: set.id, name: set.name, series: set.series, language: set.language,
      imported: Number(set.imported_count), expected: Number(set.card_count), slots: rows.length,
      partial: Number(set.imported_count) < Number(set.card_count), first_position: rows.length ? first : null });
  }
  ensure(slots.length > 0, 400, options.owned_only ? 'No owned cards match these sets. Record ownership or disable Owned cards only.' : 'No imported printings match these sets. Finish the catalogue imports first.');
  const volumeCount = Math.ceil(position / capacity);
  ensure(volumeCount <= 10, 400, 'This layout needs more than 10 binders. Choose fewer sets or a larger pocket layout.');
  const volumes = Array.from({ length: volumeCount }, (_, i) => {
    const volumeSlots = slots.filter(s => Math.floor(s.position/capacity) === i).map(s => ({...s,position:s.position-i*capacity}));
    return { title: volumeCount === 1 ? options.title : `${options.title} · ${i+1}/${volumeCount}`,
      page_count: Math.ceil((volumeSlots.at(-1).position+1)/pageSize), slots: volumeSlots };
  });
  const token = hash({ options, summary, volumes });
  return { options, token, summary, volumes, slot_count: slots.length, partial: summary.some(s => s.partial),
    owned_slots: slots.filter(s=>s.owned).length, total_pages: volumes.reduce((n,b)=>n+b.page_count,0) };
}
export function previewResult(plan) {
  return { binder_type: plan.options.binder_type, token: plan.token, sets: plan.summary, partial: plan.partial, slot_count: plan.slot_count,
    owned_slots: plan.owned_slots, total_pages: plan.total_pages, volume_count: plan.volumes.length,
    volumes: plan.volumes.map(b=>({title:b.title,page_count:b.page_count,slot_count:b.slots.length})),
    sample: plan.volumes.flatMap((b,i)=>b.slots.slice(0,12).map(s=>({...s,volume:i+1,page:Math.floor(s.position/(plan.options.columns*plan.options.rows))+1,pocket:s.position%(plan.options.columns*plan.options.rows)+1}))).slice(0,36) };
}
