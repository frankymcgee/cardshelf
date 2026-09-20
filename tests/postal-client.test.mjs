import test from 'node:test';
import assert from 'node:assert/strict';
import { postalSend } from '../lib/postal-client.mjs';
import { postalOrigin } from '../lib/email-settings.mjs';
const cfg={enabled:true,configured:true,origin:postalOrigin(),secret:'postal-synthetic-api-secret-123456',sender_name:'CardShelf',from_address:'noreply@cardshelf.cloud',reply_to:'support@cardshelf.cloud'};
const email='collector@example.test',message={subject:'CardShelf test',text:'A synthetic test notification.'};
const accepted=()=>new Response(JSON.stringify({status:'success',data:{message_id:'postal-fixture@cardshelf.cloud',messages:{[email]:{id:123,token:'private-provider-token'}}}}),{status:200});
test('Postal sends a single text-only recipient to its exact HTTPS endpoint',async()=>{
  let seen;
  const result=await postalSend(cfg,email,message,{fetch:async(url,options)=>{seen={url,options};return accepted();},tag:'cardshelf-test'});
  assert.equal(seen.url,cfg.origin+'/api/v1/send/message');assert.equal(seen.options.redirect,'error');assert.ok(seen.options.signal);
  assert.equal(seen.options.headers['X-Server-API-Key'],cfg.secret);
  const body=JSON.parse(seen.options.body);assert.deepEqual(body.to,[email]);assert.equal(body.plain_body,message.text);assert.equal(body.reply_to,cfg.reply_to);
  assert.equal('html_body' in body,false);assert.equal('attachments' in body,false);assert.equal('bcc' in body,false);
  assert.deepEqual(result,{provider_id:'123',message_id:'postal-fixture@cardshelf.cloud'});assert.ok(!JSON.stringify(result).includes('private-provider-token'));
});
test('bad origin, header injection, recipients and disabled delivery never reach the network',async()=>{
  let calls=0;const options={fetch:async()=>{calls++;return accepted();}};
  for(const config of [{...cfg,origin:'https://attacker.test'},{...cfg,enabled:false},{...cfg,configured:false},{...cfg,from_address:'attacker@example.test'}])await assert.rejects(postalSend(config,email,message,options));
  await assert.rejects(postalSend(cfg,'a@example.test,b@example.test',message,options));
  await assert.rejects(postalSend(cfg,email,{...message,subject:'Subject\r\nBcc: other@example.test'},options));
  await assert.rejects(postalSend(cfg,email,{...message,text:'x'.repeat(60001)},options));
  assert.equal(calls,0);
});
test('Postal response errors, oversized responses and network exceptions are sanitized',async()=>{
  const secret='PROVIDER BODY SECRET must never leak';
  for(const fetch of [
    async()=>new Response(secret,{status:401}),
    async()=>new Response(JSON.stringify({status:'error',data:{message:secret}})),
    async()=>new Response(secret),
    async()=>new Response('x'.repeat(65537)),
    async()=>{throw new Error(secret);},
    async()=>new Response(JSON.stringify({status:'success',data:{message_id:'id',messages:{'different@example.test':{id:1}}}}))
  ])await assert.rejects(postalSend(cfg,email,message,{fetch}),error=>error.status===502&&!error.message.includes(secret));
});
