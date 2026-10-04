import { collectionSlotStates } from './collection-binder-state.mjs';
import { binderType } from './tracking-logic.mjs';
import { trackingProgress, TRACKING_COLOUR } from '../shared/binder-types.mjs';
import { requireGame } from './game-access.mjs';
import { GAME_CODES } from '../shared/games.mjs';
import { db, audit, collectionLock } from './db.mjs';
import { ensure } from './errors.mjs';
import * as v from './validate.mjs';
import { randomToken } from './security.mjs';
import { validateSlotOperation, applySlotOperation, assertSafeResize } from './binder-logic.mjs';
import { resolvedAppearance } from '../shared/appearance.mjs';
export async function listBinders(userId) {
  return db()`SELECT b.*,count(s.position)::integer AS filled,count(s.position) FILTER (WHERE s.is_collected)::integer AS collected FROM binders b LEFT JOIN binder_slots s ON s.binder_id=b.id
    WHERE b.user_id=${userId} GROUP BY b.id ORDER BY b.updated_at DESC`;
}
export async function createBinder(userId,input) {
  const type=binderType(v.object(input).binder_type),b=v.binderInput(input);
  if(type==='tracking') b.color=TRACKING_COLOUR;
  const game=v.oneOf(input.game??'pokemon','Card game',GAME_CODES);
  return db().begin(async sql=>{
    await collectionLock(sql,userId);await requireGame(sql,userId,game);
    const [row]=await sql`INSERT INTO binders(user_id,title,description,color,columns,rows,page_count,binder_type,game)
      VALUES(${userId},${b.title},${b.description},${b.color},${b.columns},${b.rows},${b.page_count},${type},${game}) RETURNING *`;
    return row;
  });
}
async function binderSlots(sql,binder,userId,shared=false) {
  // Public shares expose only the planned layout, never notes, quantity, cost or user details.
  return sql`SELECT s.position,p.id AS printing_id,p.label,p.key,p.source,p.verified,c.id AS card_id,c.name,c.local_id,c.image_url,
    c.language,c.game,c.rarity,cs.name AS set_name
    ${binder.binder_type==='tracking' ? sql`,s.is_collected` : sql``}
    ${!shared && binder.binder_type!=='tracking' ? sql`,EXISTS(SELECT 1 FROM collection_entries e WHERE e.user_id=${userId} AND e.printing_id=p.id AND e.quantity>0) AS owned` : sql``}
    FROM binder_slots s JOIN printings p ON s.printing_id=p.id JOIN cards c ON p.card_id=c.id JOIN card_sets cs ON c.set_id=cs.id
    WHERE s.binder_id=${binder.id} ORDER BY s.position`;
}
export async function getBinder(userId,idInput) {
  const id=v.uuid(idInput),sql=db();
  return sql.begin('isolation level repeatable read, read only',async tx=> {
    const [binder]=await tx`SELECT * FROM binders WHERE id=${id} AND user_id=${userId}`;
    ensure(binder,404,'Binder not found.');
    let slots=await binderSlots(tx,binder,userId);
    if(binder.binder_type==='collection') slots=await collectionSlotStates(tx,userId,slots);
    return {...binder,slots,...(binder.binder_type==='tracking'?{progress:trackingProgress(slots)}:{})};
  });
}
export async function getSharedBinder(token) {
  ensure(typeof token==='string' && /^[a-f0-9]{64}$/.test(token),404,'Shared binder not found.');
  const sql=db();
  const [binder]=await sql`SELECT id,title,description,color,columns,rows,page_count,appearance,wallpaper_version,cover_wallpaper_version,binder_type,generation,game FROM binders WHERE share_token=${token}`;
  ensure(binder,404,'This sharing link is unavailable or has been disabled.');
  const slots=await binderSlots(sql,binder,null,true);
  const {generation,...publicBinder}=binder;
  return {...publicBinder,slots,...(binder.binder_type==='tracking'?{progress:trackingProgress(slots),tracking_selection:generation?.options?.selection??'printings'}:{})};
}
async function lockedBinder(sql,userId,idInput,revision,enforceGame=true) {
  await collectionLock(sql,userId);
  const id=v.uuid(idInput);
  v.integer(revision,'Revision',1,Number.MAX_SAFE_INTEGER);
  const [binder]=await sql`SELECT * FROM binders WHERE id=${id} AND user_id=${userId} FOR UPDATE`;
  ensure(binder,404,'Binder not found.');
  if(enforceGame) await requireGame(sql,userId,binder.game);
  ensure(binder.revision===revision,409,'This binder changed in another session. Reload it before editing.');
  return binder;
}
export async function updateBinder(userId,id,input) {
  const o=v.object(input),next=v.binderInput(o);
  return db().begin(async sql=> {
    const binder=await lockedBinder(sql,userId,id,o.revision);
    ensure(o.binder_type===undefined || o.binder_type===binder.binder_type,400,'Binder type cannot be changed. Create a separate binder instead.');
    if(binder.binder_type==='tracking') ensure(next.color===binder.color && next.columns===binder.columns && next.rows===binder.rows && next.page_count===binder.page_count,400,'Tracking layouts stay fixed. Use a Collection binder for layout customisation.');
    const positions=(await sql`SELECT position FROM binder_slots WHERE binder_id=${binder.id}`).map(r=>r.position);
    assertSafeResize(next,positions);
    const appearance=next.color!==binder.color?resolvedAppearance(binder.appearance,binder.color):binder.appearance;
    const [row]=await sql`UPDATE binders SET title=${next.title},description=${next.description},color=${next.color},appearance=${sql.json(appearance)},
      columns=${next.columns},rows=${next.rows},page_count=${next.page_count},revision=revision+1,updated_at=now()
      WHERE id=${binder.id} RETURNING *`;return row;
  });
}
export async function editSlots(userId,id,input) {
  const o=v.object(input);
  return db().begin(async sql=> {
    const binder=await lockedBinder(sql,userId,id,o.revision),op=validateSlotOperation(binder,o);
    if(binder.binder_type==='tracking') {
      ensure(op.action==='place',400,'Tracking binders keep fixed checklist positions.');
      ensure(!(await sql`SELECT position FROM binder_slots WHERE binder_id=${binder.id} AND position=${op.target}`).length,409,'This pocket already has a checklist card.');
      ensure(!(await sql`SELECT position FROM binder_slots WHERE binder_id=${binder.id} AND printing_id=${op.printing_id}`).length,409,'This printing is already in the checklist.');
    }
    if(op.printing_id) ensure((await sql`SELECT p.id FROM printings p JOIN cards c ON c.id=p.card_id WHERE p.id=${op.printing_id} AND c.game=${binder.game}`).length,400,'Choose a printing from this binder’s game.');
    const positions=op.action==='swap' ? [...new Set([op.source,op.target])] : [op.target];
    const old=await sql`SELECT position,printing_id FROM binder_slots WHERE binder_id=${binder.id} AND position IN ${sql(positions)}`;
    const changed=applySlotOperation(old,op);
    await sql`DELETE FROM binder_slots WHERE binder_id=${binder.id} AND position IN ${sql(positions)}`;
    if(changed.length) await sql`INSERT INTO binder_slots ${sql(changed.map(slot=>({...slot,binder_id:binder.id})), 'binder_id','position','printing_id')}`;
    const [updated]=await sql`UPDATE binders SET revision=revision+1,updated_at=now() WHERE id=${binder.id} RETURNING revision`;
    return updated;
  });
}
export async function shareBinder(userId,id,input) {
  const o=v.object(input),enabled=v.bool(o.enabled,'Sharing enabled');
  return db().begin(async sql=> {
    const binder=await lockedBinder(sql,userId,id,o.revision,enabled);
    // Enabling again rotates the link; disabling revokes it immediately.
    const token=enabled?randomToken():null;
    const [row]=await sql`UPDATE binders SET share_token=${token},revision=revision+1,updated_at=now() WHERE id=${binder.id} RETURNING share_token,revision`;
    await audit(sql,userId,enabled?'binder.share_enabled':'binder.share_disabled',{binder_id:binder.id});return row;
  });
}
export async function deleteBinder(userId,id,input) {
  const o=v.object(input);
  return db().begin(async sql=> {
    const binder=await lockedBinder(sql,userId,id,o.revision,false);
    ensure(o.confirm_title===binder.title,400,'Type the exact binder name to confirm deletion.');
    await sql`DELETE FROM binders WHERE id=${binder.id}`;
    await audit(sql,userId,'binder.delete',{binder_id:binder.id});return {deleted:true};
  });
}
