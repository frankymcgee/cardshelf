import { writeFile } from 'node:fs/promises';
import { db,closeDatabase } from '../lib/db.mjs';
import { configuration } from '../lib/config.mjs';
import { randomToken } from '../lib/security.mjs';
import { fetchProvider,sleep } from '../lib/provider.mjs';
import { providerPrintings,safeImageUrl } from '../lib/variants.mjs';
import { ensure } from '../lib/errors.mjs';
import { storePricing,schedulePriceRefresh,pricingConfiguration } from '../lib/prices.mjs';
import { runPriceJob,refreshFx } from '../lib/price-worker.mjs';
import { runGameImport } from '../lib/game-catalogue.mjs';
import * as v from '../lib/validate.mjs';
const HEARTBEAT='/tmp/cardshelf-worker-heartbeat',sql=db();
let stopping=false;
process.on('SIGTERM',()=>{stopping=true;});process.on('SIGINT',()=>{stopping=true;});
async function heartbeat() {
  await writeFile(HEARTBEAT,String(Date.now()));
  await sql`INSERT INTO app_state(key,value) VALUES('worker_heartbeat','{}'::jsonb)
    ON CONFLICT(key) DO UPDATE SET updated_at=now()`;
}
async function claim() {
  return sql.begin(async tx=> {
    // A crashed worker's lease expires. Re-importing is idempotent and preserves
    // ownership and manually created printings. Failed imports are visible.
    await tx`UPDATE jobs SET status=CASE WHEN attempts<3 THEN 'queued' ELSE 'failed' END,
      lease_token=NULL,message='Previous worker stopped; lease recovered',
      finished_at=CASE WHEN attempts>=3 THEN now() ELSE NULL END
      WHERE status='running' AND heartbeat_at<now()-interval '5 minutes'`;
    const [job]=await tx`SELECT * FROM jobs WHERE status='queued' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1`;
    if(!job) return null;
    const lease=randomToken();
    const [running]=await tx`UPDATE jobs SET status='running',attempts=attempts+1,lease_token=${lease},heartbeat_at=now(),
      message='Loading set',errors='[]'::jsonb,progress=0 WHERE id=${job.id} RETURNING *`;
    return running;
  });
}
async function progress(job,done,total,message,errors=[]) {
  await heartbeat();
  const rows=await sql`UPDATE jobs SET progress=${done},total=${total},message=${message},errors=${sql.json(errors)},heartbeat_at=now()
    WHERE id=${job.id} AND lease_token=${job.lease_token} AND status='running' RETURNING id`;
  ensure(rows.length,409,'Import lease was lost.');
}
async function importCard(raw,lang,setId,requestedId) {
  ensure(raw?.id===requestedId && raw?.set?.id===setId,502,'Provider card identity does not match the requested set.');
  const id=`${lang}:${v.providerId(raw.id)}`;
  const name=v.text(raw.name,'Card name',1,200),localId=v.text(String(raw.localId),'Card number',1,50);
  const variants=providerPrintings(raw.variants);
  const dexIds=Array.isArray(raw.dexId)?raw.dexId.filter(n=>Number.isInteger(n)&&n>0&&n<=10000):[];
  await sql.begin(async tx=> {
    await tx`INSERT INTO cards(id,provider_id,set_id,language,local_id,name,illustrator,rarity,category,image_url,dex_ids,raw_data)
      VALUES(${id},${raw.id},${lang+':'+setId},${lang},${localId},${name},${String(raw.illustrator??'')},${String(raw.rarity??'')},
        ${String(raw.category??'')},${safeImageUrl(raw.image)},${dexIds},${tx.json(raw)})
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,illustrator=excluded.illustrator,rarity=excluded.rarity,
        category=excluded.category,image_url=excluded.image_url,dex_ids=excluded.dex_ids,raw_data=excluded.raw_data,updated_at=now()`;
    for(const p of variants) await tx`INSERT INTO printings(card_id,key,label,source,verified,metadata)
      VALUES(${id},${p.key},${p.label},'tcgdex',false,${tx.json(p.metadata)})
      ON CONFLICT(card_id,key) DO UPDATE SET metadata=excluded.metadata WHERE printings.source='tcgdex'`;
  });
  if(pricingConfiguration().enabled) await storePricing(id,raw.pricing);
}
async function run(job) {
  const lang=v.language(job.payload.language),setId=v.providerId(job.payload.set_id);
  const set=await fetchProvider(lang,'sets/'+setId);
  ensure(set?.id===setId && Array.isArray(set.cards),502,'Unexpected set response from the catalogue provider.');
  const name=v.text(set.name,'Set name',1,200);
  const release=/^\d{4}-\d{2}-\d{2}$/.test(set.releaseDate??'')?set.releaseDate:null;
  await sql`INSERT INTO card_sets(id,provider_id,language,name,series,release_date,card_count)
    VALUES(${lang+':'+setId},${setId},${lang},${name},${String(set.serie?.name??'')},${release},${Number(set.cardCount?.total)||set.cards.length})
    ON CONFLICT(id) DO UPDATE SET name=excluded.name,series=excluded.series,release_date=excluded.release_date,
      card_count=excluded.card_count,updated_at=now()`;
  const errors=[];let done=0;
  await progress(job,done,set.cards.length,'Importing '+name);
  for(const brief of set.cards) {
    if(stopping) {
      await sql`UPDATE jobs SET status='queued',lease_token=NULL,message='Paused for worker restart' WHERE id=${job.id} AND lease_token=${job.lease_token}`;
      return;
    }
    try {
      const id=v.providerId(brief.id),raw=await fetchProvider(lang,'cards/'+id);
      await importCard(raw,lang,setId,id);
    } catch(error) {
      errors.push({card_id:String(brief?.id??'unknown'),message:String(error.message).slice(0,300)});
    }
    done++;
    await progress(job,done,set.cards.length,`Processed ${done} of ${set.cards.length} cards`,errors);
    await sleep(configuration().requestInterval);
  }
  const status=errors.length?'failed':'completed';
  await sql`UPDATE jobs SET status=${status},message=${errors.length?`${errors.length} cards failed. Re-run this set to retry.`:'Import complete'},
    errors=${sql.json(errors)},lease_token=NULL,finished_at=now() WHERE id=${job.id} AND lease_token=${job.lease_token}`;
}
console.log('CardShelf catalogue worker started.');
try {
  let cleanups=0;
  while(!stopping) {
    try {
      await heartbeat();
      if(cleanups++%200===0) {
        if(pricingConfiguration().enabled) await refreshFx();
        await sql`DELETE FROM sessions WHERE expires_at<now()`;
        await sql`DELETE FROM auth_attempts WHERE reset_at<now()`;
      }
      await schedulePriceRefresh();
      const job=await claim();
      if(job) {
        // Keep leases and health current during provider backoff, not only between cards.
        const leaseTimer=setInterval(()=>{
          heartbeat().then(()=>sql`UPDATE jobs SET heartbeat_at=now() WHERE id=${job.id} AND lease_token=${job.lease_token} AND status='running'`)
            .catch(error=>console.error('Lease heartbeat:',error.message));
        },15000);
        leaseTimer.unref();
        try {if(job.kind==='refresh-prices') await runPriceJob(job,progress,()=>stopping);else if(job.kind==='import-game-set') await runGameImport(job,progress,()=>stopping);else await run(job);} catch(error) {
          console.error('Import failed:',error.message);
          await sql`UPDATE jobs SET status='failed',message=${String(error.message).slice(0,500)},lease_token=NULL,finished_at=now()
            WHERE id=${job.id} AND lease_token=${job.lease_token}`;
        } finally {clearInterval(leaseTimer);}
      } else await sleep(3000);
    } catch(error) {console.error('Worker loop:',error.message);await sleep(5000);}
  }
} finally {await closeDatabase();}
