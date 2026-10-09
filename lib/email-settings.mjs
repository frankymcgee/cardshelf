import { createPublicKey } from 'node:crypto';
import { isIP } from 'node:net';
import { db,audit } from './db.mjs';
import { AppError,ensure } from './errors.mjs';
import { verifyPassword } from './security.mjs';
import { rateLimit } from './auth.mjs';
import { recoveryEmail,recoveryOrigin } from './password-recovery-logic.mjs';
import * as v from './validate.mjs';
import { encryptMailCredential, decryptMailCredential } from './email-secrets.mjs';
import { smtpSettingsInput, smtpPassword, smtpCredentialContext, encryptSmtpSecret, decryptSmtpSecret } from './smtp-settings.mjs';
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
export function encryptEmailSecret(value,origin=postalOrigin(),env=process.env) {
  return encryptMailCredential(value,'cardshelf:postal:v1:api:'+origin,env);
}
export function decryptEmailSecret(value,origin=postalOrigin(),env=process.env) {
  try { return decryptMailCredential(value,'cardshelf:postal:v1:api:'+origin,env); }
  catch {throw new AppError(503,'Postal credentials cannot be unlocked. Check the server encryption key and Postal origin.');}
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
  const o=emailObject(value,['revision','password','provider','enabled','sender_name','from_address','reply_to','api_key','clear_api_key','dkim_selector','dkim_public_key','webhook_public_key',
    'smtp_preset','smtp_host','smtp_port','smtp_security','smtp_user','smtp_password','clear_smtp_password','smtp_rate_limit']);
  const provider=v.oneOf(o.provider??'postal','Email provider',['postal','smtp']);
  const smtp=smtpSettingsInput(o,provider==='smtp'),smtpPass=o.smtp_password??'';
  ensure(typeof smtpPass==='string',400,'SMTP password must be text.');if(smtpPass)smtpPassword(smtpPass);
  const clearSmtp=v.bool(o.clear_smtp_password??false,'Remove SMTP password');
  ensure(!clearSmtp||!smtpPass,400,'Enter a new SMTP password or remove the existing password, not both.');
  const selector=v.text(o.dkim_selector??'','DKIM selector',0,100),dkim=v.text(o.dkim_public_key??'','DKIM public TXT value',0,4000);
  ensure(!selector||/^[a-zA-Z0-9](?:[a-zA-Z0-9_-]{0,61}[a-zA-Z0-9])?$/.test(selector),400,'Use the DKIM selector label shown by your mail provider.');
  ensure(!dkim||!/[\x00-\x1f\x7f]/.test(dkim)&&/^v=DKIM1\s*;/i.test(dkim)&&/(?:^|;)\s*p=[A-Za-z0-9+/=]+(?:;|$)/.test(dkim),400,'Paste the complete public DKIM TXT value shown by your mail provider.');
  ensure(!dkim||selector,400,'Enter the DKIM selector with its public TXT value.');
  const apiKey=o.api_key??'';ensure(typeof apiKey==='string',400,'API key must be text.');if(apiKey)postalApiKey(apiKey);
  const clear=v.bool(o.clear_api_key??false,'Remove API key');ensure(!clear||!apiKey,400,'Enter a new API key or remove the existing key, not both.');
  return {revision:v.integer(o.revision,'Revision',0,Number.MAX_SAFE_INTEGER),password:o.password,
    provider,enabled:v.bool(o.enabled,'Enable email'),sender_name:emailHeader(o.sender_name,'Sender name',80),from_address:senderAddress(o.from_address),
    reply_to:o.reply_to?senderAddress(o.reply_to):'',api_key:apiKey,clear_api_key:clear,dkim_selector:selector,dkim_public_key:dkim,webhook_public_key:webhookPublicKey(o.webhook_public_key??''),
    ...smtp,smtp_password:smtpPass,clear_smtp_password:clearSmtp};
}
export async function requireEmailAdmin(actorId,password=undefined,sql=db()) {
  const [actor]=await sql`SELECT id,email,role,password_hash FROM app_users WHERE id=${v.uuid(actorId)}`;
  ensure(actor?.role==='admin',403,'Administrator access is required.');
  if(password!==undefined){await rateLimit('email-admin:'+actorId,20);ensure(typeof password==='string'&&password.length>=1&&password.length<=128&&await verifyPassword(password,actor.password_hash),403,'Confirm your current administrator password.');}
  return actor;
}
export async function lockEmailAdmin(sql,actor) {
  const [current]=await sql`SELECT id,email,role,password_hash FROM app_users WHERE id=${actor.id} FOR UPDATE`;
  ensure(current?.role==='admin'&&current.password_hash===actor.password_hash,403,'Administrator credentials changed. Sign in again.');return current;
}
export function emailConfigurationFromRow(row,env=process.env) {
  const cfg={exists:!!row,provider:row?.provider||'postal',enabled:row?.enabled===true,configured:false,origin:'',secret:'',smtp_password:'',sender_name:row?.sender_name||'CardShelf',
    from_address:row?.from_address||'noreply@'+EMAIL_DOMAIN,reply_to:row?.reply_to||'',dkim_selector:row?.dkim_selector||'',dkim_public_key:row?.dkim_public_key||'',
    webhook_public_key:row?.webhook_public_key||'',revision:row?.revision||0,api_key_set:!!row?.api_secret,
    smtp_preset:row?.smtp_preset||'custom',smtp_host:row?.smtp_host||'',smtp_port:row?.smtp_port||587,smtp_security:row?.smtp_security||'starttls',smtp_user:row?.smtp_user||'',smtp_rate_limit:row?.smtp_rate_limit||10,
    smtp_password_set:!!row?.smtp_secret,smtp_verified_at:row?.smtp_verified_revision===row?.revision?row?.smtp_verified_at||null:null,
    key_available:/^[a-f0-9]{64}$/i.test(env.CARDSHELF_INTEGRATION_KEY||''),config_error:'',updated_at:row?.updated_at||null};
  try {
    ensure(env.NODE_TLS_REJECT_UNAUTHORIZED!=='0',503,'Certificate verification must remain enabled.');
    if(cfg.provider==='smtp'){
      smtpSettingsInput(cfg);
      if(row?.smtp_secret){cfg.smtp_password=decryptSmtpSecret(row.smtp_secret,cfg,env);cfg.configured=true;}
    }else {
      ensure(cfg.provider==='postal',503,'Unsupported email provider.');
      cfg.origin=postalOrigin(env);if(row?.api_secret){cfg.secret=decryptEmailSecret(row.api_secret,cfg.origin,env);postalApiKey(cfg.secret);cfg.configured=true;}
    }
  } catch {cfg.secret='';cfg.smtp_password='';cfg.config_error='Email configuration needs administrator attention. Check the selected provider, saved connection and server encryption key.';}
  return cfg;
}
export async function emailConfiguration(sql=db()) {const [row]=await sql`SELECT * FROM email_settings WHERE singleton`;return emailConfigurationFromRow(row);}
export async function emailSettings(sql=db()) {
  const {secret,smtp_password,...settings}=await emailConfiguration(sql);let webhook_url='';
  try {webhook_url=recoveryOrigin(process.env.APP_ORIGIN||'https://cardshelf.cloud')+'/api/webhooks/postal';}catch{ /* No untrusted link is returned. */ }
  return {...settings,webhook_url,worker_enabled:process.env.EMAIL_WORKER_ENABLED!=='false'};
}
export async function saveEmailSettings(actorId,input) {
  let data=emailSettingsInput(input);const actor=await requireEmailAdmin(actorId,data.password??'');
  return db().begin(async sql=>{
    await sql`SELECT pg_advisory_xact_lock(${EMAIL_SETTINGS_LOCK})`;await lockEmailAdmin(sql,actor);
    const [old]=await sql`SELECT * FROM email_settings WHERE singleton FOR UPDATE`;
    ensure((old?.revision||0)===data.revision,409,'Email settings changed. Reload before saving.');
    // Old clients do not know about SMTP. Missing fields retain the saved
    // transport rather than silently switching or erasing its credentials.
    if(old) data=emailSettingsInput({provider:old.provider,smtp_preset:old.smtp_preset,smtp_host:old.smtp_host,smtp_port:old.smtp_port,
      smtp_security:old.smtp_security,smtp_user:old.smtp_user,smtp_rate_limit:old.smtp_rate_limit,
      dkim_selector:old.dkim_selector,dkim_public_key:old.dkim_public_key,webhook_public_key:old.webhook_public_key,...input});
    const encrypted=data.clear_api_key?null:data.api_key?encryptEmailSecret(data.api_key):old?.api_secret||null;
    // Never silently rebind a password to a different server or account. Keep
    // each provider's encrypted credential when switching between transports.
    if(old?.smtp_secret&&!data.smtp_password&&!data.clear_smtp_password){
      ensure(smtpCredentialContext(old)===smtpCredentialContext(data),409,'The SMTP server or username changed. Enter its password again or remove the saved password.');
    }
    const smtpEncrypted=data.clear_smtp_password?null:data.smtp_password?encryptSmtpSecret(data.smtp_password,data):old?.smtp_secret||null;
    const enabled=(data.provider==='postal'?data.clear_api_key:data.clear_smtp_password)?false:data.enabled;
    if(enabled){const config=emailConfigurationFromRow({...old,...data,api_secret:encrypted,smtp_secret:smtpEncrypted});ensure(config.configured,409,'Save valid credentials for the selected provider and configure the server encryption key before enabling email.');}
    await sql`INSERT INTO email_settings(singleton,enabled,provider,sender_name,from_address,reply_to,api_secret,dkim_selector,dkim_public_key,webhook_public_key,
      smtp_preset,smtp_host,smtp_port,smtp_security,smtp_user,smtp_secret,smtp_rate_limit,updated_by)
      VALUES(true,${enabled},${data.provider},${data.sender_name},${data.from_address},${data.reply_to},${encrypted},${data.dkim_selector},${data.dkim_public_key},${data.webhook_public_key},
      ${data.smtp_preset},${data.smtp_host},${data.smtp_port},${data.smtp_security},${data.smtp_user},${smtpEncrypted},${data.smtp_rate_limit},${actorId})
      ON CONFLICT(singleton) DO UPDATE SET enabled=excluded.enabled,sender_name=excluded.sender_name,from_address=excluded.from_address,reply_to=excluded.reply_to,
      provider=excluded.provider,api_secret=excluded.api_secret,dkim_selector=excluded.dkim_selector,dkim_public_key=excluded.dkim_public_key,webhook_public_key=excluded.webhook_public_key,
      smtp_preset=excluded.smtp_preset,smtp_host=excluded.smtp_host,smtp_port=excluded.smtp_port,smtp_security=excluded.smtp_security,smtp_user=excluded.smtp_user,smtp_secret=excluded.smtp_secret,smtp_rate_limit=excluded.smtp_rate_limit,
      smtp_verified_at=NULL,smtp_verified_revision=NULL,
      revision=email_settings.revision+1,updated_by=excluded.updated_by,updated_at=now()`;
    await audit(sql,actorId,'email.settings_saved',{enabled,provider:data.provider,credential_changed:!!data.api_key||data.clear_api_key||!!data.smtp_password||data.clear_smtp_password});
    return emailSettings(sql);
  });
}
