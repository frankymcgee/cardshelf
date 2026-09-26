import { createHash } from 'node:crypto';
import { ensure } from './errors.mjs';
import * as v from './validate.mjs';
export const COMPLETION_LIMIT = 960;
export const MATCH_PAGE_SIZE = 6;

// Completion follows the existing binder indicators. Pockets never reserve copies.
export function completionState(binder, slots, entries) {
  const ownership = new Map();
  for (const entry of entries) {
    const state = ownership.get(entry.printing_id) || { quantity: 0, wishlist: false };
    state.quantity += entry.quantity;
    state.wishlist ||= entry.wishlist;
    ownership.set(entry.printing_id, state);
  }
  const ordered = [...slots].sort((a, b) => a.position - b.position), missing = new Map();
  let completed = 0;
  for (const slot of ordered) {
    const state = ownership.get(slot.printing_id) || { quantity: 0, wishlist: false };
    const collected = binder.binder_type === 'tracking' ? slot.is_collected === true : state.quantity > 0;
    if (collected) { completed++; continue; }
    if (!missing.has(slot.printing_id)) missing.set(slot.printing_id, {
      printing_id: slot.printing_id, card_id: slot.card_id, name: slot.name, local_id: slot.local_id,
      label: slot.label, language: slot.language, game: slot.game, image_url: slot.image_url, set_name: slot.set_name,
      positions: [], wishlist: state.wishlist, owned_quantity: state.quantity
    });
    missing.get(slot.printing_id).positions.push(slot.position);
  }
  const token = createHash('sha256').update(JSON.stringify({
    binder: [binder.id, binder.revision, binder.binder_type, binder.game, binder.generation?.options?.selection],
    slots: ordered.map(s => [s.position, s.printing_id, s.is_collected]),
    entries: [...entries].sort((a, b) => a.printing_id.localeCompare(b.printing_id) || a.condition.localeCompare(b.condition))
      .map(e => [e.printing_id, e.condition, e.quantity, e.wishlist, e.revision])
  })).digest('hex');
  return { items: [...missing.values()], preview_token: token,
    progress: { total: slots.length, completed, missing: slots.length - completed, missing_printings: missing.size,
      percent: slots.length ? Math.round(completed / slots.length * 100) : 0 } };
}
export function completionWishlistInput(input) {
  const o = v.object(input);
  ensure(Object.keys(o).every(k => ['preview_token', 'printing_ids', 'confirm_displayed_printings'].includes(k)), 400, 'Unsupported completion field.');
  const preview_token = v.text(o.preview_token, 'Preview token', 64, 64);
  ensure(/^[a-f0-9]{64}$/.test(preview_token), 400, 'Preview token is invalid.');
  ensure(Array.isArray(o.printing_ids) && o.printing_ids.length > 0 && o.printing_ids.length <= COMPLETION_LIMIT, 400, 'Select between 1 and 960 missing printings.');
  const printing_ids = o.printing_ids.map(id => v.uuid(id, 'Printing'));
  ensure(new Set(printing_ids).size === printing_ids.length, 400, 'Select each printing only once.');
  return { preview_token, printing_ids, confirm_displayed_printings: v.bool(o.confirm_displayed_printings ?? false, 'Confirm displayed printings') };
}
export function completionSelection(binder, state, input) {
  ensure(input.preview_token === state.preview_token, 409, 'This binder or your collection changed. Refresh the missing cards and review your selection.');
  ensure(binder.binder_type !== 'tracking' || binder.generation?.options?.selection !== 'designs' || input.confirm_displayed_printings, 400,
    'This checklist tracks card designs. Confirm that you want the exact displayed printings on your wishlist.');
  const byId = new Map(state.items.map(item => [item.printing_id, item]));
  ensure(input.printing_ids.every(id => byId.has(id)), 409, 'A selected printing is no longer missing from this binder. Refresh and review your selection.');
  ensure(input.printing_ids.every(id => byId.get(id).game === binder.game), 409, 'A target no longer belongs to this binder’s game. Review its layout before adding wishes.');
  return input.printing_ids.filter(id => !byId.get(id).wishlist);
}
export function completionMatchQuery(query) {
  const o = v.object(query);
  ensure(Object.keys(o).every(k => ['printing_id', 'page'].includes(k)), 400, 'Unsupported listing filter.');
  const text = o.page ?? '1';
  ensure(typeof text === 'string' && /^[1-9][0-9]{0,4}$/.test(text), 400, 'Page is invalid.');
  return { printing_id: v.uuid(o.printing_id, 'Printing'), page: Number(text) };
}
