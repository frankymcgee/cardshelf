import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { encryptEmailSecret,decryptEmailSecret,emailConfigurationFromRow,emailSettingsInput,postalOrigin,webhookPublicKey } from '../lib/email-settings.mjs';
import { maskedEmail,retryableEmail } from '../lib/email-admin.mjs';
const env={CARDSHELF_INTEGRATION_KEY:'ab'.repeat(32),POSTAL_ORIGIN:'https://postal.cardshelf.cloud'},secret='postal-synthetic-api-secret-123456';
const settings={revision:0,password:'current administrator password',enabled:false,sender_name:'CardShelf',from_address:'noreply@cardshelf.cloud',reply_to:'support@cardshelf.cloud',api_key:'',clear_api_key:false,dkim_selector:'',dkim_public_key:'',webhook_public_key:''};
test('Postal credentials use authenticated origin-bound encryption and fail closed on tampering',()=>{
  const encrypted=encryptEmailSecret(secret,env.POSTAL_ORIGIN,env);
  assert.ok(!encrypted.includes(secret));assert.equal(decryptEmailSecret(encrypted,env.POSTAL_ORIGIN,env),secret);
  assert.notEqual(encrypted,encryptEmailSecret(secret,env.POSTAL_ORIGIN,env));
  assert.throws(()=>decryptEmailSecret(encrypted,'https://different.cardshelf.cloud',env),/cannot be unlocked/);
  assert.throws(()=>decryptEmailSecret(encrypted,env.POSTAL_ORIGIN,{...env,CARDSHELF_INTEGRATION_KEY:'cd'.repeat(32)}),/cannot be unlocked/);
  assert.throws(()=>decryptEmailSecret(encrypted.slice(0,-4)+'AAAA',env.POSTAL_ORIGIN,env),/cannot be unlocked/);
  assert.throws(()=>encryptEmailSecret(secret,env.POSTAL_ORIGIN,{}),/CARDSHELF_INTEGRATION_KEY/);
});
test('no saved configuration and an intentionally disabled Postal configuration are distinct',()=>{
  const none=emailConfigurationFromRow(null,env),disabled=emailConfigurationFromRow({enabled:false,revision:1},env);
  assert.equal(none.exists,false);assert.equal(disabled.exists,true);assert.equal(disabled.enabled,false);assert.equal(disabled.configured,false);
  const configured=emailConfigurationFromRow({enabled:false,api_secret:encryptEmailSecret(secret,env.POSTAL_ORIGIN,env)},env);
  assert.equal(configured.configured,true);assert.equal(configured.enabled,false);
  const locked=emailConfigurationFromRow({enabled:true,api_secret:encryptEmailSecret(secret,env.POSTAL_ORIGIN,env)},{...env,CARDSHELF_INTEGRATION_KEY:''});
  assert.equal(locked.configured,false);assert.equal(locked.secret,'');assert.ok(locked.config_error);assert.ok(!JSON.stringify(locked).includes(secret));
});
test('Postal origin is deployment-pinned HTTPS with certificate verification',()=>{
  assert.equal(postalOrigin({}),'https://postal.cardshelf.cloud');
  for(const origin of ['http://postal.cardshelf.cloud','https://evil.test/path','https://u:p@postal.cardshelf.cloud','https://postal.cardshelf.cloud?key=secret','https://postal.cardshelf.cloud#fragment','https://127.0.0.1','https://localhost','https://postal.cardshelf.cloud:8443'])assert.throws(()=>postalOrigin({POSTAL_ORIGIN:origin}));
  assert.throws(()=>postalOrigin({...env,NODE_TLS_REJECT_UNAUTHORIZED:'0'}));
});
test('sender configuration rejects external addresses, header injection and client-chosen origins',()=>{
  const parsed=emailSettingsInput(settings);assert.equal(parsed.from_address,'noreply@cardshelf.cloud');assert.equal(parsed.api_key,'');
  for(const patch of [{origin:'https://attacker.test'},{from_address:'noreply@example.test'},{reply_to:'a@example.test'},{sender_name:'CardShelf\r\nBcc: a@b.test'},{from_address:'User <noreply@cardshelf.cloud>'},{api_key:'bad\r\nkey'},{api_key:secret,clear_api_key:true},{clear_api_key:'true'}])assert.throws(()=>emailSettingsInput({...settings,...patch}));
  assert.equal(emailSettingsInput({...settings,api_key:secret}).api_key,secret);
});
test('DKIM selector and expected record are public values with bounded validated formats',()=>{
  assert.equal(emailSettingsInput({...settings,dkim_selector:'postal-2026',dkim_public_key:'v=DKIM1; k=rsa; p=YWJjZA=='}).dkim_selector,'postal-2026');
  for(const patch of [{dkim_selector:'../../evil'},{dkim_selector:'postal',dkim_public_key:'private-key-material'},{dkim_public_key:'v=DKIM1; p=YWJjZA=='},{dkim_selector:'postal',dkim_public_key:'v=DKIM1;\np=YWJjZA=='}])assert.throws(()=>emailSettingsInput({...settings,...patch}));
});
test('only RSA public webhook verification keys of at least 2048 bits are retained',()=>{
  const strong=generateKeyPairSync('rsa',{modulusLength:2048}),weak=generateKeyPairSync('rsa',{modulusLength:1024});
  const publicPem=strong.publicKey.export({type:'spki',format:'pem'}).toString();
  assert.equal(webhookPublicKey(publicPem),publicPem);assert.equal(webhookPublicKey(''),'');
  assert.throws(()=>webhookPublicKey(strong.privateKey.export({type:'pkcs8',format:'pem'}).toString()),/never a private/);
  assert.throws(()=>webhookPublicKey(weak.publicKey.export({type:'spki',format:'pem'}).toString()),/2048/);
});
test('administrator metadata masks recipients and never marks resets or accepted mail retryable',()=>{
  assert.equal(maskedEmail('collector@example.test'),'c***@example.test');
  const row={source:'notification',status:'failed',provider_id:null,accepted_at:null,expires_at:'2026-12-31T00:00:00Z'};
  const now=Date.parse('2026-09-20T00:00:00Z');assert.equal(retryableEmail(row,now),true);
  for(const patch of [{source:'recovery'},{status:'accepted'},{provider_id:'123'},{accepted_at:'2026-09-19T00:00:00Z'},{expires_at:'2026-01-01T00:00:00Z'}])assert.equal(retryableEmail({...row,...patch},now),false);
});
