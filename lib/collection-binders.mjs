import { requireGame } from './game-access.mjs';
import { db, collectionLock, audit } from './db.mjs';
import { ensure } from './errors.mjs';
import * as v from './validate.mjs';
import { membershipState } from './membership.mjs';
import { collectionSyncAllowed } from '../shared/collection-sync.mjs';
import { conversionInput, quickOwnershipInput, conversionToken, conversionPrintings,
  ownershipState, ownershipAction, stateHash } from './collection-binder-logic.mjs';
import { printingOwnership, collectionSlotStates } from './collection-binder-state.mjs';

async function requireCollectionSync(sql, userId) {
  const {access} = await membershipState(userId, sql);
  ensure(collectionSyncAllowed(access), 403, 'Collection sync needs a membership with collection, binder and pricing features. Existing testers and Complimentary access remain supported.');
}
async function binderForUpdate(sql, userId, id) {
  const [binder] = await sql`SELECT * FROM binders WHERE id=${id} AND user_id=${userId} FOR UPDATE`;
  ensure(binder, 404, 'Binder not found.');
  await requireGame(sql,userId,binder.game);
  return binder;
}
async function slotsForConversion(sql, id) {
  return sql`SELECT s.position,s.printing_id,s.is_collected,p.label,c.name,c.local_id
    FROM binder_slots s JOIN printings p ON p.id=s.printing_id JOIN cards c ON c.id=p.card_id
    WHERE s.binder_id=${id} ORDER BY s.position`;
}
async function previousRequest(sql, userId, binderId, action, input) {
  const inputHash = stateHash({binderId, action, input});
  const [previous] = await sql`SELECT * FROM binder_collection_requests WHERE user_id=${userId} AND request_id=${input.request_id}`;
  if (previous) ensure(previous.binder_id===binderId && previous.action===action && previous.input_hash===inputHash, 409,
    'This request ID belongs to a different operation. Reload before continuing.');
  return {previous, inputHash};
}
async function recordRequest(sql, userId, binderId, action, input, inputHash, result) {
  await sql`INSERT INTO binder_collection_requests(user_id,request_id,binder_id,action,input_hash,result)
    VALUES(${userId},${input.request_id},${binderId},${action},${inputHash},${sql.json(result)})`;
}
async function ensureOneOwned(sql, userId, printingId) {
  // Every caller holds the same per-user collection lock as saveEntry/importEntries.
  const [existing] = await sql`SELECT 1 AS owned FROM collection_entries
    WHERE user_id=${userId} AND printing_id=${printingId} AND quantity>0 LIMIT 1`;
  if (existing) return false;
  const [entry] = await sql`INSERT INTO collection_entries(user_id,printing_id,condition,quantity)
    VALUES(${userId},${printingId},'UNKNOWN',1)
    ON CONFLICT(user_id,printing_id,condition) DO UPDATE SET quantity=1,
      revision=collection_entries.revision+1,updated_at=now() RETURNING revision`;
  await sql`INSERT INTO collection_quick_adds(user_id,printing_id,entry_revision)
    VALUES(${userId},${printingId},${entry.revision}) ON CONFLICT(user_id,printing_id)
    DO UPDATE SET entry_revision=excluded.entry_revision,created_at=now()`;
  return true;
}
export async function previewCollectionConversion(userId, idInput) {
  const id = v.uuid(idInput);
  return db().begin('isolation level repeatable read, read only', async sql => {
    await requireCollectionSync(sql, userId);
    const [binder] = await sql`SELECT * FROM binders WHERE id=${id} AND user_id=${userId}`;
    ensure(binder, 404, 'Binder not found.');
    ensure(binder.binder_type==='tracking', 409, 'This is already a Collection binder. Use its Quick tracking view.');
    const slots = await slotsForConversion(sql, id);
    const {entries} = await printingOwnership(sql, userId, slots.map(slot=>slot.printing_id));
    const marked = [...new Map(slots.filter(slot=>slot.is_collected).map(slot=>[slot.printing_id,slot])).values()]
      .map(slot=>({...slot,owned_quantity:entries.filter(row=>row.printing_id===slot.printing_id).reduce((n,row)=>n+row.quantity,0)}));
    return {binder_id:id,revision:binder.revision,preview_token:conversionToken(binder,slots,entries),
      design_checklist:binder.generation?.options?.selection==='designs',sharing_will_be_revoked:!!binder.share_token,
      marked,already_owned:marked.filter(slot=>slot.owned_quantity>0).length,
      would_add:marked.filter(slot=>slot.owned_quantity===0).length};
  });
}
export async function convertTrackingBinder(userId, idInput, input) {
  const id = v.uuid(idInput), change = conversionInput(input);
  return db().begin(async sql => {
    await collectionLock(sql, userId); // Always collection -> binder, never the reverse.
    await requireCollectionSync(sql, userId);
    const binder = await binderForUpdate(sql, userId, id);
    const {previous,inputHash} = await previousRequest(sql,userId,id,'convert',change);
    if (previous) return {...previous.result,binder_id:id,revision:binder.revision,replayed:true};
    ensure(binder.binder_type==='tracking',409,'This binder has already been converted. Reload it.');
    ensure(binder.revision===change.revision,409,'This checklist changed. Review a new conversion preview.');
    const slots = await slotsForConversion(sql,id), {entries} = await printingOwnership(sql,userId,slots.map(slot=>slot.printing_id));
    ensure(change.preview_token===conversionToken(binder,slots,entries),409,'The checklist or ownership changed since the preview. Review it again.');
    const printingIds = conversionPrintings(binder,slots,change);
    let added=0;
    for (const printingId of printingIds) if (await ensureOneOwned(sql,userId,printingId)) added++;
    // Convert IN PLACE: preserve layout/IDs, do not create a second binder or
    // let an old public tracking link start disclosing live inventory state.
    const [updated] = await sql`UPDATE binders SET binder_type='collection',quick_tracking=true,
      share_token=NULL,revision=revision+1,updated_at=now() WHERE id=${id} RETURNING revision`;
    await sql`UPDATE binder_slots SET is_collected=false WHERE binder_id=${id} AND is_collected`;
    const result={binder_id:id,converted:true,added,already_owned:printingIds.length-added,revision:updated.revision,
      sharing_revoked:!!binder.share_token,replayed:false};
    await recordRequest(sql,userId,id,'convert',change,inputHash,result);
    await audit(sql,userId,'binder.collection_conversion',{binder_id:id,added,imported_marks:change.import_marks,sharing_revoked:result.sharing_revoked});
    return result;
  });
}
export async function quickBinderOwnership(userId, idInput, input) {
  const id = v.uuid(idInput), change = quickOwnershipInput(input);
  return db().begin(async sql => {
    await collectionLock(sql,userId);
    await requireCollectionSync(sql,userId);
    const binder = await binderForUpdate(sql,userId,id);
    ensure(binder.binder_type==='collection',400,'Enable collection sync before using quick ownership.');
    const [slot] = await sql`SELECT position,printing_id FROM binder_slots WHERE binder_id=${id} AND position=${change.position}`;
    ensure(change.position<binder.columns*binder.rows*binder.page_count && slot?.printing_id===change.printing_id,409,'The pocket changed. Reload the binder.');
    const {previous,inputHash} = await previousRequest(sql,userId,id,'ownership',change);
    let changed=false;
    if (!previous) {
      ensure(binder.revision===change.revision,409,'This binder changed. Reload before marking the card.');
      const {entries,proofs} = await printingOwnership(sql,userId,[slot.printing_id]);
      const action = ownershipAction(ownershipState(entries,proofs[0]),change);
      if (action==='add') changed=await ensureOneOwned(sql,userId,slot.printing_id);
      if (action==='remove') {
        const [removed] = await sql`UPDATE collection_entries SET quantity=0,revision=revision+1,updated_at=now()
          WHERE user_id=${userId} AND printing_id=${slot.printing_id} AND condition='UNKNOWN'
            AND quantity=1 AND revision=${proofs[0].entry_revision} RETURNING revision`;
        ensure(removed,409,'The quick-added copy changed. Reload before removing it.');
        await sql`DELETE FROM collection_quick_adds WHERE user_id=${userId} AND printing_id=${slot.printing_id}`;
        changed=true;
      }
      if (changed) await sql`UPDATE binders SET revision=revision+1,updated_at=now() WHERE id=${id}`;
      await recordRequest(sql,userId,id,'ownership',change,inputHash,{changed});
      if (changed) await audit(sql,userId,'binder.quick_ownership',{binder_id:id,printing_id:slot.printing_id,collected:change.collected});
    }
    // A retry returns the CURRENT ownership, not a historical collected flag.
    const [current] = await sql`SELECT revision FROM binders WHERE id=${id}`;
    const [state] = await collectionSlotStates(sql,userId,[slot]);
    return {binder_id:id,...state,revision:current.revision,replayed:!!previous,changed};
  });
}
