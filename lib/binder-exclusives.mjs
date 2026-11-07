import { db,collectionLock,audit } from './db.mjs';
import { ensure } from './errors.mjs';
import * as v from './validate.mjs';
import { membershipState } from './membership.mjs';
import { requireGame } from './game-access.mjs';
import { exclusiveInput,exclusivePlan,exclusivePreview,exclusiveHash } from './binder-exclusives-logic.mjs';
async function access(sql,userId,id,lock=false) {
  const [binder]=await sql`SELECT * FROM binders WHERE id=${id} AND user_id=${userId} ${lock?sql`FOR UPDATE`:sql``}`;
  ensure(binder,404,'Binder not found.');
  const {access}=await membershipState(userId,sql);
  ensure(access.features.some(f=>f.code===(binder.binder_type==='tracking'?'tracking_binders':'binders')),403,'This action needs binder access. Open Membership to review your access.');
  await requireGame(sql,userId,binder.game);
  return binder;
}
async function plan(sql,binder,input) {
  ensure(!(input.action==='add' && binder.binder_type==='tracking' && binder.generation?.options?.selection==='designs'),400,
    'This checklist tracks card designs, not individual finishes. Use a printing checklist or a Collection binder to add product-exclusive printings.');
  const sets=await sql`SELECT id FROM card_sets WHERE id IN ${sql(input.set_ids)} AND game=${binder.game}`;
  ensure(sets.length===input.set_ids.length,400,'Choose imported sets from this binder’s game.');
  const existing=await sql`SELECT s.position,s.printing_id,s.is_collected,p.key,p.label,p.distribution,p.distribution_revision,
    c.id AS card_id,c.local_id,c.name,c.set_id,cs.name AS set_name FROM binder_slots s JOIN printings p ON p.id=s.printing_id
    JOIN cards c ON c.id=p.card_id JOIN card_sets cs ON cs.id=c.set_id WHERE s.binder_id=${binder.id} ORDER BY s.position`;
  const candidates=input.action==='add'?await sql`SELECT p.id AS printing_id,p.key,p.label,p.distribution,p.distribution_revision,
    c.id AS card_id,c.local_id,c.name,c.set_id,cs.name AS set_name FROM printings p JOIN cards c ON c.id=p.card_id JOIN card_sets cs ON cs.id=c.set_id
    WHERE c.set_id IN ${sql(input.set_ids)} AND c.game=${binder.game} AND p.catalogue_available AND p.distribution='product_exclusive' ORDER BY c.id,p.id LIMIT 961`:[];
  ensure(candidates.length<=960,400,'Too many product exclusives. Choose fewer sets.');
  return exclusivePlan(binder,existing,candidates,input);
}
export async function previewBinderExclusives(userId,idInput,body) {
  const id=v.uuid(idInput),input=exclusiveInput(body);
  return db().begin('isolation level repeatable read, read only',async sql=>{
    const binder=await access(sql,userId,id),p=await plan(sql,binder,input);
    return exclusivePreview(binder,p,input);
  });
}
export async function applyBinderExclusives(userId,idInput,body) {
  const id=v.uuid(idInput),change=exclusiveInput(body,true),input={action:change.action,set_ids:change.set_ids};
  return db().begin(async sql=>{
    await collectionLock(sql,userId);
    const binder=await access(sql,userId,id,true),hash=exclusiveHash({id,...change});
    const [previous]=await sql`SELECT * FROM binder_exclusive_requests WHERE user_id=${userId} AND request_id=${change.request_id}`;
    if(previous){ensure(previous.binder_id===id&&previous.input_hash===hash,409,'This request ID belongs to another change. Preview again.');return {...previous.result,revision:binder.revision,replayed:true};}
    ensure(binder.revision===change.revision,409,'The binder changed. Preview again before applying.');
    const p=await plan(sql,binder,input);
    ensure(p.token===change.preview_token,409,'The catalogue or layout changed. Preview again before applying.');
    await sql`DELETE FROM binder_slots WHERE binder_id=${id}`;
    if(p.slots.length)await sql`INSERT INTO binder_slots ${sql(p.slots.map(s=>({binder_id:id,position:s.position,printing_id:s.printing_id,is_collected:s.is_collected===true})),'binder_id','position','printing_id','is_collected')}`;
    const [updated]=await sql`UPDATE binders SET page_count=${p.page_count},exclusive_set_ids=${input.set_ids},revision=revision+1,updated_at=now() WHERE id=${id} RETURNING revision`;
    const result={binder_id:id,revision:updated.revision,added:p.added.length,removed:p.removed.length,moved:p.moved,page_count:p.page_count};
    await sql`INSERT INTO binder_exclusive_requests(user_id,request_id,binder_id,input_hash,result) VALUES(${userId},${change.request_id},${id},${hash},${sql.json(result)})`;
    await audit(sql,userId,'binder.product_exclusives',{...result,...input});
    return {...result,replayed:false};
  });
}
