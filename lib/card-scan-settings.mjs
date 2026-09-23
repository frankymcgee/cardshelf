import { createCipheriv,createDecipheriv,randomBytes } from 'node:crypto';
import { db,audit } from './db.mjs';
import { rateLimit } from './auth.mjs';
import { verifyPassword } from './security.mjs';
import { ensure,AppError } from './errors.mjs';
import * as v from './validate.mjs';
import { SCAN_MODEL,SCAN_MODEL_LABEL,SCAN_PRICE_CHECKED } from '../shared/card-scanning.mjs';
import { SCAN_SETTINGS_LOCK,scanObject,scanReservation } from './card-scan-logic.mjs';
function key(env){ensure(/^[a-f0-9]{64}$/i.test(env.CARDSHELF_INTEGRATION_KEY||''),503,'Prepare the server integration encryption key before saving scanning credentials.');return Buffer.from(env.CARDSHELF_INTEGRATION_KEY,'hex');}
export function encryptScanSecret(secret,env=process.env){
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(env),iv);
  cipher.setAAD(Buffer.from('cardshelf:card-scanning:openai:v1'));
  const value=Buffer.concat([cipher.update(secret,'utf8'),cipher.final()]);
  return ['v1',iv.toString('base64'),cipher.getAuthTag().toString('base64'),value.toString('base64')].join('.');
}
export function decryptScanSecret(value,env=process.env){
  try{const [version,iv,tag,data,extra]=String(value).split('.');ensure(version==='v1'&&!extra,503,'Invalid scanning credential.');
    const decipher=createDecipheriv('aes-256-gcm',key(env),Buffer.from(iv,'base64'));
    decipher.setAAD(Buffer.from('cardshelf:card-scanning:openai:v1'));decipher.setAuthTag(Buffer.from(tag,'base64'));
    return Buffer.concat([decipher.update(Buffer.from(data,'base64')),decipher.final()]).toString('utf8');
  }catch{throw new AppError(503,'Scanning credentials could not be unlocked. Check the server integration key.');}
}
export function scanningSettingsInput(input){
  const o=scanObject(input,['revision','password','enabled','api_key','clear_api_key','monthly_budget_usd','user_monthly_limit','input_usd_per_million','output_usd_per_million']);
  const money=(value,name,min,max)=>{ensure(typeof value==='number'&&Number.isFinite(value)&&value>=min&&value<=max,400,name+' is outside the supported range.');return Math.round(value*1000000);};
  const secret=v.text(o.api_key??'','API key',0,512),clear=v.bool(o.clear_api_key??false,'Remove API key');
  ensure(!secret||/^sk-[A-Za-z0-9_-]{16,509}$/.test(secret),400,'Enter an OpenAI API key without spaces.');
  ensure(!(secret&&clear),400,'Enter a replacement key or remove the existing key.');
  return {revision:v.integer(o.revision,'Revision',1,2147483647),password:o.password??'',enabled:v.bool(o.enabled,'Enable scanning'),
    api_key:secret,clear_api_key:clear,monthly_budget_micros:money(o.monthly_budget_usd,'Monthly budget',0,1000),
    user_monthly_limit:v.integer(o.user_monthly_limit,'Scans per user per month',1,10000),
    input_price_micros:money(o.input_usd_per_million,'Input rate',0.4,1000),output_price_micros:money(o.output_usd_per_million,'Output rate',1.6,1000)};
}
export async function scanningSettings(sql=db()){
  const [row]=await sql`SELECT * FROM card_scan_settings WHERE singleton`;
  ensure(row,503,'Apply the card-scanning migration.');
  const {api_secret,...rest}=row;let configured=false;
  try{configured=!!api_secret&&!!decryptScanSecret(api_secret);}catch{/* A status read must never expose secret details. */}
  return {...rest,monthly_budget_micros:Number(row.monthly_budget_micros),configured,api_key_set:!!api_secret,
    key_available:/^[a-f0-9]{64}$/i.test(process.env.CARDSHELF_INTEGRATION_KEY||''),provider:'openai',model:SCAN_MODEL,model_label:SCAN_MODEL_LABEL,
    price_checked:SCAN_PRICE_CHECKED,reservation_micros:scanReservation(row)};
}
export async function requireScanAdmin(actorId,password){
  const [actor]=await db()`SELECT id,role,password_hash FROM app_users WHERE id=${v.uuid(actorId)}`;
  ensure(actor?.role==='admin',403,'Administrator access is required.');
  if(password!==undefined){await rateLimit('card-scanning-admin:'+actorId,15);ensure(typeof password==='string'&&await verifyPassword(password,actor.password_hash),403,'Confirm your current administrator password.');}
  return actor;
}
export async function saveScanningSettings(actorId,input){
  const data=scanningSettingsInput(input),actor=await requireScanAdmin(actorId,data.password);
  return db().begin(async sql=>{
    await sql`SELECT pg_advisory_xact_lock(${SCAN_SETTINGS_LOCK})`;
    const [currentActor]=await sql`SELECT role,password_hash FROM app_users WHERE id=${actorId} FOR UPDATE`;
    ensure(currentActor?.role==='admin'&&currentActor.password_hash===actor.password_hash,403,'Administrator credentials changed. Sign in again.');
    const [old]=await sql`SELECT * FROM card_scan_settings WHERE singleton FOR UPDATE`;
    ensure(old.revision===data.revision,409,'Scanning settings changed. Reload before saving.');
    const encrypted=data.clear_api_key?null:data.api_key?encryptScanSecret(data.api_key):old.api_secret;
    const enabled=data.clear_api_key?false:data.enabled;
    if(enabled){ensure(encrypted&&decryptScanSecret(encrypted),409,'Save an API key before enabling scanning.');ensure(data.monthly_budget_micros>=scanReservation(data),400,'Set a budget large enough for at least one scan reservation.');}
    await sql`UPDATE card_scan_settings SET enabled=${enabled},api_secret=${encrypted},monthly_budget_micros=${data.monthly_budget_micros},
      user_monthly_limit=${data.user_monthly_limit},input_price_micros=${data.input_price_micros},output_price_micros=${data.output_price_micros},
      revision=revision+1,updated_by=${actorId},updated_at=now() WHERE singleton`;
    await audit(sql,actorId,'scanning.settings_saved',{enabled,credential_changed:!!data.api_key||data.clear_api_key,
      monthly_budget_micros:data.monthly_budget_micros,user_monthly_limit:data.user_monthly_limit});
    return scanningSettings(sql);
  });
}
export async function scanMonth(sql=db()) {return (await sql`SELECT to_char(now() AT TIME ZONE 'UTC','YYYY-MM-01') AS month`)[0].month;}
export async function scanTotals(sql=db(),month=null){
  month??=await scanMonth(sql);
  const [row]=await sql`SELECT count(*)::integer AS scans,count(*) FILTER(WHERE status IN ('ready','added','undone'))::integer AS recognised,
    count(*) FILTER(WHERE status IN ('added','undone'))::integer AS confirmed,
    count(*) FILTER(WHERE NOT settled)::integer AS uncertain,
    coalesce(sum(accounted_micros),0)::text AS accounted_micros,
    coalesce(sum(accounted_micros) FILTER(WHERE settled),0)::text AS measured_micros,
    coalesce(sum(input_tokens),0)::text AS input_tokens,coalesce(sum(output_tokens),0)::text AS output_tokens,
    round(avg(duration_ms))::integer AS average_duration_ms FROM card_scans WHERE budget_month=${month}`;
  return {...row,month,accounted_micros:Number(row.accounted_micros),measured_micros:Number(row.measured_micros),input_tokens:Number(row.input_tokens),output_tokens:Number(row.output_tokens)};
}
export async function scanningAdminOverview(actorId){
  await requireScanAdmin(actorId);
  const settings=await scanningSettings(),totals=await scanTotals();
  const users=await db()`SELECT s.user_id,u.name,u.email,count(*)::integer AS scans,
    coalesce(sum(s.accounted_micros),0)::text AS accounted_micros FROM card_scans s LEFT JOIN app_users u ON u.id=s.user_id
    WHERE s.budget_month=${totals.month} GROUP BY s.user_id,u.name,u.email ORDER BY count(*) DESC LIMIT 100`;
  const history=await db()`SELECT to_char(budget_month,'YYYY-MM') AS month,count(*)::integer AS scans,
    count(*) FILTER(WHERE status IN ('added','undone'))::integer AS confirmed,
    count(*) FILTER(WHERE NOT settled)::integer AS uncertain,
    coalesce(sum(accounted_micros),0)::text AS accounted_micros,
    coalesce(sum(accounted_micros) FILTER(WHERE settled),0)::text AS measured_micros,
    round(avg(duration_ms))::integer AS average_duration_ms FROM card_scans GROUP BY budget_month ORDER BY budget_month DESC LIMIT 12`;
  return {settings,totals,users,history};
}
