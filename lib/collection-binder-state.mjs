import { ownershipState } from './collection-binder-logic.mjs';
export async function printingOwnership(sql, userId, printingIds) {
  const ids = [...new Set(printingIds)];
  if (!ids.length) return {entries: [], proofs: []};
  const entries = await sql`SELECT printing_id,condition,quantity,revision,wishlist,notes FROM collection_entries
    WHERE user_id=${userId} AND printing_id IN ${sql(ids)} ORDER BY printing_id,condition`;
  const proofs = await sql`SELECT printing_id,entry_revision FROM collection_quick_adds
    WHERE user_id=${userId} AND printing_id IN ${sql(ids)}`;
  return {entries, proofs};
}
export async function collectionSlotStates(sql, userId, slots) {
  const {entries, proofs} = await printingOwnership(sql, userId, slots.map(slot => slot.printing_id));
  const states = new Map();
  for (const slot of slots) if (!states.has(slot.printing_id)) {
    states.set(slot.printing_id, ownershipState(entries.filter(row => row.printing_id === slot.printing_id),
      proofs.find(row => row.printing_id === slot.printing_id)));
  }
  return slots.map(slot => ({...slot, ...states.get(slot.printing_id)}));
}
