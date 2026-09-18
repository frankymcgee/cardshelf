import { createHash } from 'node:crypto';
import { ensure } from './errors.mjs';
import * as v from './validate.mjs';
export const stateHash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function token(value, name) {
  const result = v.text(value, name, 64, 64);
  ensure(/^[a-f0-9]{64}$/.test(result), 400, `${name} is invalid.`);
  return result;
}
function strict(input, fields) {
  const value = v.object(input);
  ensure(Object.keys(value).every(key => fields.includes(key)), 400, 'Unsupported collection-sync field.');
  return value;
}
export function conversionInput(input) {
  const o = strict(input, ['request_id', 'revision', 'preview_token', 'import_marks', 'confirm', 'confirm_displayed_printings']);
  ensure(o.confirm === true, 400, 'Confirm conversion and sharing-link revocation.');
  return {request_id: v.uuid(o.request_id, 'Request ID'), revision: v.integer(o.revision, 'Revision', 1, Number.MAX_SAFE_INTEGER),
    preview_token: token(o.preview_token, 'Preview token'), import_marks: v.bool(o.import_marks, 'Import marks'),
    confirm: true, confirm_displayed_printings: v.bool(o.confirm_displayed_printings, 'Confirm displayed printings')};
}
export function quickOwnershipInput(input) {
  const o = strict(input, ['request_id', 'revision', 'position', 'printing_id', 'collected', 'ownership_version']);
  return {request_id: v.uuid(o.request_id, 'Request ID'), revision: v.integer(o.revision, 'Revision', 1, Number.MAX_SAFE_INTEGER),
    position: v.integer(o.position, 'Pocket', 0, 959), printing_id: v.uuid(o.printing_id, 'Printing'),
    collected: v.bool(o.collected, 'Collected'), ownership_version: token(o.ownership_version, 'Ownership version')};
}
// Tokens describe this printing's complete ownership, not the binder's layout.
// A stale modal cannot remove a copy that was changed in the detailed editor.
export function ownershipState(entries = [], proof = null) {
  const rows = [...entries].sort((a, b) => a.condition.localeCompare(b.condition));
  const quantity = rows.reduce((n, row) => n + row.quantity, 0);
  const unknown = rows.find(row => row.condition === 'UNKNOWN');
  return {owned: quantity > 0, is_collected: quantity > 0, owned_quantity: quantity,
    ownership_version: stateHash(rows.map(row => [row.condition, row.quantity, row.revision, row.wishlist, row.notes])),
    can_quick_remove: quantity === 1 && unknown?.quantity === 1 && !!proof && proof.entry_revision === unknown.revision};
}
export function ownershipAction(state, change) {
  ensure(state.ownership_version === change.ownership_version, 409, 'Ownership changed in another session. Reload before marking this card.');
  if (change.collected) return state.owned ? 'none' : 'add';
  if (!state.owned) return 'none';
  ensure(state.can_quick_remove, 409, 'This printing has detailed or multiple owned copies. Use View card & ownership to edit its quantities.');
  return 'remove';
}
export function conversionToken(binder, slots, entries) {
  return stateHash({id: binder.id, revision: binder.revision, selection: binder.generation?.options?.selection || 'printings',
    slots: [...slots].sort((a,b) => a.position-b.position).map(slot => [slot.position,slot.printing_id,slot.is_collected]),
    entries: [...entries].sort((a,b) => a.printing_id.localeCompare(b.printing_id) || a.condition.localeCompare(b.condition))
      .map(row => [row.printing_id,row.condition,row.quantity,row.revision,row.wishlist,row.notes])});
}
export function conversionPrintings(binder, slots, change) {
  if (!change.import_marks) return [];
  if (binder.generation?.options?.selection === 'designs' && slots.some(slot => slot.is_collected)) {
    ensure(change.confirm_displayed_printings, 400, 'Design checklists do not identify the owned printing. Confirm the displayed printings or convert without importing marks.');
  }
  return [...new Set(slots.filter(slot => slot.is_collected).map(slot => slot.printing_id))].sort();
}
