import { db,audit } from './db.mjs';
import * as v from './validate.mjs';
import { ensure } from './errors.mjs';
export async function queueImport(userId,input) {
  const o=v.object(input),language=v.language(o.language),setId=v.providerId(o.set_id);
  const key=`tcgdex:${language}:${setId}`,sql=db();
  const active=await sql`SELECT id FROM jobs WHERE scope_key=${key} AND status IN ('queued','running')`;
  if(active.length) return {id:active[0].id,already_queued:true};
  ensure(Number((await sql`SELECT count(*) AS n FROM jobs WHERE status IN ('queued','running')`)[0].n)<20,429,'There are already 20 imports queued. Let them finish first.');
  try {
    return await sql.begin(async tx=> {
      const [job]=await tx`INSERT INTO jobs(user_id,kind,scope_key,payload) VALUES(${userId},'import-set',${key},${tx.json({language,set_id:setId})}) RETURNING *`;
      await audit(tx,userId,'catalogue.import_queued',{job_id:job.id,language,set_id:setId});return job;
    });
  } catch(error) {
    if(error.code==='23505') {
      const [job]=await sql`SELECT id FROM jobs WHERE scope_key=${key} AND status IN ('queued','running')`;return {id:job?.id,already_queued:true};
    } throw error;
  }
}
export async function listJobs() {
  return db()`SELECT id,kind,payload,status,progress,total,attempts,message,errors,created_at,finished_at FROM jobs ORDER BY created_at DESC LIMIT 30`;
}
export async function serverStatus() {
  const [state]=await db()`SELECT updated_at FROM app_state WHERE key='worker_heartbeat'`;
  const [counts]=await db()`SELECT (SELECT count(*)::integer FROM cards) AS cards,(SELECT count(*)::integer FROM card_sets) AS sets,
    (SELECT count(*)::integer FROM printings) AS printings`;
  return {version:'0.5.0',worker_last_seen:state?.updated_at??null,counts};
}
