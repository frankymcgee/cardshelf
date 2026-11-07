import { createHash } from 'node:crypto';
import { ensure } from './errors.mjs';
import * as v from './validate.mjs';
export const exclusiveHash = value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const compare=new Intl.Collator('en',{numeric:true,sensitivity:'base'}).compare;
const rank=key=>({normal:0,holo:1,reverse:2,unspecified:3}[key]??4);
export function exclusiveInput(input,apply=false) {
  const o=v.object(input),fields=['action','set_ids',...(apply?['revision','request_id','preview_token']:[])];
  ensure(Object.keys(o).every(k=>fields.includes(k)),400,'Unsupported product-exclusive field.');
  ensure(Array.isArray(o.set_ids)&&o.set_ids.length>0&&o.set_ids.length<=50,400,'Choose between 1 and 50 imported sets.');
  const result={action:v.oneOf(o.action,'Action',['add','remove']),set_ids:[...new Set(o.set_ids.map(v.cardId))].sort()};
  if(!apply)return result;
  const preview_token=v.text(o.preview_token,'Preview token',64,64);
  ensure(/^[a-f0-9]{64}$/.test(preview_token),400,'Preview token is invalid.');
  return {...result,revision:v.integer(o.revision,'Revision',1,Number.MAX_SAFE_INTEGER),request_id:v.uuid(o.request_id,'Request ID'),preview_token};
}
export function exclusivePlan(binder,existing,candidates,input) {
  const selected=new Set(input.set_ids),old=[...existing].sort((a,b)=>a.position-b.position);
  const removed=input.action==='remove'?old.filter(s=>selected.has(s.set_id)&&s.distribution==='product_exclusive'):[];
  const removedPositions=new Set(removed.map(s=>s.position));
  const kept=old.filter(s=>!removedPositions.has(s.position)),present=new Set(old.map(s=>s.printing_id));
  const added=input.action==='add'?candidates.filter(s=>selected.has(s.set_id)&&s.distribution==='product_exclusive'&&s.catalogue_available!==false&&!present.has(s.printing_id)) : [];
  const uniqueAdded=[...new Map(added.map(s=>[s.printing_id,s])).values()].map(s=>({...s,position:null,is_collected:false}));
  const groups=[...new Set([...old.map(s=>s.set_id),...input.set_ids])],setRank=new Map(groups.map((id,i)=>[id,i]));
  const slots=[...kept,...uniqueAdded].sort((a,b)=>setRank.get(a.set_id)-setRank.get(b.set_id)||compare(a.local_id,b.local_id)||
    a.card_id.localeCompare(b.card_id)||rank(a.key)-rank(b.key)||a.printing_id.localeCompare(b.printing_id)||(a.position??0)-(b.position??0))
    .map((s,position)=>({...s,previous_position:s.position,position}));
  const page_count=Math.max(binder.page_count,Math.ceil(slots.length/(binder.columns*binder.rows)));
  ensure(page_count<=60,400,'These cards would exceed 60 pages. Choose fewer sets or use another binder.');
  const moved=slots.filter(s=>s.previous_position!==null&&s.previous_position!==s.position).length;
  const token=exclusiveHash({binder:[binder.id,binder.revision,binder.columns,binder.rows,binder.page_count],input,old,candidates,slots});
  return {slots,removed,added:uniqueAdded,page_count,token,moved};
}
export function exclusivePreview(binder,plan,input) {
  return {revision:binder.revision,preview_token:plan.token,...input,added:plan.added.length,removed:plan.removed.length,moved:plan.moved,
    slot_count:plan.slots.length,page_count:plan.page_count,printing_scope:binder.printing_scope,
    sample:plan.slots.slice(0,24).map(s=>({position:s.position,previous_position:s.previous_position,name:s.name,local_id:s.local_id,label:s.label,set_name:s.set_name})),
    removed_sample:plan.removed.slice(0,24).map(s=>({position:s.position,name:s.name,local_id:s.local_id,label:s.label,set_name:s.set_name}))};
}
