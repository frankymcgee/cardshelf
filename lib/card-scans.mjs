import { db,collectionLock,audit } from './db.mjs';
import { ensure } from './errors.mjs';
import * as v from './validate.mjs';
import { membershipState } from './membership.mjs';
import { requireGame } from './game-access.mjs';
import { SCAN_CONFIG_KEYS,SCAN_ERRORS } from '../shared/card-scanning.mjs';
import { automaticScanPocket,scanBinderPockets } from '../shared/scan-binders.mjs';
import { SCAN_SETTINGS_LOCK,scanUpload,scanReservation,scanCost,scanHash,scanConfirmation,scanNumber,rankScanCandidates } from './card-scan-logic.mjs';
import { scanningSettings,decryptScanSecret,scanMonth,scanTotals } from './card-scan-settings.mjs';
import { prepareScanImage } from './card-scan-image.mjs';
import { recogniseCard,ScanProviderError } from './card-scan-provider.mjs';
async function requireScanAccess(sql,userId){
  const {access}=await membershipState(userId,sql);
  ensure(access.features.some(f=>f.code==='collection'),403,'Card scanning needs collection access. Review your membership.');
  await requireGame(sql,userId,'pokemon');
  return access;
}
async function candidateCards(sql,ids){
  if(!ids.length)return [];
  return sql`SELECT c.id,c.name,c.local_id,c.language,c.game,c.image_url,c.set_id,s.name AS set_name,s.provider_id AS set_provider_id
    FROM cards c JOIN card_sets s ON s.id=c.set_id WHERE c.id IN ${sql(ids)} AND c.game='pokemon'`;
}
async function findScanMatches(sql,observation){
  if(!observation.readable||observation.card_count!==1)return [];
  const number=scanNumber(observation.collector_number),name=observation.card_name||'';
  if(!number&&!name)return [];
  // Match local imported records only. Provider observations never become database IDs.
  const cards=await sql`SELECT c.id,c.name,c.local_id,c.language,c.game,c.image_url,c.set_id,s.name AS set_name,s.provider_id AS set_provider_id
    FROM cards c JOIN card_sets s ON s.id=c.set_id WHERE c.game='pokemon' AND c.language IN ('en','ja')
    ${observation.language!=='unknown'?sql`AND c.language=${observation.language}`:sql``}
    AND (${number!==''} AND regexp_replace(lower(c.local_id),'^0+(?=[0-9])','')=${number} OR ${name!==''} AND lower(c.name)=lower(${name}))
    ORDER BY (lower(c.name)=lower(${name})) DESC,c.id LIMIT 500`;
  return rankScanCandidates(observation,cards);
}
function scanPublic(row,candidates=[]){
  return {id:row.id,status:row.status,created_at:row.created_at,observations:row.observations,candidates,
    error:SCAN_ERRORS[row.error_code]||'',addition:row.addition,added_at:row.added_at,undone_at:row.undone_at};
}
export async function getCardScan(userId,idInput,sql=db()){
  const id=v.uuid(idInput,'Scan');
  await sql`UPDATE card_scans SET status='failed',error_code='interrupted',finished_at=now()
    WHERE id=${id} AND user_id=${userId} AND status='processing' AND created_at+(request_timeout_seconds+75)*interval '1 second'<now()`;
  const [scan]=await sql`SELECT * FROM card_scans WHERE id=${id} AND user_id=${userId}`;
  ensure(scan,404,'Scan not found.');
  const candidates=scan.observations?rankScanCandidates(scan.observations,await candidateCards(sql,scan.candidate_ids)):[];
  return scanPublic(scan,candidates);
}
export async function scanAvailability(userId){
  const sql=db(),settings=await scanningSettings(sql),month=await scanMonth(sql);
  const {access}=await membershipState(userId,sql);
  let eligible=access.features.some(f=>f.code==='collection');
  try{if(eligible)await requireGame(sql,userId,'pokemon');}catch{eligible=false;}
  const [count]=await sql`SELECT count(*)::integer AS used FROM card_scans WHERE user_id=${userId} AND budget_month=${month}`;
  const totals=await scanTotals(sql,month);
  const recent=await sql`SELECT id,status,created_at,addition FROM card_scans WHERE user_id=${userId} ORDER BY created_at DESC LIMIT 12`;
  const remaining=Math.max(0,settings.user_monthly_limit-count.used),budgetAvailable=totals.accounted_micros+settings.reservation_micros<=settings.monthly_budget_micros;
  const binderTypes=['collection','tracking'].filter(type=>access.features.some(f=>f.code===(type==='tracking'?'tracking_binders':'binders')));
  return {enabled:settings.enabled&&settings.configured,eligible,remaining,monthly_limit:settings.user_monthly_limit,month,binder_types:binderTypes,
    available:settings.enabled&&settings.configured&&eligible&&remaining>0&&budgetAvailable,
    message:!eligible?'Scanning needs collection access for Pokémon.':!settings.enabled||!settings.configured?'Photo scanning has not been enabled by an administrator.':!remaining?'You have used your scan allowance for this month.':!budgetAvailable?'The shared scanning budget is currently exhausted.':'',recent};
}
export async function analyseCardScan(userId,input,{recognise=recogniseCard,prepare=prepareScanImage}={}){
  const upload=scanUpload(input),started=Date.now();
  const reservation=await db().begin(async sql=>{
    await sql`SELECT pg_advisory_xact_lock(${SCAN_SETTINGS_LOCK})`;
    await collectionLock(sql,userId);await requireScanAccess(sql,userId);
    // A process crash must not permanently occupy the single analysis slot.
    // Keep its reservation: the upstream call may have been charged.
    await sql`UPDATE card_scans SET status='failed',error_code='interrupted',finished_at=now()
      WHERE status='processing' AND created_at+(request_timeout_seconds+75)*interval '1 second'<now()`;
    const [prior]=await sql`SELECT id,user_id,image_hash FROM card_scans WHERE id=${upload.id}`;
    if(prior){ensure(prior.user_id===userId&&prior.image_hash===upload.hash,409,'This request ID belongs to a different scan.');return {replay:true};}
    const [settings]=await sql`SELECT * FROM card_scan_settings WHERE singleton`;
    ensure(settings?.enabled&&settings.api_secret,503,'Photo scanning is disabled.');
    const secret=decryptScanSecret(settings.api_secret),month=await scanMonth(sql),reserved=scanReservation(settings);
    const [usage]=await sql`SELECT count(*) FILTER(WHERE user_id=${userId})::integer AS personal,
      coalesce(sum(accounted_micros),0)::text AS spent FROM card_scans WHERE budget_month=${month}`;
    ensure(usage.personal<settings.user_monthly_limit,429,'You have used your scan allowance for this month.');
    ensure(Number(usage.spent)+reserved<=Number(settings.monthly_budget_micros),429,'The shared scanning budget is currently exhausted.');
    ensure(!(await sql`SELECT id FROM card_scans WHERE status='processing' LIMIT 1`).length,429,'Another photo is being analysed. Try again shortly.');
    const config=Object.fromEntries(SCAN_CONFIG_KEYS.map(k=>[k,settings[k]]));
    await sql`INSERT INTO card_scans(id,user_id,image_hash,model,status,budget_month,accounted_micros,input_price_micros,output_price_micros,
      settings_revision,reasoning_effort,reasoning_mode,max_output_tokens,input_token_ceiling,image_detail,request_timeout_seconds,prompt_hash)
      VALUES(${upload.id},${userId},${upload.hash},${config.model},'processing',${month},${reserved},${settings.input_price_micros},${settings.output_price_micros},
      ${settings.revision},${config.reasoning_effort},${config.reasoning_mode},${config.max_output_tokens},${config.input_token_ceiling},
      ${config.image_detail},${config.request_timeout_seconds},${scanHash(config.prompt)})`;
    return {secret,config,rates:settings};
  });
  if(reservation.replay)return getCardScan(userId,upload.id);
  let sent=false;
  try{
    const image=await prepare(upload.bytes);sent=true;
    const result=await recognise({image,secret:reservation.secret,config:reservation.config});
    const cost=scanCost(result.input_tokens,result.output_tokens,reservation.rates);
    await db().begin(async sql=>{
      await sql`SELECT pg_advisory_xact_lock(${SCAN_SETTINGS_LOCK})`;
      const [scan]=await sql`SELECT status,user_id FROM card_scans WHERE id=${upload.id} FOR UPDATE`;
      ensure(scan,404,'Scan not found.');
      // A response arriving after account deletion may settle costs, but must not
      // restore the private observations removed by the deletion trigger.
      const observation=scan.user_id?result.observation:null;
      const candidates=observation?await findScanMatches(sql,observation):[];
      await sql`UPDATE card_scans SET accounted_micros=${cost},settled=true,input_tokens=${result.input_tokens},output_tokens=${result.output_tokens},
        resolved_model=${result.resolved_model??null},
        duration_ms=${Math.min(2147483647,Date.now()-started)},status=${result.observation?'ready':'failed'},
        observations=${observation?sql.json(observation):null},candidate_ids=${candidates.map(c=>c.id)},
        error_code=${result.observation?'':result.error_code||'provider_response'},finished_at=now() WHERE id=${upload.id} AND status IN ('processing','failed')`;
      if(result.bounds_exceeded){await sql`UPDATE card_scan_settings SET enabled=false,revision=revision+1,updated_at=now() WHERE singleton AND revision=${reservation.rates.revision}`;
        await audit(sql,null,'scanning.accounting_boundary',{scan_id:upload.id,settings_revision:reservation.rates.revision});}
    });
  }catch(error){
    // Never log provider bodies, credentials, image bytes or model text.
    const code=!sent?'image':error instanceof ScanProviderError?error.code:'internal';
    await db()`UPDATE card_scans SET status='failed',error_code=${code},duration_ms=${Math.min(2147483647,Date.now()-started)},
      accounted_micros=CASE WHEN ${sent} THEN accounted_micros ELSE 0 END,settled=CASE WHEN ${sent} THEN settled ELSE true END,
      finished_at=now() WHERE id=${upload.id} AND status='processing'`;
  }
  return getCardScan(userId,upload.id);
}
export async function confirmCardScan(userId,idInput,input){
  const id=v.uuid(idInput,'Scan'),change=scanConfirmation(input),hash=scanHash(JSON.stringify(change));
  return db().begin(async sql=>{
    await collectionLock(sql,userId);const access=await requireScanAccess(sql,userId);
    const [scan]=await sql`SELECT * FROM card_scans WHERE id=${id} AND user_id=${userId} FOR UPDATE`;
    ensure(scan,404,'Scan not found.');
    if(['added','undone'].includes(scan.status)){ensure(scan.confirmation_hash===hash,409,'This scan was already saved with different details.');return scanPublic(scan);}
    ensure(scan.status==='ready',409,'Finish recognition before adding a card.');
    const [printing]=await sql`SELECT p.id,p.label,c.id AS card_id,c.name,c.language,c.game FROM printings p JOIN cards c ON c.id=p.card_id WHERE p.id=${change.printing_id}`;
    ensure(printing?.game==='pokemon'&&['en','ja'].includes(printing.language),400,'Choose an English or Japanese Pokémon printing from the catalogue.');
    const [old]=await sql`SELECT quantity,revision FROM collection_entries WHERE user_id=${userId} AND printing_id=${printing.id} AND condition=${change.condition} FOR UPDATE`;
    ensure((old?.revision??0)===change.entry_revision,409,'This ownership entry changed. Reload the card and review the quantity.');
    ensure((old?.quantity??0)+change.quantity<=9999,400,'This would exceed the collection quantity limit.');
    let placement=null;
    if(change.binder){
      const b=change.binder,[binder]=await sql`SELECT * FROM binders WHERE id=${b.id} AND user_id=${userId} FOR UPDATE`;
      ensure(binder,404,'Binder not found.');
      ensure(['collection','tracking'].includes(binder.binder_type)&&binder.game==='pokemon',400,'Choose a Pokémon Collection or Tracking binder.');
      const tracking=binder.binder_type==='tracking';
      ensure(access.features.some(f=>f.code===(tracking?'tracking_binders':'binders')),403,'Your membership does not allow adding to this binder type.');
      ensure(binder.revision===b.revision,409,'The binder changed. Reload its pockets before saving.');
      const slots=await sql`SELECT position,printing_id,is_collected FROM binder_slots WHERE binder_id=${b.id} ORDER BY position`;
      const state={...binder,slots};
      const target=b.mode==='auto'?automaticScanPocket(state,printing.id):scanBinderPockets(state,printing.id).find(p=>p.position===b.position);
      ensure(target,409,b.mode==='auto'?'This binder has no matching or empty pocket. Choose another binder or add to your collection only.':'Choose an empty or matching pocket. Tracking binders reuse an existing checklist pocket for this printing.');
      const marked=tracking&&!target.collected;
      if(!target.existing)await sql`INSERT INTO binder_slots(binder_id,position,printing_id,is_collected) VALUES(${b.id},${target.position},${printing.id},${tracking})`;
      else if(marked)await sql`UPDATE binder_slots SET is_collected=true WHERE binder_id=${b.id} AND position=${target.position}`;
      let revision=binder.revision;
      if(!target.existing||marked){const [updated]=await sql`UPDATE binders SET revision=revision+1,updated_at=now() WHERE id=${b.id} RETURNING revision`;revision=updated.revision;}
      placement={id:b.id,title:binder.title,binder_type:binder.binder_type,position:target.position,page:target.page,pocket:target.pocket,
        inserted:!target.existing,marked_collected:marked,revision};
    }
    const [entry]=await sql`INSERT INTO collection_entries(user_id,printing_id,condition,quantity)
      VALUES(${userId},${printing.id},${change.condition},${change.quantity})
      ON CONFLICT(user_id,printing_id,condition) DO UPDATE SET quantity=collection_entries.quantity+excluded.quantity,
        revision=collection_entries.revision+1,updated_at=now() RETURNING quantity,revision`;
    // A scan-created copy must not be mistaken for an older quick-added copy.
    await sql`DELETE FROM collection_quick_adds WHERE user_id=${userId} AND printing_id=${printing.id}`;
    const addition={printing_id:printing.id,card_id:printing.card_id,name:printing.name,printing_label:printing.label,
      condition:change.condition,quantity:change.quantity,previous_quantity:old?.quantity??0,total_quantity:entry.quantity,
      entry_revision:entry.revision,binder:placement};
    const [saved]=await sql`UPDATE card_scans SET status='added',confirmation_hash=${hash},addition=${sql.json(addition)},added_at=now() WHERE id=${id} RETURNING *`;
    await audit(sql,userId,'scanning.collection_added',{scan_id:id,printing_id:printing.id,quantity:change.quantity,binder_id:placement?.id??null});
    return scanPublic(saved);
  });
}
export async function undoCardScan(userId,idInput){
  const id=v.uuid(idInput,'Scan');
  return db().begin(async sql=>{
    await collectionLock(sql,userId);
    // Like other removal paths, undo remains available after membership expiry.
    const [scan]=await sql`SELECT * FROM card_scans WHERE id=${id} AND user_id=${userId} FOR UPDATE`;
    ensure(scan,404,'Scan not found.');
    if(scan.status==='undone')return scanPublic(scan);
    ensure(scan.status==='added'&&scan.addition,409,'This scan has no addition to undo.');
    const a=scan.addition,[entry]=await sql`SELECT * FROM collection_entries WHERE user_id=${userId} AND printing_id=${a.printing_id} AND condition=${a.condition} FOR UPDATE`;
    ensure(entry?.revision===a.entry_revision&&entry.quantity===a.total_quantity,409,'This ownership entry changed after scanning. Adjust it in Card details instead.');
    if(a.binder?.inserted||a.binder?.marked_collected){
      const [binder]=await sql`SELECT revision FROM binders WHERE id=${a.binder.id} AND user_id=${userId} FOR UPDATE`;
      if(binder){
        const [slot]=await sql`SELECT printing_id,is_collected FROM binder_slots WHERE binder_id=${a.binder.id} AND position=${a.binder.position}`;
        ensure(binder.revision===a.binder.revision&&slot?.printing_id===a.printing_id&&(!a.binder.marked_collected||slot.is_collected),409,'The binder changed after scanning. Adjust the card manually.');
        if(a.binder.inserted)await sql`DELETE FROM binder_slots WHERE binder_id=${a.binder.id} AND position=${a.binder.position}`;
        else await sql`UPDATE binder_slots SET is_collected=false WHERE binder_id=${a.binder.id} AND position=${a.binder.position}`;
        await sql`UPDATE binders SET revision=revision+1,updated_at=now() WHERE id=${a.binder.id}`;
      }
    }
    await sql`UPDATE collection_entries SET quantity=${a.previous_quantity},revision=revision+1,updated_at=now()
      WHERE user_id=${userId} AND printing_id=${a.printing_id} AND condition=${a.condition}`;
    const [saved]=await sql`UPDATE card_scans SET status='undone',undone_at=now() WHERE id=${id} RETURNING *`;
    await audit(sql,userId,'scanning.collection_undone',{scan_id:id});return scanPublic(saved);
  });
}
