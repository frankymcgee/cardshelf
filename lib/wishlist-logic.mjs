import { ensure } from './errors.mjs';
import * as v from './validate.mjs';
import { printingWishlisted, wishlistRevisions } from '../shared/wishlist.mjs';
export function wishlistInput(input) {
  const o = v.object(input);
  ensure(Object.keys(o).every(k => ['printing_id', 'wishlist', 'revisions'].includes(k)), 400, 'Unsupported wishlist field.');
  const printing_id = v.uuid(o.printing_id, 'Printing'), wishlist = v.bool(o.wishlist, 'Wishlist');
  ensure(Array.isArray(o.revisions) && o.revisions.length <= v.CONDITIONS.length, 400, 'Send the current condition revisions.');
  const revisions = o.revisions.map(value => {
    const row = v.object(value, 'Condition revision');
    ensure(Object.keys(row).every(k => ['condition', 'revision'].includes(k)), 400, 'Unsupported condition revision field.');
    return { condition: v.oneOf(row.condition, 'Condition', v.CONDITIONS),
      revision: v.integer(row.revision, 'Revision', 1, Number.MAX_SAFE_INTEGER) };
  }).sort((a, b) => a.condition.localeCompare(b.condition));
  ensure(new Set(revisions.map(r => r.condition)).size === revisions.length, 400, 'Duplicate condition revision.');
  return { printing_id, wishlist, revisions };
}
export function wishlistChange(entries, input) {
  const current = wishlistRevisions(entries, input.printing_id);
  ensure(JSON.stringify(current) === JSON.stringify(input.revisions), 409,
    'This printing changed in another session. Refresh the card before changing its wishlist.');
  if (printingWishlisted(entries, input.printing_id) === input.wishlist) return 'none';
  return input.wishlist ? 'add' : 'remove';
}
