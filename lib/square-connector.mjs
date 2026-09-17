import { db, audit } from './db.mjs';
import { AppError, ensure } from './errors.mjs';
import * as v from './validate.mjs';
import { digest, randomToken, verifyPassword } from './security.mjs';
import { strictObject, verifyVariation } from './subscription-logic.mjs';
import { connectorRequest } from './square-connector-http.mjs';
import { connectorEnvironment, connectorKey, encryptSecret, decryptSecret, runtimePolicy,
  callbackUrl, authorizationUrl, verifiedToken, tokenResponse, refreshDue, safeConnection } from './square-connector-logic.mjs';
const lock = (sql,environment) => sql`SELECT pg_advisory_xact_lock(hashtextextended(${'square-connector:'+environment},0))`;
async function administrator(userId,password) {
  const [user]=await db()`SELECT id,role,password_hash FROM app_users WHERE id=${v.uuid(userId)}`;
  ensure(user?.role==='admin',403,'Administrator access is required.');
  if(password!==undefined)ensure(await verifyPassword(password,user.password_hash),403,'Confirm your current administrator password.');
  return user;
}
const revision = (value) => v.integer(value,'Connection revision',0,Number.MAX_SAFE_INTEGER);
async function existing(sql,environment,expected) {
  const [row]=await sql`SELECT * FROM square_connections WHERE environment=${environment}`;
  if(expected!==undefined)ensure((row?.revision??0)===revision(expected),409,'Square settings changed. Reload before continuing.');
  return row;
}
function secretInput(value,label) {
  const secret=v.text(value,label,16,4096);ensure(!/[\r\n]/.test(secret),400,'Secrets cannot contain line breaks.');return secret;
}
export async function connectorStatus(userId,environment) {
  await administrator(userId);const env=connectorEnvironment(environment),policy=runtimePolicy();
  const row=await existing(db(),env);
  const [history]=await db()`SELECT count(*)::integer AS total FROM square_subscriptions WHERE environment=${env}`;
  const status=safeConnection(row,env,policy);
  return {...status,existing_subscriptions:history.total,
    environment_credentials_configured:env===policy.environment&&policy.configured,
    // Never return any credential, ciphertext, state value or customer details.
    legacy_location_id:env===policy.environment?policy.location:'',
    legacy_merchant_id:env===policy.environment?policy.merchant:''};
}
export async function saveConnectorSetup(userId,environment,input) {
  const o=strictObject(input,['application_id','application_secret','webhook_signature_key','revision','password']);revision(o.revision);
  await administrator(userId,o.password??'');connectorKey();
  const env=connectorEnvironment(environment),appId=v.text(o.application_id,'Application ID',8,191);
  ensure(/^[A-Za-z0-9_-]+$/.test(appId),400,'Invalid Square application ID.');callbackUrl(env);
  return db().begin(async sql=>{
    await lock(sql,env);const old=await existing(sql,env,o.revision);
    ensure(!old||old.application_id===appId||!old.access_secret,409,'Disconnect before changing the Square application ID.');
    const [used]=await sql`SELECT EXISTS(SELECT 1 FROM square_customers WHERE environment=${env}) OR
      EXISTS(SELECT 1 FROM square_subscriptions WHERE environment=${env}) AS yes`;
    ensure(!old||old.application_id===appId||!used.yes,409,'This application is linked to subscription history. Keep its application ID.');
    const secret=o.application_secret?encryptSecret(secretInput(o.application_secret,'Application secret'),env,'application'):old?.application_secret;
    ensure(secret,400,'Enter the application secret for initial setup.');
    const webhook=o.webhook_signature_key?encryptSecret(secretInput(o.webhook_signature_key,'Webhook signature key'),env,'webhook'):old?.webhook_secret??null;
    await sql`INSERT INTO square_connections(environment,application_id,application_secret,webhook_secret)
      VALUES(${env},${appId},${secret},${webhook}) ON CONFLICT(environment) DO UPDATE SET
      application_id=excluded.application_id,application_secret=excluded.application_secret,webhook_secret=excluded.webhook_secret,
      webhook_seen_at=CASE WHEN square_connections.webhook_secret IS DISTINCT FROM excluded.webhook_secret THEN NULL ELSE square_connections.webhook_seen_at END,
      revision=square_connections.revision+1,refresh_retry_at=NULL,updated_at=now(),last_error=''`;
    await sql`DELETE FROM square_oauth_states WHERE environment=${env}`;
    await audit(sql,userId,'square.connector_setup_saved',{environment:env});
    return {saved:true,billing_unchanged:true};
  });
}
export async function beginSquareAuthorization(userId,sessionToken,environment,input) {
  const o=strictObject(input,['revision','password']);revision(o.revision);await administrator(userId,o.password??'');connectorKey();
  ensure(typeof sessionToken==='string'&&sessionToken.length>0,401,'Sign in again.');
  const env=connectorEnvironment(environment),state=randomToken();
  return db().begin(async sql=>{
    await lock(sql,env);const row=await existing(sql,env,o.revision);ensure(row?.application_secret,409,'Save the application settings first.');
    const url=authorizationUrl(env,row.application_id,state);
    await sql`DELETE FROM square_oauth_states WHERE expires_at<now() OR (user_id=${userId} AND environment=${env})`;
    await sql`INSERT INTO square_oauth_states(state_hash,environment,user_id,session_hash,connection_revision,expires_at)
      VALUES(${digest(state)},${env},${userId},${digest(sessionToken)},${row.revision},now()+interval '10 minutes')`;
    await audit(sql,userId,'square.authorization_started',{environment:env});return {url};
  });
}
async function inspectToken(env,token,applicationId,merchant,api) {
  const data=await api(env,'/oauth2/token/status',{token,method:'POST'});
  const identity=verifiedToken(data,applicationId,merchant);
  const {merchant:business}=await api(env,'/v2/merchants/'+encodeURIComponent(identity.merchant),{token});
  ensure(business?.id===identity.merchant,409,'Square merchant could not be verified.');
  return {...identity,name:typeof business.business_name==='string'?business.business_name.slice(0,200):identity.merchant};
}
export async function finishSquareAuthorization(userId,sessionToken,query,api=connectorRequest) {
  await administrator(userId);
  ensure(typeof query.state==='string'&&/^[a-f0-9]{64}$/.test(query.state)&&typeof sessionToken==='string',400,'Invalid Square authorization response.');
  // Consume before exchanging the code, including denials. Failed exchanges require a new flow.
  const state=await db().begin(async sql=>{
    const [row]=await sql`SELECT * FROM square_oauth_states WHERE state_hash=${digest(query.state)} FOR UPDATE`;
    ensure(row&&row.user_id===userId&&row.session_hash===digest(sessionToken)&&!row.used_at&&new Date(row.expires_at).getTime()>Date.now(),409,
      'Square authorization expired or belongs to a different session. Connect again.');
    await sql`UPDATE square_oauth_states SET used_at=now() WHERE state_hash=${row.state_hash}`;return row;
  });
  if(query.error)return {result:'denied',environment:state.environment};
  ensure(typeof query.code==='string'&&/^[A-Za-z0-9_.:-]{1,191}$/.test(query.code),400,'Square authorization code is missing.');
  return db().begin(async sql=>{
    const env=state.environment;await lock(sql,env);
    const row=await existing(sql,env,state.connection_revision);ensure(row,409,'Square configuration changed.');
    const policy=runtimePolicy(),legacy=policy.environment===env?policy:null;
    const expectedMerchant=row.merchant_id||legacy?.merchant||null;
    const data=tokenResponse(await api(env,'/oauth2/token',{body:{client_id:row.application_id,
      client_secret:decryptSecret(row.application_secret,env,'application'),grant_type:'authorization_code',code:query.code,redirect_uri:callbackUrl(env)}}),expectedMerchant);
    const identity=await inspectToken(env,data.access_token,row.application_id,data.merchant_id,api);
    // Never relink stored customer/subscription IDs to a different merchant on reconnect.
    ensure(!expectedMerchant||identity.merchant===expectedMerchant,409,'Reconnect the original Square business.');
    const [history]=await sql`SELECT EXISTS(SELECT 1 FROM square_customers WHERE environment=${env}) OR
      EXISTS(SELECT 1 FROM square_subscriptions WHERE environment=${env}) AS yes`;
    ensure(expectedMerchant||!history.yes,409,'Existing Square history has no verified merchant mapping. Restore the original server mapping before connecting.');
    const loc=row.location_id||legacy?.location||null;
    let timezone=row.timezone||legacy?.timezone||null;
    let locName=row.location_name||'';
    if(loc){
      const {locations}=await api(env,'/v2/locations',{token:data.access_token});
      const found=(locations??[]).find(l=>l.id===loc);
      validateLocation(found,identity.merchant);timezone=found.timezone;locName=String(found.name||loc).slice(0,200);
    }
    const webhook=row.webhook_secret||(legacy?.signatureKey?encryptSecret(legacy.signatureKey,env,'webhook'):null);
    await sql`UPDATE square_connections SET source='oauth',access_secret=${encryptSecret(data.access_token,env,'access')},
      refresh_secret=${encryptSecret(data.refresh_token,env,'refresh')},merchant_id=${identity.merchant},merchant_name=${identity.name},
      location_id=${loc},location_name=${locName},timezone=${timezone},webhook_secret=${webhook},scopes=${identity.scopes},
      expires_at=${data.expires_at},refreshed_at=now(),connected_at=now(),refresh_retry_at=NULL,checked_at=now(),last_error='',revision=revision+1,updated_at=now() WHERE environment=${env}`;
    await audit(sql,userId,'square.authorization_connected',{environment:env,merchant_id:identity.merchant});
    return {result:'connected',environment:env};
  });
}
function validateLocation(location,merchant) {
  ensure(location?.merchant_id===merchant&&location.status==='ACTIVE'&&location.currency==='AUD'&&typeof location.timezone==='string',409,
    'Choose an active AUD location belonging to the connected business.');
  try{new Intl.DateTimeFormat('en',{timeZone:location.timezone});}catch{throw new AppError(409,'Square location timezone is unsupported.');}
}
// Token renewal is serialised across app instances; no process-global credential cache.
export async function managedConnection(environment,refresh=true,api=connectorRequest) {
  const env=connectorEnvironment(environment),sql=db();let row=await existing(sql,env);
  if(!row||row.source!=='oauth'||!row.access_secret)return row;
  if(refresh&&refreshDue(row)){
    ensure(!row.refresh_retry_at||Date.parse(row.refresh_retry_at)<=Date.now(),503,'Square renewal is waiting to retry. Reconnect to replace the credentials.');
    const outcome=await sql.begin(async tx=>{
      await lock(tx,env);const current=await existing(tx,env);
      if(!current||current.source!=='oauth'||!refreshDue(current))return {row:current};
      if(current.refresh_retry_at&&Date.parse(current.refresh_retry_at)>Date.now())return {error:true};
      try{
        const data=tokenResponse(await api(env,'/oauth2/token',{body:{client_id:current.application_id,
          client_secret:decryptSecret(current.application_secret,env,'application'),grant_type:'refresh_token',
          refresh_token:decryptSecret(current.refresh_secret,env,'refresh')}}),current.merchant_id);
        verifiedToken(await api(env,'/oauth2/token/status',{token:data.access_token,method:'POST'}),current.application_id,current.merchant_id);
        const [updated]=await tx`UPDATE square_connections SET access_secret=${encryptSecret(data.access_token,env,'access')},
          refresh_secret=${encryptSecret(data.refresh_token,env,'refresh')},expires_at=${data.expires_at},refreshed_at=now(),
          revision=revision+1,refresh_retry_at=NULL,last_error='',updated_at=now() WHERE environment=${env} RETURNING *`;
        return {row:updated};
      }catch{
        await tx`UPDATE square_connections SET refresh_retry_at=now()+interval '15 minutes',last_error='Square token renewal failed. Check credentials or reconnect.' WHERE environment=${env}`;
        return {error:true};
      }
    });
    ensure(!outcome.error,503,'Square token renewal failed. Check credentials or reconnect.');row=outcome.row;
  }
  return row;
}
export async function resolveSquareConfiguration({refresh=false,api=connectorRequest}={}) {
  const policy=runtimePolicy(),row=await managedConnection(policy.environment,false,api);
  if(!row||row.source==='environment')return policy;
  const cfg={...policy,token:'',location:row.location_id||'',merchant:row.merchant_id||'',signatureKey:'',
    timezone:row.timezone||policy.timezone,configured:false,credential_source:row.source};
  try {
    if(row.webhook_secret)cfg.signatureKey=decryptSecret(row.webhook_secret,policy.environment,'webhook');
    if(row.source!=='oauth'||!row.access_secret)return cfg;
    const current=refresh?await managedConnection(policy.environment,true,api):row;
    if(current?.source!=='oauth'||!current.access_secret)return cfg;
    if(Date.parse(current.expires_at)>Date.now())cfg.token=decryptSecret(current.access_secret,policy.environment,'access');
    if(current.webhook_secret)cfg.signatureKey=decryptSecret(current.webhook_secret,policy.environment,'webhook');
    cfg.configured=Boolean(cfg.token&&cfg.location&&cfg.merchant&&cfg.signatureKey);
  }catch{cfg.connection_error='Square credentials need administrator attention.';}
  return cfg;
}
async function tokenFor(userId,environment,api) {
  await administrator(userId);const env=connectorEnvironment(environment),row=await managedConnection(env,true,api);
  ensure(row?.source==='oauth'&&row.access_secret&&Date.parse(row.expires_at)>Date.now(),409,'Connect Square first.');
  return {row,token:decryptSecret(row.access_secret,env,'access'),env};
}
export async function testSquareConnection(userId,environment,api=connectorRequest) {
  const {row,token,env}=await tokenFor(userId,environment,api);
  try{
    const identity=await inspectToken(env,token,row.application_id,row.merchant_id,api);
    const {locations}=await api(env,'/v2/locations',{token});
    const safe=(locations??[]).filter(l=>l.merchant_id===identity.merchant&&l.currency==='AUD'&&l.status==='ACTIVE')
      .map(l=>({id:l.id,name:String(l.name||l.id).slice(0,200),currency:l.currency,timezone:l.timezone}));
    await db()`UPDATE square_connections SET checked_at=now(),last_error='' WHERE environment=${env} AND revision=${row.revision}`;
    return {ok:true,locations:safe,subscription_created:false};
  }catch(error){
    await db()`UPDATE square_connections SET last_error='Connection check failed. Reconnect or review Square permissions.' WHERE environment=${env} AND revision=${row.revision}`;
    throw error;
  }
}
export async function chooseSquareLocation(userId,environment,input,api=connectorRequest) {
  const o=strictObject(input,['location_id','revision','password']);revision(o.revision);await administrator(userId,o.password??'');
  const {row,token,env}=await tokenFor(userId,environment,api),id=v.text(o.location_id,'Location',1,191);
  const {locations}=await api(env,'/v2/locations',{token});const location=(locations??[]).find(l=>l.id===id);validateLocation(location,row.merchant_id);
  return db().begin(async sql=>{
    await lock(sql,env);const current=await existing(sql,env,o.revision);
    ensure(current?.source==='oauth'&&current.merchant_id===row.merchant_id,409,'Square connection changed.');
    const [used]=await sql`SELECT EXISTS(SELECT 1 FROM square_subscriptions WHERE environment=${env}) OR
      EXISTS(SELECT 1 FROM square_customers WHERE environment=${env}) OR EXISTS(SELECT 1 FROM subscription_offers WHERE environment=${env} AND published) AS yes`;
    ensure(!used.yes||current.location_id===id,409,'Published offers or subscription history use the current location. It cannot be switched here.');
    await sql`UPDATE square_connections SET location_id=${id},location_name=${String(location.name||id).slice(0,200)},timezone=${location.timezone},
      revision=revision+1,updated_at=now() WHERE environment=${env}`;
    await audit(sql,userId,'square.location_selected',{environment:env,location_id:id});return {saved:true,billing_unchanged:true};
  });
}
export async function squarePlanOptions(userId,environment,cursor='',api=connectorRequest) {
  const {row,token,env}=await tokenFor(userId,environment,api);ensure(row.location_id,409,'Select the subscription location first.');
  v.text(cursor,'Cursor',0,2048);
  const query=new URLSearchParams({types:'SUBSCRIPTION_PLAN_VARIATION'});if(cursor)query.set('cursor',cursor);
  const data=await api(env,'/v2/catalog/list?'+query,{token});
  const items=(data.objects??[]).filter(o=>o.type==='SUBSCRIPTION_PLAN_VARIATION'&&!o.is_deleted).map(object=>{
    const details=object.subscription_plan_variation_data,phase=details?.phases?.[0],money=phase?.pricing?.price_money;
    const offer={variation_id:object.id,cadence:phase?.cadence,amount_minor:money?.amount};let reason='';
    try {ensure(['MONTHLY','ANNUAL'].includes(offer.cadence)&&Number.isInteger(offer.amount_minor)&&offer.amount_minor>=100&&offer.amount_minor<=10000000,409,'Only monthly or annual AUD plans in the supported price range are supported.');verifyVariation(object,offer,row.location_id);}
    catch(error){reason=error instanceof AppError?error.message:'Unsupported subscription variation.';}
    return {...offer,name:String(details?.name||object.id).slice(0,200),currency:money?.currency??'',compatible:!reason,reason};
  });
  return {items,cursor:typeof data.cursor==='string'?data.cursor:null};
}
export async function disconnectSquare(userId,environment,input,api=connectorRequest) {
  const o=strictObject(input,['revision','password','confirm_billing_unchanged','revoke_remote']);revision(o.revision);await administrator(userId,o.password??'');
  ensure(o.confirm_billing_unchanged===true,400,'Confirm that disconnecting does not cancel Square subscriptions or invoices.');
  const env=connectorEnvironment(environment),policy=runtimePolicy(),revoke=v.bool(o.revoke_remote??false,'Revoke remote authorization');
  ensure(!(env===policy.environment&&policy.enabled),409,'Disable new subscription creation on the server before disconnecting the active connection.');
  return db().begin(async sql=>{
    await lock(sql,env);const row=await existing(sql,env,o.revision);ensure(row,404,'Square connection not found.');
    const [open]=await sql`SELECT count(*)::integer AS total FROM square_subscriptions WHERE environment=${env} AND current`;
    ensure(!open.total,409,'Resolve current or pending subscriptions before disconnecting. This action does not cancel them.');
    if(revoke){
      ensure(row.merchant_id,409,'No merchant is connected.');
      const result=await api(env,'/oauth2/revoke',{clientSecret:decryptSecret(row.application_secret,env,'application'),body:{client_id:row.application_id,merchant_id:row.merchant_id,revoke_only_access_token:false}});
      ensure(result.success===true,502,'Square did not confirm revocation. Credentials were not removed locally.');
    }
    await sql`UPDATE square_connections SET source='disconnected',access_secret=NULL,refresh_secret=NULL,expires_at=NULL,
      revision=revision+1,updated_at=now(),last_error='' WHERE environment=${env}`;
    await sql`DELETE FROM square_oauth_states WHERE environment=${env}`;
    await audit(sql,userId,'square.disconnected',{environment:env,remote_revoked:revoke});
    return {disconnected:true,billing_unchanged:true,remote_authorization_revoked:revoke};
  });
}
let renewalBusy=false;
export async function renewSquareConnections(api=connectorRequest) {
  if(renewalBusy)return;renewalBusy=true;
  try{
    for(const env of ['sandbox','production']){
      try{await managedConnection(env,true,api);}catch{/* Persisted safe error is visible in administration. */}
    }
    await db()`DELETE FROM square_oauth_states WHERE expires_at<now()-interval '1 day'`;
  }finally{renewalBusy=false;}
}
