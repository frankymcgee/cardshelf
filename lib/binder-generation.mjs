import { db, audit, collectionLock } from './db.mjs';
import { ensure } from './errors.mjs';
import * as v from './validate.mjs';
import { generationInput, generationHash, makeBinderPlan, previewResult } from './binder-generation-logic.mjs';
async function planFromDatabase(sql,userId,options) {
  const sets = await sql`SELECT s.*,count(c.id)::integer AS imported_count FROM card_sets s
    LEFT JOIN cards c ON c.set_id=s.id WHERE s.id IN ${sql(options.set_ids)} GROUP BY s.id`;
  const rows = await sql`SELECT p.id AS printing_id,p.key,p.label,p.source,c.id AS card_id,c.name,c.local_id,c.set_id,
    coalesce(o.quantity,0)::integer AS quantity FROM printings p JOIN cards c ON c.id=p.card_id
    LEFT JOIN (SELECT printing_id,sum(quantity) AS quantity FROM collection_entries WHERE user_id=${userId} GROUP BY printing_id) o ON o.printing_id=p.id
    WHERE c.set_id IN ${sql(options.set_ids)} ${options.owned_only ? sql`AND coalesce(o.quantity,0)>0` : sql``}
    ORDER BY c.id,p.id LIMIT 9601`;
  return makeBinderPlan(options,sets,rows);
}
export async function previewGeneration(userId,input) {
  const options = generationInput(input);
  return db().begin('isolation level repeatable read, read only',async sql=>previewResult(await planFromDatabase(sql,userId,options)));
}
export async function createGeneratedBinders(userId,input) {
  const o=v.object(input), options=generationInput(o), requestId=v.uuid(o.request_id,'Request ID');
  const inputHash=generationHash(options), token=v.text(o.preview_token,'Preview token',64,64);
  const acknowledgePartial=v.bool(o.acknowledge_partial??false,'Acknowledge partial catalogue');
  return db().begin(async sql=> {
    // Serialize per-user generation and ownership writes. A lost HTTP response may
    // be retried with the same request ID without creating duplicate binders.
    await collectionLock(sql,userId);
    const [previous]=await sql`SELECT * FROM binder_generation_requests WHERE user_id=${userId} AND request_id=${requestId}`;
    if(previous) {
      ensure(previous.input_hash===inputHash,409,'This request ID was already used for a different layout.');
      const binders=await sql`SELECT id,title,page_count,binder_type FROM binders WHERE user_id=${userId} AND id IN ${sql(previous.binder_ids)} ORDER BY created_at,title`;
      ensure(binders.length===previous.binder_ids.length,409,'A binder from this request was deleted. Preview again to create a new layout.');
      return {binders,replayed:true};
    }
    const plan=await planFromDatabase(sql,userId,options);
    ensure(plan.token===token,409,'The catalogue or collection changed after preview. Preview the layout again.');
    ensure(!plan.partial||acknowledgePartial,400,'Some sets are only partially imported. Acknowledge this in the preview or complete the imports first.');
    const created=[];
    for(const volume of plan.volumes) {
      const [binder]=await sql`INSERT INTO binders(user_id,title,description,color,columns,rows,page_count,generation,binder_type)
        VALUES(${userId},${volume.title},${options.description},${options.color},${options.columns},${options.rows},${volume.page_count},${sql.json({options,sets:plan.summary})},${options.binder_type}) RETURNING id,title,page_count,binder_type`;
      await sql`INSERT INTO binder_slots ${sql(volume.slots.map(s=>({binder_id:binder.id,position:s.position,printing_id:s.printing_id})),'binder_id','position','printing_id')}`;
      created.push(binder);
    }
    await sql`INSERT INTO binder_generation_requests(user_id,request_id,input_hash,binder_ids) VALUES(${userId},${requestId},${inputHash},${created.map(b=>b.id)})`;
    await audit(sql,userId,'binder.generated',{binder_ids:created.map(b=>b.id),slots:plan.slot_count,set_ids:options.set_ids});
    return {binders:created,replayed:false};
  });
}
