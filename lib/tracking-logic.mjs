import { ensure } from './errors.mjs';
import * as v from './validate.mjs';
import { BINDER_TYPES } from '../shared/binder-types.mjs';
// Missing type preserves the pre-0.5 API behaviour for existing clients.
export function binderType(value) { return v.oneOf(value ?? 'collection', 'Binder type', BINDER_TYPES); }
export function trackingInput(input) {
  const o = v.object(input);
  ensure(Object.keys(o).every(k => ['request_id', 'revision', 'position', 'printing_id', 'collected'].includes(k)), 400, 'Unsupported tracking field.');
  return { request_id: v.uuid(o.request_id, 'Request ID'), revision: v.integer(o.revision, 'Revision', 1, Number.MAX_SAFE_INTEGER),
    position: v.integer(o.position, 'Pocket', 0, 959), printing_id: v.uuid(o.printing_id, 'Printing'), collected: v.bool(o.collected, 'Collected') };
}
export function sameTrackingRequest(previous, input) {
  return previous.position === input.position && previous.printing_id === input.printing_id &&
    previous.collected === input.collected && previous.request_revision === input.revision;
}
export function assertTrackingSlot(binder, slot, input) {
  ensure(binder.binder_type === 'tracking', 400, 'Use a tracking binder for quick collection marks.');
  ensure(input.position < binder.columns * binder.rows * binder.page_count, 400, 'Pocket is outside this binder.');
  ensure(slot && slot.printing_id === input.printing_id, 409, 'The card in this pocket changed. Reload the binder.');
}
