import { createCipheriv,createDecipheriv,createPublicKey,randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import { db,audit } from './db.mjs';
import { AppError,ensure } from './errors.mjs';
import { verifyPassword } from './security.mjs';
import { rateLimit } from './auth.mjs';
import { recoveryEmail,recoveryOrigin } from './password-recovery-logic.mjs';
import * as v from './validate.mjs';
export const EMAIL_DOMAIN='cardshelf.cloud';
export const EMAIL_SETTINGS_LOCK=72492001;
export function emailObject(value,keys) {const o=v.object(value);ensure(Object.keys(o).every(key=>keys.includes(key)),400,'Unsupported email setting.');return o;}
export function postalOrigin(env=process.env) {
  try {
    const u=new URL(env.POSTAL_ORIGIN||'https://postal.cardshelf.cloud');
    ensure(u.protocol==='https:'&&!u.username&&!u.password&&!u.search&&!u.hash&&u.pathname==='/'&&(!u.port||u.port==='443')
      && !isIP(u.hostname)&&u.hostname.includes('.')&&u.hostname!=='localhost'&&!u.hostname.endsWith('.localhost'),503,'Configure a trusted HTTPS POSTAL_ORIGIN on the server.');
    ensure(env.NODE_TLS_REJECT_UNAUTHORIZED!=='0',503,'Certificate verification must remain enabled.');
    return u.origin;
  } catch {throw new AppError(503,'Configure a trusted HTTPS POSTAL_ORIGIN with certificate verification on the server.');}
}
function encryptionKey(env) {ensure(/^[a-f0-9]{64}$/i.test(env.CARDSHELF_INTEGRATION_KEY||''),503,'Prepare CARDSHELF_INTEGRATION_KEY on the server before saving an API key.');return Buffer.from(env.CARDSHELF_INTEGRATION_KEY,'hex');}
export function encryptEmailSecret(value,origin=postalOrigin(),env=process.env) {
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',encryptionKey(env),iv);
  cipher.setAAD(Buffer.from('cardshelf:postal:v1:api:'+origin));
  const data=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);
  return ['v1',iv.toString('base64'),cipher.getAuthTag().toString('base64'),data.toString('base64')].join('.');
}
export function decryptEmailSecret(value,origin=postalOrigin(),env=process.env) {
  try {
    const [version,iv,tag,data,extra]=String(value).split('.');ensure(version==='v1'&&!extra,503,'Invalid encrypted key.');
    const cipher=createDecipheriv('aes-256-gcm',encryptionKey(env),Buffer.from(iv,'base64'));
    cipher.setAAD(Buffer.from('cardshelf:postal:v1:api:'+origin));cipher.setAuthTag(Buffer.from(tag,'base64'));
    return Buffer.concat([cipher.update(Buffer.from(data,'base64')),cipher.final()]).toString('utf8');
  } catch {throw new AppError(503,'Postal credentials cannot be unlocked. Check the server encryption key and Postal origin.');}
}
export function emailHeader(value,label,max=200) {const text=v.text(value,label,1,max);ensure(!/[\x00-\x1f\x7f]/.test(text),400,label+' contains an invalid character.');return text;}
export function senderAddress(value) {const email=recoveryEmail(value);ensure(email.endsWith('@'+EMAIL_DOMAIN),400,'Use a sender or reply address at '+EMAIL_DOMAIN+'.');return email;}
export function postalApiKey(value) {ensure(typeof value==='string'&&/^[\x21-\x7e]{16,512}$/.test(value),400,'Enter a valid Postal server API credential without spaces.');return value;}
export function webhookPublicKey(value) {
  const text=v.text(value,'Webhook public key',0,8000);if(!text)return '';
  ensure(!text.includes('PRIVATE KEY')&&/^-----BEGIN (?:RSA )?PUBLIC KEY-----/.test(text),400,'Paste the Postal RSA public key, never a private key.');
  try {const key=createPublicKey(text);ensure(key.asymmetricKeyType==='rsa'&&key.asymmetricKeyDetails?.modulusLength>=2048&&key.asymmetricKeyDetails.modulusLength<=8192,400,'Use a Postal RSA public key between 2048 and 8192 bits.');return key.export({type:'spki',format:'pem'}).toString();}
  catch {throw new AppError(400,'Use a valid Postal RSA public key between 2048 and 8192 bits.');}
}
export function emailSettingsInput(value) {
  const o=emailObject(value,['revision','password','enabled','sender_name','from_address','reply_to','api_key','clear_api_key','dkim_selector','dkim_public_key','webhook_public_key']);
  const selector=v.text(o.dkim_selector??'','DKIM selector',0,100),dkim=v.text(o.dkim_public_key??'','DKIM public TXT value',0,4000);
  ensure(!selector||/^[a-zA-Z0-9](?:[a-zA-Z0-9_-]{0,61}[a-zA-Z0-9])?$/.test(selector),400,'Use the DKIM selector label shown by Postal.');
  ensure(!dkim||!/[\x00-\x1f\x7f]/.test(dkim)&&/^v=DKIM1\s*;/i.test(dkim)&&/(?:^|;)\s*p=[A-Za-z0-9+/=]+(?:;|$)/.test(dkim),400,'Paste the complete public DKIM TXT value shown by Postal.');
  ensure(!dkim||selector,400,'Enter the DKIM selector with its public TXT value.');
  const apiKey=o.api_key??'';ensure(typeof apiKey==='string',400,'API key must be text.');if(apiKey)postalApiKey(apiKey);
  const clear=v.bool(o.clear_api_key??false,'Remove API key');ensure(!clear||!apiKey,400,'Enter a new API key or remove the existing key, not both.');
  return {revision:v.integer(o.revision,'Revision',0,Number.MAX_SAFE_INTEGER),password:o.password,
    enabled:v.bool(o.enabled,'Enable Postal'),sender_name:emailHeader(o.sender_name,'Sender name',80),from_address:senderAddress(o.from_address),
    reply_to:o.reply_to?senderAddress(o.reply_to):'',api_key:apiKey,clear_api_key:clear,dkim_selector:selector,dkim_public_key:dkim,webhook_public_key:webhookPublicKey(o.webhook_public_key??'')};
}
export async function requireEmailAdmin(actorId,password=undefined,sql=db()) {
  const [actor]=await sql`SELECT id,email,role,password_hash FROM app_users WHERE id=${v.uuid(actorId)}`;
  ensure(actor?.role==='admin',403,'Administrator access is required.');
  if(password!==undefined){await rateLimit('email-admin:'+actorId,20);ensure(typeof password==='string'&&await verifyPassword(password,actor.password_hash),403,'Confirm your current administrator password.');}
  return actor;
}
export async function lockEmailAdmin(sql,actor) {
  const [current]=await sql`SELECT id,email,role,password_hash FROM app_users WHERE id=${actor.id} FOR UPDATE`;
  ensure(current?.role==='admin'&&current.password_hash===actor.password_hash,403,'Administrator credentials changed. Sign in again.');return current;
}
export function emailConfigurationFromRow(row,env=process.env) {
  const cfg={exists:!!row,enabled:row?.enabled===true,configured:false,origin:'',secret:'',sender_name:row?.sender_name||'CardShelf',
    from_address:row?.from_address||'noreply@'+EMAIL_DOMAIN,reply_to:row?.reply_to||'',dkim_selector:row?.dkim_selector||'',dkim_public_key:row?.dkim_public_key||'',
    webhook_public_key:row?.webhook_public_key||'',revision:row?.revision||0,api_key_set:!!row?.api_secret,
    key_available:/^[a-f0-9]{64}$/i.test(env.CARDSHELF_INTEGRATION_KEY||''),config_error:'',updated_at:row?.updated_at||null};
  try {cfg.origin=postalOrigin(env);if(row?.api_secret){cfg.secret=decryptEmailSecret(row.api_secret,cfg.origin,env);postalApiKey(cfg.secret);cfg.configured=true;}}
  catch {cfg.secret='';cfg.config_error='Postal configuration needs administrator attention. Check the server origin and encryption key.';}
  return cfg;
}
export async function emailConfiguration(sql=db()) {const [row]=await sql`SELECT * FROM email_settings WHERE singleton`;return emailConfigurationFromRow(row);}
export async function emailSettings(sql=db()) {
  const {secret,...settings}=await emailConfiguration(sql);let webhook_url='';
  try {webhook_url=recoveryOrigin(process.env.APP_ORIGIN||'https://cardshelf.cloud')+'/api/webhooks/postal';}catch{ /* No untrusted link is returned. */ }
  return {...settings,webhook_url,worker_enabled:process.env.EMAIL_WORKER_ENABLED!=='false'};
}
export async function saveEmailSettings(actorId,input) {
  const data=emailSettingsInput(input),actor=await requireEmailAdmin(actorId,data.password??'');
  return db().begin(async sql=>{
    await sql`SELECT pg_advisory_xact_lock(${EMAIL_SETTINGS_LOCK})`;await lockEmailAdmin(sql,actor);
    const [old]=await sql`SELECT * FROM email_settings WHERE singleton FOR UPDATE`;
    ensure((old?.revision||0)===data.revision,409,'Email settings changed. Reload before saving.');
    const encrypted=data.clear_api_key?null:data.api_key?encryptEmailSecret(data.api_key):old?.api_secret||null;
    const enabled=data.clear_api_key?false:data.enabled;
    if(enabled){const config=emailConfigurationFromRow({...old,...data,api_secret:encrypted});ensure(config.configured,409,'Save a valid Postal API key and configure the server encryption key before enabling email.');}
    await sql`INSERT INTO email_settings(singleton,enabled,sender_name,from_address,reply_to,api_secret,dkim_selector,dkim_public_key,webhook_public_key,updated_by)
      VALUES(true,${enabled},${data.sender_name},${data.from_address},${data.reply_to},${encrypted},${data.dkim_selector},${data.dkim_public_key},${data.webhook_public_key},${actorId})
      ON CONFLICT(singleton) DO UPDATE SET enabled=excluded.enabled,sender_name=excluded.sender_name,from_address=excluded.from_address,reply_to=excluded.reply_to,
      api_secret=excluded.api_secret,dkim_selector=excluded.dkim_selector,dkim_public_key=excluded.dkim_public_key,webhook_public_key=excluded.webhook_public_key,
      revision=email_settings.revision+1,updated_by=excluded.updated_by,updated_at=now()`;
    await audit(sql,actorId,'email.settings_saved',{enabled,credential_changed:!!data.api_key||data.clear_api_key});
    return emailSettings(sql);
  });
}
