import { requireGame } from './game-access.mjs';
import { db, audit, collectionLock } from './db.mjs';
import * as v from './validate.mjs';
import { ensure } from './errors.mjs';
import { trackingInput, sameTrackingRequest, assertTrackingSlot } from './tracking-logic.mjs';
export async function markCollected(userId, idInput, input) {
  const id = v.uuid(idInput), change = trackingInput(input);
  return db().begin(async sql => {
    await collectionLock(sql,userId);
    // The same lock is used by normal binder edits. Ownership is checked before replay.
    const [binder] = await sql`SELECT * FROM binders WHERE id=${id} AND user_id=${userId} FOR UPDATE`;
    ensure(binder, 404, 'Binder not found.');
    await requireGame(sql,userId,binder.game);
    const [slot] = await sql`SELECT position,printing_id,is_collected FROM binder_slots WHERE binder_id=${id} AND position=${change.position}`;
    assertTrackingSlot(binder, slot, change);
    const [previous] = await sql`SELECT * FROM binder_tracking_requests WHERE binder_id=${id} AND request_id=${change.request_id}`;
    let replayed = false;
    if (previous) {
      ensure(sameTrackingRequest(previous, change), 409, 'This request ID was used for a different change. Reload the binder.');
      replayed = true;
    } else {
      ensure(binder.revision === change.revision, 409, 'This binder changed in another session. Reload before marking this card.');
      if (slot.is_collected !== change.collected) {
        await sql`UPDATE binder_slots SET is_collected=${change.collected} WHERE binder_id=${id} AND position=${change.position}`;
        await sql`UPDATE binders SET revision=revision+1,updated_at=now() WHERE id=${id}`;
        await audit(sql, userId, 'binder.tracking_mark', { binder_id: id, position: change.position, collected: change.collected });
      }
      await sql`INSERT INTO binder_tracking_requests(binder_id,request_id,position,printing_id,collected,request_revision)
        VALUES(${id},${change.request_id},${change.position},${change.printing_id},${change.collected},${change.revision})`;
    }
    // Return CURRENT state on replay: an old response must never undo a later unmark.
    const [current] = await sql`SELECT b.revision,s.position,s.printing_id,s.is_collected FROM binders b
      JOIN binder_slots s ON s.binder_id=b.id WHERE b.id=${id} AND s.position=${change.position}`;
    const [counts] = await sql`SELECT count(*)::integer AS total,count(*) FILTER (WHERE is_collected)::integer AS collected
      FROM binder_slots WHERE binder_id=${id}`;
    return { binder_id: id, ...current, replayed, progress: { ...counts, missing: counts.total-counts.collected,
      percent: counts.total ? Math.round(counts.collected/counts.total*100) : 0 } };
  });
}
