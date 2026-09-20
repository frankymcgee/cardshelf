import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync,sign,randomUUID } from 'node:crypto';
import { POSTAL_WEBHOOK_LIMIT,verifyPostalWebhook,receivePostalWebhook } from '../lib/postal-webhooks.mjs';
import { AppError } from '../lib/errors.mjs';
const keys=generateKeyPairSync('rsa',{modulusLength:2048}),pem=keys.publicKey.export({format:'pem',type:'spki'}),now=Date.parse('2026-09-20T10:00:00Z');
const message=()=>({id:123,direction:'outgoing',message_id:'cardshelf-test@cardshelf.cloud',to:'Person@Example.com',timestamp:now/1000-20,subject:'DO NOT STORE SUBJECT',token:'DO NOT STORE TOKEN'});
const event=()=>({event:'MessageSent',timestamp:now/1000,uuid:randomUUID(),payload:{status:'Sent',timestamp:now/1000,sent_with_ssl:true,message:message(),details:'DO NOT STORE DETAILS',output:'DO NOT STORE OUTPUT'}});
const signed=(value,algo='RSA-SHA256',privateKey=keys.privateKey)=>{const body=Buffer.from(typeof value==='string'?value:JSON.stringify(value));return {body,signature:sign(algo,body,privateKey).toString('base64')};};
const verifyEvent=value=>{const x=signed(value);return verifyPostalWebhook(x.body,x.signature,pem,{now});};
const fails=(fn,status)=>assert.throws(fn,e=>e instanceof AppError&&e.status===status);
test('Postal 3.3.7 exact-byte RSA SHA256 signed envelope becomes minimal sanitized delivery event',()=>{
 const result=verifyEvent(event());assert.equal(result.delivery.event,'delivered');assert.equal(result.delivery.providerId,'123');assert.equal(result.delivery.recipient,'person@example.com');assert.equal(result.delivery.sentWithSsl,true);assert.match(result.eventKey,/^[a-f0-9]{64}$/);assert.ok(!JSON.stringify(result).includes('DO NOT STORE'));
});
test('unsigned, altered, wrong-key, SHA1, malformed and noncanonical signatures fail closed',()=>{
 const x=signed(event());fails(()=>verifyPostalWebhook(x.body,undefined,pem,{now}),401);
 fails(()=>verifyPostalWebhook(Buffer.concat([x.body,Buffer.from(' ')]),x.signature,pem,{now}),401);
 fails(()=>verifyPostalWebhook(x.body,x.signature.replace(/=$/,''),pem,{now}),401);
 const sha1=signed(event(),'RSA-SHA1');fails(()=>verifyPostalWebhook(sha1.body,sha1.signature,pem,{now}),401);
 const other=generateKeyPairSync('rsa',{modulusLength:2048}),wrong=signed(event(),'RSA-SHA256',other.privateKey);fails(()=>verifyPostalWebhook(wrong.body,wrong.signature,pem,{now}),401);
 fails(()=>verifyPostalWebhook(x.body,'bad=signature',pem,{now}),401);
});
test('public key must be trusted RSA public PEM of sufficient size; never private or remote URL',()=>{
 const x=signed(event());for(const key of ['',keys.privateKey.export({format:'pem',type:'pkcs8'}),'https://attacker.example/key'])fails(()=>verifyPostalWebhook(x.body,x.signature,key,{now}),503);
 const small=generateKeyPairSync('rsa',{modulusLength:1024});fails(()=>verifyPostalWebhook(x.body,x.signature,small.publicKey.export({format:'pem',type:'spki'}),{now}),503);
});
test('bounded raw JSON and authenticated envelope shape are enforced',()=>{
 fails(()=>verifyPostalWebhook(Buffer.alloc(POSTAL_WEBHOOK_LIMIT+1),'bad',pem,{now}),413);
 const invalid=signed('{');fails(()=>verifyPostalWebhook(invalid.body,invalid.signature,pem,{now}),400);
 for(const change of [{uuid:'not-uuid'},{timestamp:'123'},{payload:[]},{event:4}])fails(()=>verifyEvent({...event(),...change}),400);
});
test('stale/future payloads and inconsistent timestamps are rejected while Postal retries preserve old creation time',()=>{
 for(const seconds of [now/1000-86401,now/1000+301])fails(()=>verifyEvent({...event(),timestamp:seconds}),400);
 const recent=event();recent.timestamp-=2400;recent.payload.timestamp-=2400;recent.payload.message.timestamp-=2400;assert.equal(verifyEvent(recent).delivery.event,'delivered');
 const mismatched=event();mismatched.payload.timestamp-=301;fails(()=>verifyEvent(mismatched),400);
});
test('incoming mail, mismatched status, malformed IDs and security values are rejected',()=>{
 for(const changes of [{id:'123'},{id:0},{direction:'incoming'},{message_id:'<identifier>'},{to:'bad\nrecipient@example.com'},{timestamp:'invalid'}]){const e=event();Object.assign(e.payload.message,changes);fails(()=>verifyEvent(e),400);}
 const mismatch=event();mismatch.payload.status='HardFail';fails(()=>verifyEvent(mismatch),400);
 const badTls=event();badTls.payload.sent_with_ssl='true';fails(()=>verifyEvent(badTls),400);
});
test('bounces correlate original outgoing message, final failure is distinct, delayed and held remain accepted',()=>{
 const bounce={...event(),event:'MessageBounced',payload:{original_message:message(),bounce:{timestamp:now/1000,subject:'PRIVATE BOUNCE'}}};const b=verifyEvent(bounce);assert.equal(b.delivery.event,'bounced');assert.equal(b.delivery.providerId,'123');assert.equal(b.delivery.sentWithSsl,null);
 for(const [name,status,expected]of [['MessageDeliveryFailed','HardFail','failed'],['MessageDelayed','SoftFail','accepted'],['MessageHeld','Held','accepted']]){const e=event();e.event=name;e.payload.status=status;assert.equal(verifyEvent(e).delivery.event,expected);}
});
test('authenticated unrelated Postal events are ignored without retaining their payload',()=>{
 const e=event();e.event='MessageLoaded';e.payload={secret:'do not store'};assert.deepEqual(Object.keys(verifyEvent(e)).sort(),['eventKey','ignored']);
});
function fixtureSql(){const receipts=new Map();const sql={begin:async run=>{const draft=new Map(receipts);const tx=async(_strings,key,provider)=>{if(draft.has(key))return [];draft.set(key,provider);return [{event_key:key}];};try{const result=await run(tx);receipts.clear();for(const [k,v]of draft)receipts.set(k,v);return result;}catch(e){throw e;}}};return {sql,receipts};}
test('receipt and delivery apply are atomic; provider persistence races get503 and can retry',async()=>{
 const {sql,receipts}=fixtureSql(),x=signed(event()),opts={sql,configuration:{webhook_public_key:pem},now};
 await assert.rejects(receivePostalWebhook(x.body,x.signature,{...opts,applyDelivery:async()=>({matched:false})}),e=>e.status===503);assert.equal(receipts.size,0);
 let calls=0;const applyDelivery=async delivery=>{calls++;assert.equal(delivery.event,'delivered');return {matched:true};};
 assert.deepEqual(await receivePostalWebhook(x.body,x.signature,{...opts,applyDelivery}),{received:true});assert.equal(receipts.size,1);
 assert.deepEqual(await receivePostalWebhook(x.body,x.signature,{...opts,applyDelivery}),{received:true,duplicate:true});assert.equal(calls,1);
});
test('unexpected queue/storage failures expose no sensitive error values and keep event retryable',async()=>{
 const {sql,receipts}=fixtureSql(),x=signed(event());await assert.rejects(receivePostalWebhook(x.body,x.signature,{sql,configuration:{webhook_public_key:pem},now,applyDelivery:async()=>{throw Error('PRIVATE MESSAGE AND RECIPIENT');}}),e=>e.status===503&&!e.message.includes('PRIVATE'));assert.equal(receipts.size,0);
});
