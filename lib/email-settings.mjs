import { db,audit } from './db.mjs';
import { ensure } from './errors.mjs';
import { verifyPassword } from './security.mjs';
import { rateLimit } from './auth.mjs';
import { recoveryEmail } from './password-recovery-logic.mjs';
import * as v from './validate.mjs';
import { smtpSettingsInput, smtpPassword, smtpCredentialContext, encryptSmtpSecret, decryptSmtpSecret } from './smtp-settings.mjs';
export const EMAIL_DOMAIN='cardshelf.cloud';
export const EMAIL_SETTINGS_LOCK=72492001;
export function emailObject(value,keys) {const o=v.object(value);ensure(Object.keys(o).every(key=>keys.includes(key)),400,'Unsupported email setting.');return o;}
export function emailHeader(value,label,max=200) {const text=v.text(value,label,1,max);ensure(!/[\x00-\x1f\x7f]/.test(text),400,label+' contains an invalid character.');return text;}
export function senderAddress(value) {const email=recoveryEmail(value);ensure(email.endsWith('@'+EMAIL_DOMAIN),400,'Use a sender or reply address at '+EMAIL_DOMAIN+'.');return email;}
export function emailSettingsInput(value) {
  const o=emailObject(value,['revision','password','provider','enabled','sender_name','from_address','reply_to','dkim_selector','dkim_public_key',
    'smtp_preset','smtp_host','smtp_port','smtp_security','smtp_user','smtp_password','clear_smtp_password','smtp_rate_limit']);
  const provider=v.oneOf(o.provider??'smtp','Email provider',['smtp']);
  const smtp=smtpSettingsInput(o),smtpPass=o.smtp_password??'';
  ensure(typeof smtpPass==='string',400,'SMTP password must be text.');if(smtpPass)smtpPassword(smtpPass);
  const clearSmtp=v.bool(o.clear_smtp_password??false,'Remove SMTP password');
  ensure(!clearSmtp||!smtpPass,400,'Enter a new SMTP password or remove the existing password, not both.');
  const selector=v.text(o.dkim_selector??'','DKIM selector',0,100),dkim=v.text(o.dkim_public_key??'','DKIM public TXT value',0,4000);
  ensure(!selector||/^[a-zA-Z0-9](?:[a-zA-Z0-9_-]{0,61}[a-zA-Z0-9])?$/.test(selector),400,'Use the DKIM selector label shown by your mail provider.');
  ensure(!dkim||!/[\x00-\x1f\x7f]/.test(dkim)&&/^v=DKIM1\s*;/i.test(dkim)&&/(?:^|;)\s*p=[A-Za-z0-9+/=]+(?:;|$)/.test(dkim),400,'Paste the complete public DKIM TXT value shown by your mail provider.');
  ensure(!dkim||selector,400,'Enter the DKIM selector with its public TXT value.');
  return {revision:v.integer(o.revision,'Revision',0,Number.MAX_SAFE_INTEGER),password:o.password,
    provider,enabled:v.bool(o.enabled,'Enable email'),sender_name:emailHeader(o.sender_name,'Sender name',80),from_address:senderAddress(o.from_address),
    reply_to:o.reply_to?senderAddress(o.reply_to):'',dkim_selector:selector,dkim_public_key:dkim,
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
  const cfg={exists:!!row,provider:'smtp',enabled:row?.enabled===true,configured:false,smtp_password:'',sender_name:row?.sender_name||'CardShelf',
    from_address:row?.from_address||'noreply@'+EMAIL_DOMAIN,reply_to:row?.reply_to||'',dkim_selector:row?.dkim_selector||'',dkim_public_key:row?.dkim_public_key||'',
    revision:row?.revision||0,
    smtp_preset:row?.smtp_preset||'custom',smtp_host:row?.smtp_host||'',smtp_port:row?.smtp_port||587,smtp_security:row?.smtp_security||'starttls',smtp_user:row?.smtp_user||'',smtp_rate_limit:row?.smtp_rate_limit||10,
    smtp_password_set:!!row?.smtp_secret,smtp_verified_at:row?.smtp_verified_revision===row?.revision?row?.smtp_verified_at||null:null,
    key_available:/^[a-f0-9]{64}$/i.test(env.CARDSHELF_INTEGRATION_KEY||''),config_error:'',updated_at:row?.updated_at||null};
  try {
    ensure(env.NODE_TLS_REJECT_UNAUTHORIZED!=='0',503,'Certificate verification must remain enabled.');
    if(row){
      ensure(!row.provider||row.provider==='smtp',503,'Unsupported email provider.');
      smtpSettingsInput(cfg);
      if(row?.smtp_secret){cfg.smtp_password=decryptSmtpSecret(row.smtp_secret,cfg,env);cfg.configured=true;}
    }
  } catch {cfg.smtp_password='';cfg.config_error='Email configuration needs administrator attention. Check the saved SMTP connection and server encryption key.';}
  return cfg;
}
export async function emailConfiguration(sql=db()) {const [row]=await sql`SELECT * FROM email_settings WHERE singleton`;return emailConfigurationFromRow(row);}
export async function emailSettings(sql=db()) {
  const {smtp_password,...settings}=await emailConfiguration(sql);
  return {...settings,worker_enabled:process.env.EMAIL_WORKER_ENABLED!=='false'};
}
export async function saveEmailSettings(actorId,input) {
  let data=emailSettingsInput(input);const actor=await requireEmailAdmin(actorId,data.password??'');
  return db().begin(async sql=>{
    await sql`SELECT pg_advisory_xact_lock(${EMAIL_SETTINGS_LOCK})`;await lockEmailAdmin(sql,actor);
    const [old]=await sql`SELECT * FROM email_settings WHERE singleton FOR UPDATE`;
    ensure((old?.revision||0)===data.revision,409,'Email settings changed. Reload before saving.');
    // Missing connection fields retain the saved SMTP identity.
    if(old) data=emailSettingsInput({provider:old.provider,smtp_preset:old.smtp_preset,smtp_host:old.smtp_host,smtp_port:old.smtp_port,
      smtp_security:old.smtp_security,smtp_user:old.smtp_user,smtp_rate_limit:old.smtp_rate_limit,
      dkim_selector:old.dkim_selector,dkim_public_key:old.dkim_public_key,...input});
    // Never silently rebind a password to a different server or account.
    if(old?.smtp_secret&&!data.smtp_password&&!data.clear_smtp_password){
      ensure(smtpCredentialContext(old)===smtpCredentialContext(data),409,'The SMTP server or username changed. Enter its password again or remove the saved password.');
    }
    const smtpEncrypted=data.clear_smtp_password?null:data.smtp_password?encryptSmtpSecret(data.smtp_password,data):old?.smtp_secret||null;
    const enabled=data.clear_smtp_password?false:data.enabled;
    if(enabled){const config=emailConfigurationFromRow({...old,...data,smtp_secret:smtpEncrypted});ensure(config.configured,409,'Save valid SMTP credentials and configure the server encryption key before enabling email.');}
    await sql`INSERT INTO email_settings(singleton,enabled,provider,sender_name,from_address,reply_to,dkim_selector,dkim_public_key,
      smtp_preset,smtp_host,smtp_port,smtp_security,smtp_user,smtp_secret,smtp_rate_limit,updated_by)
      VALUES(true,${enabled},${data.provider},${data.sender_name},${data.from_address},${data.reply_to},${data.dkim_selector},${data.dkim_public_key},
      ${data.smtp_preset},${data.smtp_host},${data.smtp_port},${data.smtp_security},${data.smtp_user},${smtpEncrypted},${data.smtp_rate_limit},${actorId})
      ON CONFLICT(singleton) DO UPDATE SET enabled=excluded.enabled,sender_name=excluded.sender_name,from_address=excluded.from_address,reply_to=excluded.reply_to,
      provider=excluded.provider,dkim_selector=excluded.dkim_selector,dkim_public_key=excluded.dkim_public_key,
      smtp_preset=excluded.smtp_preset,smtp_host=excluded.smtp_host,smtp_port=excluded.smtp_port,smtp_security=excluded.smtp_security,smtp_user=excluded.smtp_user,smtp_secret=excluded.smtp_secret,smtp_rate_limit=excluded.smtp_rate_limit,
      smtp_verified_at=NULL,smtp_verified_revision=NULL,
      revision=email_settings.revision+1,updated_by=excluded.updated_by,updated_at=now()`;
    await audit(sql,actorId,'email.settings_saved',{enabled,provider:data.provider,credential_changed:!!data.smtp_password||data.clear_smtp_password});
    return emailSettings(sql);
  });
}
