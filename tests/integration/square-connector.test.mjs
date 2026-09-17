// Provider calls below are injected contracts. Never use real merchant credentials.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID,createHmac } from 'node:crypto';
import '../helpers/block-square-network.mjs';
import { db,closeDatabase } from '../../lib/db.mjs';
import { hashPassword,randomToken,digest } from '../../lib/security.mjs';
import { membershipState } from '../../lib/membership.mjs';
import { receiveSquareWebhook } from '../../lib/square-webhooks.mjs';
import * as connector from '../../lib/square-connector.mjs';
import { SQUARE_SCOPES,decryptSecret } from '../../lib/square-connector-logic.mjs';
const base=process.env.TEST_BASE_URL;
if(process.env.ALLOW_TEST_DATABASE!=='yes'||!base||!new URL(process.env.DATABASE_URL||'http://invalid').pathname.endsWith('_test'))throw new Error('Use only the disposable _test database.');
const sql=db(),before={...process.env},admin=randomUUID(),user=randomUUID(),session=randomToken(),userSession=randomToken();
const password='Connector fixture password only 123',app='sandbox-sq0idb-connector-fixture',secret='fixture-application-secret-only',signature='fixture-webhook-signature-only';
let calls=[],merchant='MERCHANT_FIXTURE',grantedScopes=SQUARE_SCOPES,refreshFailure=false;
const provider=async(env,path,options={})=>{
 calls.push({env,path,grant:options.body?.grant_type});
 if(path==='/oauth2/token'){
  if(refreshFailure)throw new Error('Simulated unavailable provider');
  return {access_token:'fixture-access-'+randomUUID(),refresh_token:'fixture-refresh-only',merchant_id:merchant,expires_at:new Date(Date.now()+30*86400000).toISOString()};
 }
 if(path==='/oauth2/token/status')return {client_id:app,merchant_id:merchant,scopes:grantedScopes};
 if(path.startsWith('/v2/merchants/'))return {merchant:{id:merchant,business_name:'Fixture Square Business'}};
 if(path==='/v2/locations')return {locations:[{id:'LOC_FIXTURE',name:'Fixture AUD',merchant_id:merchant,currency:'AUD',status:'ACTIVE',timezone:'Australia/Perth'}, {id:'USD_FIXTURE',merchant_id:merchant,currency:'USD',status:'ACTIVE',timezone:'America/New_York'}]};
 if(path.startsWith('/v2/catalog/list?'))return {objects:[{type:'SUBSCRIPTION_PLAN_VARIATION',id:'PLAN_FIXTURE',present_at_all_locations:true,subscription_plan_variation_data:{name:'Fixture monthly',phases:[{cadence:'MONTHLY',pricing:{type:'STATIC',price_money:{amount:1200,currency:'AUD'}}}]}}, {type:'SUBSCRIPTION_PLAN_VARIATION',id:'PLAN_UNSUPPORTED',subscription_plan_variation_data:{name:'Variable'}}]};
 if(path==='/oauth2/revoke')return {success:true};
 throw new Error('Unexpected connector provider endpoint');
};
const status=()=>connector.connectorStatus(admin,'sandbox');
async function request(path,{method='GET',body,asAdmin=true,origin=base}={}){
 const r=await fetch(base+path,{method,redirect:'manual',headers:{Origin:origin,'X-Requested-With':'cardshelf',Cookie:'cardshelf_session='+(asAdmin?session:userSession),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
 const text=await r.text();let data;try{data=JSON.parse(text)}catch{data=text}return {status:r.status,data,headers:r.headers};
}
async function authorize(){const s=await status(),r=await connector.beginSquareAuthorization(admin,session,'sandbox',{revision:s.revision,password});return new URL(r.url).searchParams.get('state');}
await test('administrator Square connector and encrypted credential lifecycle',async t=>{
 try{
  Object.assign(process.env,{CARDSHELF_INTEGRATION_KEY:'ab'.repeat(32),SQUARE_ENVIRONMENT:'sandbox',SQUARE_BILLING_ENABLED:'false',MEMBERSHIP_ENFORCEMENT_ENABLED:'false',SQUARE_ACCESS_TOKEN:'',SQUARE_MERCHANT_ID:'',SQUARE_LOCATION_ID:'',SQUARE_WEBHOOK_SIGNATURE_KEY:'',SQUARE_WEBHOOK_URL:'',APP_ORIGIN:'http://localhost:3000'});
  const hash=await hashPassword(password);
  for(const [id,role,token] of [[admin,'admin',session],[user,'user',userSession]]){
   await sql`INSERT INTO app_users(id,email,name,password_hash,role) VALUES(${id},${id+'@example.test'},'Connector fixture',${hash},${role})`;
   await sql`INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(${digest(token)},${id},now()+interval '1 hour')`;
  }
  await t.test('HTTP endpoints reject non-admin reads and cross-origin writes',async()=>{
   assert.equal((await request('/api/admin/integrations/square/status',{asAdmin:false})).status,403);
   assert.equal((await request('/api/admin/integrations/square/setup',{method:'POST',body:{},origin:'https://evil.test'})).status,403);
   const response=await request('/api/admin/integrations/square/status');assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/no-store/);
  });
  await t.test('setup requires reauthentication and rejects billing-switch injection',async()=>{
   await assert.rejects(connector.saveConnectorSetup(user,'sandbox',{application_id:app,application_secret:secret,revision:0,password}),e=>e.status===403);
   await assert.rejects(connector.saveConnectorSetup(admin,'sandbox',{application_id:app,application_secret:secret,revision:0,password:'incorrect'}),e=>e.status===403);
   await assert.rejects(connector.saveConnectorSetup(admin,'sandbox',{application_id:app,application_secret:secret,revision:0,password,billing_enabled:true}),e=>e.status===400);
   await connector.saveConnectorSetup(admin,'sandbox',{application_id:app,application_secret:secret,webhook_signature_key:signature,revision:0,password});
   const [row]=await sql`SELECT * FROM square_connections WHERE environment='sandbox'`;
   assert.ok(!JSON.stringify(row).includes(secret));assert.equal(decryptSecret(row.application_secret,'sandbox','application'),secret);
   const safe=await status();assert.ok(!JSON.stringify(safe).includes(signature));assert.equal(safe.source,'environment');assert.equal(safe.billing_switch,false);
  });
  await t.test('omitted revisions cannot bypass settings or disconnect concurrency checks',async()=>{
   await assert.rejects(connector.saveConnectorSetup(admin,'sandbox',{application_id:app,password}),e=>e.status===400);
   await assert.rejects(connector.beginSquareAuthorization(admin,session,'sandbox',{password}),e=>e.status===400);
   await assert.rejects(connector.chooseSquareLocation(admin,'sandbox',{location_id:'LOC_FIXTURE',password},provider),e=>e.status===400);
   await assert.rejects(connector.disconnectSquare(admin,'sandbox',{password,confirm_billing_unchanged:true},provider),e=>e.status===400);
  });
  await t.test('OAuth states are hashed, session-bound, one-use and expired states fail before provider calls',async()=>{
   const state=await authorize(),[stored]=await sql`SELECT * FROM square_oauth_states WHERE environment='sandbox'`;
   assert.equal(stored.state_hash,digest(state));assert.notEqual(stored.session_hash,session);
   await assert.rejects(connector.finishSquareAuthorization(admin,'different-session',{state,code:'fixture-code'},provider),e=>e.status===409);
   await sql`UPDATE square_oauth_states SET expires_at=now()-interval '1 second' WHERE state_hash=${digest(state)}`;
   await assert.rejects(connector.finishSquareAuthorization(admin,session,{state,code:'fixture-code'},provider),e=>e.status===409);assert.equal(calls.length,0);
   const valid=await authorize();assert.equal((await connector.finishSquareAuthorization(admin,session,{state:valid,code:'fixture-code'},provider)).result,'connected');
   await assert.rejects(connector.finishSquareAuthorization(admin,session,{state:valid,code:'fixture-code'},provider),e=>e.status===409);
   assert.equal(calls.filter(c=>c.grant==='authorization_code').length,1);
  });
  await t.test('status omits ciphertext and secrets; connection alone does not enable billing',async()=>{
   const safe=await status();assert.equal(safe.connected,true);assert.equal(safe.merchant_id,'MERCHANT_FIXTURE');assert.equal(safe.billing_switch,false);assert.equal(safe.enforcement_switch,false);
   for(const field of ['application_secret','access_secret','refresh_secret','webhook_secret'])assert.equal(Object.hasOwn(safe,field),false);
   assert.equal((await connector.resolveSquareConfiguration()).configured,false); // no location yet
   const [row]=await sql`SELECT * FROM square_connections WHERE environment='sandbox'`;assert.ok(!row.access_secret.includes('fixture-access'));
  });
  await t.test('connection probes are read-only and only active AUD locations can be selected',async()=>{
   const result=await connector.testSquareConnection(admin,'sandbox',provider);assert.equal(result.locations.length,1);assert.equal(result.subscription_created,false);
   await assert.rejects(connector.chooseSquareLocation(admin,'sandbox',{location_id:'USD_FIXTURE',revision:(await status()).revision,password},provider),e=>e.status===409);
   await connector.chooseSquareLocation(admin,'sandbox',{location_id:'LOC_FIXTURE',revision:(await status()).revision,password},provider);
   const cfg=await connector.resolveSquareConfiguration();assert.equal(cfg.location,'LOC_FIXTURE');assert.equal(cfg.timezone,'Australia/Perth');assert.equal(cfg.configured,true);assert.equal(cfg.enabled,false);
  });
  await t.test('Square plan discovery marks incompatible variations without publishing an offer',async()=>{
   const plans=await connector.squarePlanOptions(admin,'sandbox','',provider);assert.equal(plans.items[0].compatible,true);assert.equal(plans.items[1].compatible,false);
   assert.equal(plans.items[0].amount_minor,1200);
   assert.equal((await sql`SELECT count(*)::integer AS n FROM subscription_offers WHERE variation_id='PLAN_FIXTURE'`)[0].n,0);
  });
  await t.test('stale setup edits, missing scopes and a different merchant cannot replace the connection',async()=>{
   await assert.rejects(connector.saveConnectorSetup(admin,'sandbox',{application_id:app,revision:0,password}),e=>e.status===409);
   let state=await authorize();merchant='DIFFERENT_MERCHANT';await assert.rejects(connector.finishSquareAuthorization(admin,session,{state,code:'fixture-code'},provider));merchant='MERCHANT_FIXTURE';
   state=await authorize();grantedScopes=['ITEMS_READ'];await assert.rejects(connector.finishSquareAuthorization(admin,session,{state,code:'fixture-code'},provider));grantedScopes=SQUARE_SCOPES;
   assert.equal((await status()).merchant_id,'MERCHANT_FIXTURE');assert.equal((await status()).connected,true);
   state=await authorize();assert.equal((await connector.finishSquareAuthorization(admin,session,{state,error:'access_denied'},provider)).result,'denied');assert.equal((await status()).connected,true);
  });
  await t.test('concurrent token refresh is serialized and failures retain encrypted credentials with a retry delay',async()=>{
   await sql`UPDATE square_connections SET refreshed_at=now()-interval '8 days' WHERE environment='sandbox'`;
   const before=calls.filter(c=>c.grant==='refresh_token').length;
   await Promise.all([connector.managedConnection('sandbox',true,provider),connector.managedConnection('sandbox',true,provider)]);
   assert.equal(calls.filter(c=>c.grant==='refresh_token').length,before+1);
   await sql`UPDATE square_connections SET refreshed_at=now()-interval '8 days' WHERE environment='sandbox'`;refreshFailure=true;
   await assert.rejects(connector.managedConnection('sandbox',true,provider));refreshFailure=false;
   const [row]=await sql`SELECT * FROM square_connections WHERE environment='sandbox'`;assert.ok(row.access_secret);assert.ok(row.refresh_secret);assert.ok(row.refresh_retry_at);assert.ok(row.last_error);
   await sql`UPDATE square_connections SET refresh_retry_at=NULL WHERE environment='sandbox'`;await connector.managedConnection('sandbox',true,provider);
  });
  await t.test('missing encryption key does not revoke tester access or leak a secret',async()=>{
   delete process.env.CARDSHELF_INTEGRATION_KEY;const cfg=await connector.resolveSquareConfiguration();assert.equal(cfg.configured,false);
   const member=await membershipState(user);assert.equal(member.access.allowed,true);assert.equal(member.access.payment_required,false);
   process.env.CARDSHELF_INTEGRATION_KEY='ab'.repeat(32);
  });
  await t.test('OAuth callback rejects an unrelated session with a fixed, code-free redirect',async()=>{
   const response=await request('/api/admin/integrations/square/callback?state='+ 'b'.repeat(64)+'&code=must-not-be-reflected');
   assert.equal(response.status,303);assert.equal(response.headers.get('location'),'/admin/integrations/square?result=error');
   assert.ok(!String(response.data).includes('must-not-be-reflected'));
  });
  await t.test('signed webhook delivery is recorded; older revocation events cannot erase a new authorization',async()=>{
   const payload={event_id:randomUUID(),merchant_id:'MERCHANT_FIXTURE',type:'oauth.authorization.revoked',created_at:'2020-01-01T00:00:00Z',data:{object:{revocation:{revoked_at:'2020-01-01T00:00:00Z'}}}};
   const raw=Buffer.from(JSON.stringify(payload)),sig=createHmac('sha256',signature).update('http://localhost:3000/api/billing/square/webhook').update(raw).digest('base64');
   await assert.rejects(receiveSquareWebhook(raw,'bad'),e=>e.status===403);await receiveSquareWebhook(raw,sig);
   assert.equal((await status()).connected,true);assert.ok((await status()).webhook_seen_at);
  });
  await t.test('disconnect is explicit, disables stale environment fallback and preserves free access',async()=>{
   process.env.SQUARE_ACCESS_TOKEN='obsolete-environment-token';process.env.SQUARE_MERCHANT_ID='MERCHANT_FIXTURE';process.env.SQUARE_LOCATION_ID='LOC_FIXTURE';process.env.SQUARE_WEBHOOK_SIGNATURE_KEY=signature;
   await assert.rejects(connector.disconnectSquare(admin,'sandbox',{revision:(await status()).revision,password,confirm_billing_unchanged:false}),e=>e.status===400);
   await connector.disconnectSquare(admin,'sandbox',{revision:(await status()).revision,password,confirm_billing_unchanged:true},provider);
   assert.equal((await connector.resolveSquareConfiguration()).token,'');assert.equal((await status()).source,'disconnected');
   assert.equal((await membershipState(user)).access.allowed,true);
   assert.ok(!calls.some(c=>c.path==='/oauth2/revoke'));
  });
  await t.test('remote revocation requires its explicit option and confirms success before deleting local tokens',async()=>{
   const state=await authorize();await connector.finishSquareAuthorization(admin,session,{state,code:'fixture-code'},provider);
   const result=await connector.disconnectSquare(admin,'sandbox',{revision:(await status()).revision,password,confirm_billing_unchanged:true,revoke_remote:true},provider);
   assert.equal(result.remote_authorization_revoked,true);assert.equal(calls.filter(c=>c.path==='/oauth2/revoke').length,1);
   assert.ok(!calls.some(c=>/^\/v2\/(?:subscriptions|customers|payments|refunds)/.test(c.path)));
  });
 } finally {
   await sql`DELETE FROM square_webhook_events WHERE event_type='oauth.authorization.revoked' AND environment='sandbox'`;
   await sql`DELETE FROM square_oauth_states WHERE user_id IN (${admin},${user})`;
   await sql`DELETE FROM square_connections WHERE application_id=${app}`;
   await sql`DELETE FROM app_users WHERE id IN (${admin},${user})`;
   for(const key of Object.keys(process.env))if(!Object.hasOwn(before,key))delete process.env[key];Object.assign(process.env,before);await closeDatabase();
 }
});
