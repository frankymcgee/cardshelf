/** Wishlist shortcuts operate on one catalogue printing, never on owned quantity. */
/**
 * @typedef {{printing_id: string, condition: string, quantity: number,
 *   wishlist: boolean, notes: string, revision: number}} WishlistEntry
 * @typedef {{condition: string, revision: number}} WishlistRevision
 */
/** @param {readonly WishlistEntry[]} entries @param {string} printingId @returns {boolean} */
export function printingWishlisted(entries, printingId) {
  return Array.isArray(entries) && entries.some(e => e.printing_id === printingId && e.wishlist === true);
}
/**
 * Includes non-wishlisted rows too: an ownership edit must invalidate an old shortcut.
 * No notes, quantities or account identifiers are submitted by the shortcut.
 * @param {readonly WishlistEntry[]} entries @param {string} printingId
 * @returns {WishlistRevision[]}
 */
export function wishlistRevisions(entries, printingId) {
  return entries.filter(e => e.printing_id === printingId)
    .map(e => ({ condition: e.condition, revision: e.revision }))
    .sort((a, b) => a.condition.localeCompare(b.condition));
}
/**
 * Rebase only the fields this shortcut changes. Preserve any unsaved condition,
 * quantity and notes; their last saved values were checked by the server revision guard.
 * @param {WishlistEntry|undefined} draft @param {readonly WishlistEntry[]} entries
 * @param {readonly WishlistEntry[]} previousEntries
 * @returns {WishlistEntry|undefined}
 */
export function wishlistDraft(draft, entries, previousEntries) {
  if (!draft) return undefined;
  const previous = previousEntries.find(e => e.printing_id === draft.printing_id && e.condition === draft.condition);
  // Never bless an already-stale ownership form after a wishlist conflict refresh.
  if (draft.revision !== (previous?.revision ?? 0)) return draft;
  const saved = entries.find(e => e.printing_id === draft.printing_id && e.condition === draft.condition);
  return { ...draft, wishlist: saved?.wishlist ?? false, revision: saved?.revision ?? 0 };
}
