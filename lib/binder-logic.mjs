import { ensure } from './errors.mjs';
import { integer, oneOf, uuid } from './validate.mjs';
export function capacity(binder) { return binder.columns * binder.rows * binder.page_count; }
export function validateSlotOperation(binder, input) {
  const action = oneOf(input.action, 'Slot action', ['place', 'clear', 'swap']);
  const target = integer(input.target, 'Pocket', 0, capacity(binder) - 1);
  const result = { action, target };
  if (action === 'place') result.printing_id = uuid(input.printing_id, 'Printing');
  if (action === 'swap') result.source = integer(input.source, 'Source pocket', 0, capacity(binder) - 1);
  return result;
}
// Used by the API and dependency-free tests. Neither this operation nor binder
// creation changes an ownership record. Dropping onto a filled slot swaps cards.
export function applySlotOperation(existing, operation) {
  const result = new Map(existing.map(row => [row.position, row.printing_id]));
  if (operation.action === 'clear') result.delete(operation.target);
  if (operation.action === 'place') result.set(operation.target, operation.printing_id);
  if (operation.action === 'swap' && operation.source !== operation.target) {
    const source = result.get(operation.source), target = result.get(operation.target);
    ensure(source, 409, 'The source pocket is empty. Reload this binder.');
    result.delete(operation.source); result.delete(operation.target);
    result.set(operation.target, source);
    if (target) result.set(operation.source, target);
  }
  return [...result].map(([position, printing_id]) => ({ position, printing_id })).sort((a, b) => a.position - b.position);
}
export function assertSafeResize(binder, positions) {
  ensure(positions.every(position => position < capacity(binder)), 409,
    'This change would remove occupied pockets. Clear or move those cards first.');
}
