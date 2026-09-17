import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { connectorKey,encryptSecret,decryptSecret,authorizationUrl,callbackUrl,runtimePolicy,
  safeConnection,verifiedToken,tokenResponse,refreshDue,SQUARE_SCOPES } from '../lib/square-connector-logic.mjs';
import { connectorRequest } from '../lib/square-connector-http.mjs';
import { safeReturnTo } from '../shared/platform.mjs';
const key=Buffer.alloc(32,7),secret='not-an-actual-square-credential';
const validToken={access_token:'fixture-access',refresh_token:'fixture-refresh',merchant_id:'MERCHANT_FIXTURE',expires_at:new Date(Date.now()+30*86400000).toISOString()};
test('AES-GCM round trip uses fresh nonces and never stores plaintext',()=>{
 const a=encryptSecret(secret,'sandbox','access',key),b=encryptSecret(secret,'sandbox','access',key);
 assert.notEqual(a,b);assert.ok(!a.includes(secret));assert.equal(decryptSecret(a,'sandbox','access',key),secret);
});
test('encrypted credentials are bound to the environment and secret purpose',()=>{
 const encrypted=encryptSecret(secret,'sandbox','access',key);
 for(const [env,field] of [['production','access'],['sandbox','refresh'],['sandbox','application']])assert.throws(()=>decryptSecret(encrypted,env,field,key));
 assert.throws(()=>decryptSecret(encrypted,'sandbox','access',Buffer.alloc(32,8)));
});
test('tampered and malformed ciphertext fails closed without reflecting a secret',()=>{
 for(const value of ['raw-secret','v2.invalid.value.data',encryptSecret(secret,'sandbox','access',key).slice(0,-4)+'AAAA']){
  assert.throws(()=>decryptSecret(value,'sandbox','access',key),e=>e.status===503&&!e.message.includes(value));
 }
});
for(const key of ['','short','g'.repeat(64),'a'.repeat(63)])test('missing or malformed master key is rejected: '+String(key?.length),()=>assert.throws(()=>connectorKey(key)));
test('a missing master key is rejected',()=>{const old=process.env.CARDSHELF_INTEGRATION_KEY;try{delete process.env.CARDSHELF_INTEGRATION_KEY;assert.throws(()=>connectorKey());}finally{if(old!==undefined)process.env.CARDSHELF_INTEGRATION_KEY=old;}});
test('the master key must be 32 bytes represented as hexadecimal',()=>assert.equal(connectorKey('ab'.repeat(32)).length,32));
test('authorization URL uses fixed Square host, exact callback, state and subscription scopes',()=>{
 const u=new URL(authorizationUrl('sandbox','sandbox-sq0idb-fixture','a'.repeat(64)));
 assert.equal(u.origin,'https://connect.squareupsandbox.com');assert.equal(u.pathname,'/oauth2/authorize');
 assert.equal(u.searchParams.get('state'),'a'.repeat(64));assert.equal(u.searchParams.get('session'),'false');
 assert.deepEqual(u.searchParams.get('scope').split(' '),SQUARE_SCOPES);assert.ok(!u.searchParams.has('client_secret'));
 assert.ok(u.searchParams.get('redirect_uri').endsWith('/api/admin/integrations/square/callback'));
 assert.throws(()=>authorizationUrl('other','sandbox-sq0idb-fixture','a'.repeat(64)));
 assert.throws(()=>authorizationUrl('sandbox','https://evil.test','a'.repeat(64)));
});
test('production callback requires HTTPS without credentials, a path or injected query',()=>{
 assert.equal(callbackUrl('production','https://cards.example.test'),'https://cards.example.test/api/admin/integrations/square/callback');
 for(const origin of ['http://cards.example.test','https://name:pass@cards.example.test','https://cards.example.test/path','https://cards.example.test?x=1'])assert.throws(()=>callbackUrl('production',origin));
 assert.ok(callbackUrl('sandbox','http://localhost:3000').startsWith('http://localhost:3000/'));
});
test('setup does not automatically enable billing or enforcement',()=>{
 const p=runtimePolicy({});assert.equal(p.enabled,false);assert.equal(p.enforce,false);assert.equal(p.environment,'sandbox');
 const ready=runtimePolicy({SQUARE_ENVIRONMENT:'production',SQUARE_BILLING_ENABLED:'true',MEMBERSHIP_ENFORCEMENT_ENABLED:'true',APP_ORIGIN:'https://cards.example.test'});
 assert.equal(ready.configured,false);assert.equal(ready.enforce,true); // access grants resolve without a payment token
 assert.throws(()=>runtimePolicy({MEMBERSHIP_ENFORCEMENT_ENABLED:'true'}));
});
test('safe connector status is an allowlist and contains no credential material',()=>{
 const row={application_secret:secret,access_secret:secret,refresh_secret:secret,webhook_secret:secret,password:secret,source:'oauth',scopes:[],expires_at:validToken.expires_at};
 const status=safeConnection(row,'sandbox',runtimePolicy({}));
 assert.ok(!JSON.stringify(status).includes(secret));assert.equal(status.application_secret_saved,true);assert.equal(status.connected,true);
 for(const key of ['application_secret','access_secret','refresh_secret','webhook_secret','password'])assert.equal(Object.hasOwn(status,key),false);
});
test('permission and merchant validation reject partial or mismatched authorizations',()=>{
 const d={client_id:'app',merchant_id:'merchant',scopes:SQUARE_SCOPES};assert.equal(verifiedToken(d,'app','merchant').merchant,'merchant');
 for(const change of [{client_id:'other'},{merchant_id:'other'},{scopes:['ITEMS_READ']},{scopes:null}])assert.throws(()=>verifiedToken({...d,...change},'app','merchant'));
});
test('token responses require refresh capability, the correct merchant and a future expiry',()=>{
 assert.equal(tokenResponse(validToken,'MERCHANT_FIXTURE').access_token,'fixture-access');
 for(const change of [{refresh_token:''},{merchant_id:'other'},{expires_at:'invalid'},{expires_at:'2000-01-01'}])assert.throws(()=>tokenResponse({...validToken,...change},'MERCHANT_FIXTURE'));
});
test('token renewal occurs weekly or ahead of expiry, not on every request',()=>{
 const row={source:'oauth',refresh_secret:'encrypted',refreshed_at:new Date(),expires_at:validToken.expires_at};
 assert.equal(refreshDue(row),false);assert.equal(refreshDue({...row,refreshed_at:new Date(Date.now()-8*86400000)}),true);
 assert.equal(refreshDue({...row,expires_at:new Date(Date.now()+86400000)}),true);assert.equal(refreshDue({...row,source:'disconnected'}),false);
});
test('connector transport rejects arbitrary URLs before performing network I/O',async()=>{
 for(const path of ['https://evil.test','//evil.test','/v2/payments','/oauth2/token/../../secret','/v2/webhooks/subscriptions'])await assert.rejects(connectorRequest('sandbox',path),e=>e.status===500);
});
test('new integration page can be an internal login return but never an external redirect',()=>{
 assert.equal(safeReturnTo('/admin/integrations/square'),'/admin/integrations/square');
 assert.equal(safeReturnTo('//evil.test/admin/integrations/square'),'/app');
});
test('key setup is private, idempotent and preserves existing billing flags and credentials',async()=>{
 const root=await mkdtemp(join(tmpdir(),'cardshelf-key-'));
 try{
  await mkdir(join(root,'scripts'));await writeFile(join(root,'scripts/configure-integrations.sh'),await readFile(new URL('../scripts/configure-integrations.sh',import.meta.url)));
  const before='POSTGRES_PASSWORD=unchanged-fixture\nSQUARE_BILLING_ENABLED=false\nCARDSHELF_INTEGRATION_KEY=\n';await writeFile(join(root,'.env'),before);
  const stdout=execFileSync('sh',['scripts/configure-integrations.sh'],{cwd:root,encoding:'utf8'}),env=await readFile(join(root,'.env'),'utf8');
  const key=env.match(/^CARDSHELF_INTEGRATION_KEY=([a-f0-9]{64})$/m)?.[1];assert.ok(key);assert.ok(!stdout.includes(key));
  assert.ok(env.includes('POSTGRES_PASSWORD=unchanged-fixture'));assert.ok(env.includes('SQUARE_BILLING_ENABLED=false'));assert.equal((await stat(join(root,'.env'))).mode&0o777,0o600);
  execFileSync('sh',['scripts/configure-integrations.sh'],{cwd:root});assert.equal(await readFile(join(root,'.env'),'utf8'),env);
  await writeFile(join(root,'.env'),'CARDSHELF_INTEGRATION_KEY=bad\n');assert.throws(()=>execFileSync('sh',['scripts/configure-integrations.sh'],{cwd:root,stdio:'pipe'}));assert.equal(await readFile(join(root,'.env'),'utf8'),'CARDSHELF_INTEGRATION_KEY=bad\n');
 }finally{await rm(root,{recursive:true,force:true});}
});
