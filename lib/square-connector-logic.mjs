import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { AppError, ensure } from './errors.mjs';
import { squareConfiguration } from './subscription-logic.mjs';
export const SQUARE_SCOPES = Object.freeze([
  'MERCHANT_PROFILE_READ','CUSTOMERS_READ','CUSTOMERS_WRITE','ITEMS_READ',
  'SUBSCRIPTIONS_READ','SUBSCRIPTIONS_WRITE','ORDERS_READ','ORDERS_WRITE',
  'INVOICES_READ','INVOICES_WRITE','PAYMENTS_READ','PAYMENTS_WRITE','DISPUTES_READ'
]);
export function connectorEnvironment(value) {
  ensure(['sandbox','production'].includes(value),400,'Choose Sandbox or Production.'); return value;
}
export function connectorKey(value=process.env.CARDSHELF_INTEGRATION_KEY) {
  ensure(typeof value==='string' && /^[a-f0-9]{64}$/i.test(value),503,
    'Integration encryption key is missing. Run scripts/configure-integrations.sh on the server first.');
  return Buffer.from(value,'hex');
}
export function keyAvailable() { try { connectorKey(); return true; } catch { return false; } }
export function encryptSecret(value,environment,field,key=connectorKey()) {
  ensure(typeof value==='string' && value.length>0 && value.length<=4096,400,'Invalid secret value.');
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);
  cipher.setAAD(Buffer.from(`cardshelf:square:v1:${connectorEnvironment(environment)}:${field}`));
  const ciphertext=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);
  return ['v1',iv.toString('base64'),cipher.getAuthTag().toString('base64'),ciphertext.toString('base64')].join('.');
}
export function decryptSecret(value,environment,field,key=connectorKey()) {
  try {
    const [version,iv,tag,ciphertext,extra]=String(value).split('.');
    if(version!=='v1'||extra||!iv||!tag||!ciphertext)throw new Error();
    const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(iv,'base64'));
    decipher.setAAD(Buffer.from(`cardshelf:square:v1:${connectorEnvironment(environment)}:${field}`));
    decipher.setAuthTag(Buffer.from(tag,'base64'));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext,'base64')),decipher.final()]).toString('utf8');
  } catch { throw new AppError(503,'Stored Square credentials cannot be unlocked. Check the integration encryption key.'); }
}
export function runtimePolicy(env=process.env) {
  // Resolve stored credentials later. Loss of credentials must not lock out testers.
  const cfg=squareConfiguration({...env,MEMBERSHIP_ENFORCEMENT_ENABLED:'false'});
  cfg.enforce=env.MEMBERSHIP_ENFORCEMENT_ENABLED==='true';
  ensure(!cfg.enforce||(cfg.enabled&&cfg.environment==='production'),503,
    'Membership enforcement requires production billing to be explicitly enabled.');
  return cfg;
}
export function callbackUrl(environment,origin=process.env.APP_ORIGIN||'http://localhost:3000') {
  connectorEnvironment(environment); let u;
  try { u=new URL(origin); } catch { throw new AppError(503,'Configure a valid application origin.'); }
  ensure(!u.username&&!u.password&&!u.search&&!u.hash&&u.pathname==='/'&&
    (u.protocol==='https:'||(environment==='sandbox'&&u.protocol==='http:'&&['localhost','127.0.0.1'].includes(u.hostname))),
    503,'Square requires an HTTPS application origin (localhost is allowed for Sandbox).');
  return u.origin+'/api/admin/integrations/square/callback';
}
export const squareHost=environment=>connectorEnvironment(environment)==='production'?'https://connect.squareup.com':'https://connect.squareupsandbox.com';
export function authorizationUrl(environment,applicationId,state) {
  ensure(typeof applicationId==='string'&&/^[A-Za-z0-9_-]{8,191}$/.test(applicationId),400,'Enter the Square application ID.');
  ensure(typeof state==='string'&&/^[a-f0-9]{64}$/.test(state),400,'Invalid authorization state.');
  const u=new URL(squareHost(environment)+'/oauth2/authorize');
  u.search=new URLSearchParams({client_id:applicationId,scope:SQUARE_SCOPES.join(' '),session:'false',state,
    redirect_uri:callbackUrl(environment)}).toString();
  return u.href;
}
export function verifiedToken(data,applicationId,merchantId) {
  ensure(data?.client_id===applicationId && typeof data.merchant_id==='string' &&
    (!merchantId||data.merchant_id===merchantId),409,'Square application or merchant identity does not match.');
  ensure(Array.isArray(data.scopes)&&SQUARE_SCOPES.every(scope=>data.scopes.includes(scope)),409,
    'Square authorization is missing required permissions. Reconnect and approve the requested subscription permissions.');
  return {merchant:data.merchant_id,scopes:SQUARE_SCOPES.slice()};
}
export function tokenResponse(data,merchantId=null,now=Date.now()) {
  ensure(typeof data?.access_token==='string'&&data.access_token.length>0&&data.access_token.length<=4096&&
    typeof data.refresh_token==='string'&&data.refresh_token.length>0&&data.refresh_token.length<=4096&&
    typeof data.merchant_id==='string'&&(!merchantId||data.merchant_id===merchantId)&&
    Date.parse(data.expires_at)>now+60000&&Date.parse(data.expires_at)<now+40*86400000,
    502,'Square returned an incomplete or unexpected authorization. Reconnect.');
  return data;
}
export function refreshDue(row,now=Date.now()) {
  return row.source==='oauth'&&Boolean(row.refresh_secret)&&
    (!row.refreshed_at||now-Date.parse(row.refreshed_at)>=7*86400000||Date.parse(row.expires_at)-now<=5*86400000);
}
export function safeConnection(row,env,policy) {
  return {environment:env,revision:row?.revision??0,source:row?.source??'environment',
    connection_status:row?.source==='oauth'&&row?.access_secret?(Date.parse(row.expires_at)<=Date.now()?'expired':row.last_error?'needs_attention':'authorized'):'not_connected',
    application_id:row?.application_id??'',application_secret_saved:Boolean(row?.application_secret),
    webhook_secret_saved:Boolean(row?.webhook_secret),connected:row?.source==='oauth'&&Boolean(row?.access_secret),
    merchant_id:row?.merchant_id??'',merchant_name:row?.merchant_name??'',
    location_id:row?.location_id??'',location_name:row?.location_name??'',timezone:row?.timezone??'',
    expires_at:row?.expires_at??null,refreshed_at:row?.refreshed_at??null,checked_at:row?.checked_at??null,
    webhook_seen_at:row?.webhook_seen_at??null,last_error:row?.last_error??'',
    scopes:row?.scopes??[],key_available:keyAvailable(),callback_url:callbackUrl(env),
    webhook_url:env===policy.environment?policy.webhookUrl:(process.env.APP_ORIGIN||'http://localhost:3000')+'/api/billing/square/webhook',
    active_environment:policy.environment,billing_switch:policy.enabled,enforcement_switch:policy.enforce};
}
