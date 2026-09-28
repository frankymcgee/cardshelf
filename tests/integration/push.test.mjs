// Isolated database/API tests. Every delivery injects a sender; no push provider
// or real device is contacted. The app's automatic dispatcher must be paused.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createECDH,randomBytes,randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { db,closeDatabase } from '../../lib/db.mjs';
import { digest,randomToken } from '../../lib/security.mjs';
import { logout } from '../../lib/auth.mjs';
import { enquire,sendMessage } from '../../lib/marketplace.mjs';
import { setTier } from '../../lib/membership.mjs';
import { pushIdentity,pushStatus,savePushSubscription,updatePushPreferences,enqueuePush,queuePushTest,processPushOutbox } from '../../lib/push.mjs';
const base=process.env.TEST_BASE_URL,origin=process.env.APP_ORIGIN||base;
let pushBase=base,pushOrigin=origin,server;
if(process.env.ALLOW_TEST_DATABASE!=='yes'||!base||!new URL(process.env.DATABASE_URL||'http://invalid').pathname.endsWith('_test')||process.env.PUSH_WORKER_ENABLED!=='false')throw Error('Use a disposable _test database and PUSH_WORKER_ENABLED=false.');
const sql=db(),users=[],subscriptions=[],curve=createECDH('prime256v1');curve.generateKeys();
const makeSubscription=()=>({endpoint:'https://fcm.googleapis.com/fcm/send/synthetic-'+randomUUID(),keys:{p256dh:curve.getPublicKey().toString('base64url'),auth:randomBytes(16).toString('base64url')}});
async function account(){const id=randomUUID(),token=randomToken();users.push(id);await sql`INSERT INTO app_users(id,email,name,password_hash) VALUES(${id},${id+'@example.test'},'Push fixture','unused fixture hash')`;await sql`INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(${digest(token)},${id},now()+interval '1 hour')`;return {id,token};}
async function device(user,preferences={marketplace:true,membership:true}) {const subscription=makeSubscription();const response=await request('/subscribe',{user,body:{account_id:user.id,subscription,preferences}});assert.equal(response.status,200,JSON.stringify(response.data));const [row]=await sql`SELECT * FROM push_subscriptions WHERE endpoint=${subscription.endpoint}`;subscriptions.push(row.id);return {...row,subscription};}
async function request(action,{user,body,method=body?'POST':'GET',headers={}}={}){const r=await fetch(pushBase+'/api/account/push'+action,{method,headers:{Origin:pushOrigin,'X-Requested-With':'cardshelf',...(user?{Cookie:'cardshelf_session='+user.token}:{}),...(body?{'Content-Type':'application/json'}:{}),...headers},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json(),headers:r.headers};}
async function job(id){return (await sql`SELECT * FROM push_outbox WHERE id=${id}`)[0];}
async function deliver(id,send=async()=>{}) {await sql`UPDATE push_outbox SET available_at=now()+interval '1 day' WHERE subscription_id IN ${sql(subscriptions)} AND status='queued'`;await sql`UPDATE push_outbox SET available_at=now()-interval '1 second' WHERE id=${id}`;const result=await processPushOutbox({sql,origin:'https://cardshelf.example',send});return {worked:result,row:await job(id)};}
async function testJob(user,d){await queuePushTest(user.id,user.token,{endpoint:d.endpoint},sql);return (await sql`SELECT * FROM push_outbox WHERE subscription_id=${d.id} AND kind='test' ORDER BY created_at DESC LIMIT 1`)[0];}
await test('push subscriptions, real event hooks and durable device delivery',async t=>{
  const existing=await sql`SELECT id,available_at::text AS at FROM push_outbox WHERE status='queued'`;
  if(existing.length)await sql`UPDATE push_outbox SET available_at=now()+interval '2 days' WHERE id IN ${sql(existing.map(r=>r.id))}`;
  let setId,printingId;
  try {
    // Model the normal TLS-proxy deployment: local HTTP upstream, public HTTPS
    // APP_ORIGIN. Isolated port and database, with every dispatcher paused.
    const portServer=createServer();await new Promise(resolve=>portServer.listen(0,'127.0.0.1',resolve));const port=portServer.address().port;await new Promise(resolve=>portServer.close(resolve));
    pushBase='http://127.0.0.1:'+port;pushOrigin='https://cardshelf-push.example';
    server=spawn(process.execPath,['.output/server/index.mjs'],{env:{...process.env,PORT:String(port),NITRO_PORT:String(port),HOST:'127.0.0.1',APP_ORIGIN:pushOrigin},stdio:'ignore'});
    let healthy=false;for(let n=0;n<100;n++){try{if((await fetch(pushBase+'/api/health')).ok){healthy=true;break}}catch{}await new Promise(resolve=>setTimeout(resolve,100))}assert.equal(healthy,true,'Isolated push API server did not start.');
    const seller=await account(),buyer=await account(),stranger=await account();
    const one=await device(seller),two=await device(seller,{marketplace:false,membership:true}),other=await device(buyer);
    await t.test('keys persist across concurrent initialization and never appear in a response',async()=>{
      const first=await pushIdentity(sql);const copies=await Promise.all([pushIdentity(sql),pushIdentity(sql)]);
      assert.ok(copies.every(k=>k.public_key===first.public_key&&k.private_key===first.private_key));
      const response=await request('',{user:seller});assert.equal(response.status,200);assert.equal(response.data.available,true);assert.equal(response.data.public_key,first.public_key);assert.ok(!JSON.stringify(response.data).includes(first.private_key));
      const status=await request('/status',{user:seller,body:{endpoint:one.endpoint}});assert.equal(status.status,200);assert.equal(status.data.enabled,true);
      for(const secret of [one.endpoint,one.auth,one.p256dh,one.session_hash])assert.ok(!JSON.stringify(status.data).includes(secret));
    });
    await t.test('APIs enforce authentication, origin, body limit and device ownership',async()=>{
      assert.equal((await request('')).status,401);
      assert.equal((await request('/status',{body:{endpoint:one.endpoint}})).status,401);
      assert.equal((await request('/status',{user:stranger,body:{endpoint:one.endpoint}})).data.enabled,false);
      assert.equal((await request('/preferences',{user:stranger,body:{endpoint:one.endpoint,revision:1,preferences:{marketplace:false,membership:false}}})).status,409);
      assert.equal((await request('/unsubscribe',{user:stranger,body:{endpoint:one.endpoint}})).status,200);
      assert.equal((await pushStatus(seller.id,seller.token,{endpoint:one.endpoint},sql)).enabled,true);
      assert.equal((await request('/unsubscribe',{user:seller,body:{endpoint:one.endpoint},headers:{Origin:'https://evil.example'}})).status,403);
      assert.equal((await request('/subscribe',{user:seller,body:{padding:'x'.repeat(5000)}})).status,413);
      assert.equal((await request('/subscribe',{user:seller,body:{account_id:stranger.id,subscription:makeSubscription(),preferences:{marketplace:true,membership:true}}})).status,409);
      assert.equal((await request('/subscribe',{user:seller,body:{account_id:seller.id,subscription:{...makeSubscription(),endpoint:'https://127.0.0.1/push'},preferences:{marketplace:true,membership:true}}})).status,400);
      await assert.rejects(savePushSubscription(stranger.id,stranger.token,{subscription:one.subscription,preferences:{marketplace:true,membership:true}},sql),e=>e.status===409);
    });
    await t.test('device-specific preferences reject stale changes',async()=>{
      const saved=await request('/preferences',{user:seller,body:{endpoint:one.endpoint,revision:1,preferences:{marketplace:true,membership:false}}});assert.equal(saved.status,200);assert.equal(saved.data.revision,2);
      assert.equal((await request('/preferences',{user:seller,body:{endpoint:one.endpoint,revision:1,preferences:{marketplace:false,membership:true}}})).status,409);
      assert.equal((await pushStatus(seller.id,seller.token,{endpoint:two.endpoint},sql)).membership,true);
    });
    await t.test('marketplace and membership hooks enqueue only recipients and selected devices without depending on email opt-in',async()=>{
      setId='en:push-'+randomUUID();const cardId=setId+'-1';printingId=randomUUID();
      await sql`INSERT INTO card_sets(id,provider_id,language,name) VALUES(${setId},${setId.slice(3)},'en','Push fixture')`;
      await sql`INSERT INTO cards(id,provider_id,set_id,language,local_id,name) VALUES(${cardId},${cardId.slice(3)},${setId},'en','1','Push fixture')`;
      await sql`INSERT INTO printings(id,card_id,key,label,source) VALUES(${printingId},${cardId},'normal','Normal','tcgdex')`;
      const [listing]=await sql`INSERT INTO marketplace_listings(seller_id,request_id,input_hash,printing_id,seller_alias,condition,price_minor,delivery,postage_minor,region,description)
        VALUES(${seller.id},${randomUUID()},'fixture',${printingId},'Push seller','NM',100,'pickup',0,'Perth','Synthetic push fixture listing') RETURNING id`;
      const body={request_id:randomUUID(),revision:1,message:'PRIVATE ENQUIRY'};
      const thread=await enquire(buyer,listing.id,body);await enquire(buyer,listing.id,body);
      const enquiries=await sql`SELECT * FROM push_outbox WHERE event_key=${'marketplace-enquiry:'+thread.id}`;assert.equal(enquiries.length,1);assert.equal(enquiries[0].subscription_id,one.id);assert.ok(!JSON.stringify(enquiries).includes('PRIVATE'));
      let sent;await deliver(enquiries[0].id,async(subscription,payload,options)=>{sent={subscription,payload:JSON.parse(payload),options};});
      assert.equal(sent.subscription.endpoint,one.endpoint);assert.equal(sent.payload.url,'/marketplace/inbox?thread='+thread.id);assert.ok(sent.options.TTL<=3600);assert.equal(sent.options.timeout,10000);
      const reply={request_id:randomUUID(),message:'PRIVATE REPLY'};const message=await sendMessage(seller,thread.id,reply);await sendMessage(seller,thread.id,reply);
      const replies=await sql`SELECT * FROM push_outbox WHERE event_key=${'marketplace-reply:'+message.id}`;assert.equal(replies.length,1);assert.equal(replies[0].subscription_id,other.id);
      await sql`UPDATE marketplace_listings SET hidden=true WHERE id=${listing.id}`;let sends=0;
      assert.equal((await deliver(replies[0].id,async()=>sends++)).row.status,'suppressed');assert.equal(sends,0);
      await setTier(seller.id,seller.id,{tier:'plus',reason:'Synthetic push integration membership',revision:0,expires_at:null,confirm_billing_unchanged:true});
      const updates=await sql`SELECT * FROM push_outbox WHERE event_key=${'membership-assigned:'+seller.id+':1'}`;assert.equal(updates.length,1);assert.equal(updates[0].subscription_id,two.id);
      assert.equal((await sql`SELECT id FROM email_outbox WHERE user_id=${seller.id} AND kind IN ('membership_changed','marketplace_enquiry')`).length,0);
    });
    await t.test('queue is deduplicated and rechecks preferences before dispatch',async()=>{
      const event={eventKey:'push-fixture:'+randomUUID(),kind:'membership_changed',userId:seller.id};await enqueuePush(sql,event);await enqueuePush(sql,event);
      const rows=await sql`SELECT * FROM push_outbox WHERE event_key=${event.eventKey}`;assert.equal(rows.length,1);
      await updatePushPreferences(seller.id,seller.token,{endpoint:two.endpoint,revision:1,preferences:{marketplace:false,membership:false}},sql);
      let sends=0;assert.equal((await deliver(rows[0].id,async()=>sends++)).row.status,'suppressed');assert.equal(sends,0);
    });
    await t.test('test notifications target this sign-in and use durable acceptance, not a fake success toast',async()=>{
      const queued=await testJob(seller,one);let sends=0;const result=await deliver(queued.id,async(subscription,payload)=>{sends++;assert.equal(subscription.endpoint,one.endpoint);assert.equal(JSON.parse(payload).url,'/notifications');});
      assert.equal(sends,1);assert.equal(result.row.status,'accepted');assert.equal(result.row.attempts,1);
      await assert.rejects(queuePushTest(stranger.id,stranger.token,{endpoint:one.endpoint},sql),e=>e.status===409);
      for(let n=0;n<5;n++)assert.equal((await request('/test',{user:seller,body:{endpoint:one.endpoint}})).status,200);
      assert.equal((await request('/test',{user:seller,body:{endpoint:one.endpoint}})).status,429);
    });
    await t.test('transient failures retry at most three times and expired jobs are not sent',async()=>{
      const queued=await testJob(seller,one);
      for(let attempt=1;attempt<=3;attempt++){const result=await deliver(queued.id,async()=>{throw Object.assign(Error('SECRET provider detail '+one.auth),{statusCode:503})});assert.equal(result.row.status,attempt<3?'queued':'failed');assert.equal(result.row.attempts,attempt);assert.ok(!JSON.stringify(result.row).includes(one.auth));}
      const expired=await testJob(seller,one);await sql`UPDATE push_outbox SET expires_at=now()-interval '1 second' WHERE id=${expired.id}`;
      let sends=0;assert.equal((await deliver(expired.id,async()=>sends++)).row.status,'expired');assert.equal(sends,0);
    });
    await t.test('interrupted delivery lease is reclaimed and parallel workers claim once',async()=>{
      const queued=await testJob(seller,one);await sql`UPDATE push_outbox SET status='sending',attempts=1,lease_token='expired',lease_until=now()-interval '1 minute' WHERE id=${queued.id}`;
      const result=await deliver(queued.id);assert.equal(result.row.status,'accepted');assert.equal(result.row.attempts,2);
      const next=await testJob(seller,one);await sql`UPDATE push_outbox SET available_at=now()+interval '1 day' WHERE subscription_id IN ${sql(subscriptions)} AND status='queued'`;await sql`UPDATE push_outbox SET available_at=now() WHERE id=${next.id}`;
      let sends=0;const claimed=await Promise.all([1,2].map(()=>processPushOutbox({sql,origin:'https://cardshelf.example',send:async()=>{sends++;}})));assert.equal(sends,1,JSON.stringify({claimed,job:await job(next.id)}));
    });
    await t.test('gone endpoints are deleted, while permanent provider errors do not loop',async()=>{
      const permanent=await testJob(seller,one);assert.equal((await deliver(permanent.id,async()=>{throw {statusCode:403}})).row.status,'failed');
      const gone=await testJob(seller,two);await deliver(gone.id,async()=>{throw {statusCode:410}});assert.equal((await sql`SELECT id FROM push_subscriptions WHERE id=${two.id}`).length,0);
    });
    await t.test('session expiry, sign-out and account deletion revoke device delivery',async()=>{
      const pending=await testJob(buyer,other);await sql`UPDATE sessions SET expires_at=now()-interval '1 second' WHERE token_hash=${digest(buyer.token)}`;
      let sends=0;assert.equal((await deliver(pending.id,async()=>sends++)).row.status,'suppressed');assert.equal(sends,0);
      await logout(seller.token);assert.equal((await sql`SELECT id FROM push_subscriptions WHERE user_id=${seller.id}`).length,0);
      const d=await device(stranger);await testJob(stranger,d);await sql`DELETE FROM app_users WHERE id=${stranger.id}`;
      assert.equal((await sql`SELECT id FROM push_subscriptions WHERE id=${d.id}`).length,0);assert.equal((await sql`SELECT id FROM push_outbox WHERE subscription_id=${d.id}`).length,0);
    });
  }finally{
    if(server&&server.exitCode===null){server.kill('SIGTERM');await new Promise(resolve=>server.once('exit',resolve));}
    for(const row of existing)await sql`UPDATE push_outbox SET available_at=${row.at}::text::timestamptz WHERE id=${row.id}`;
    if(users.length)await sql`DELETE FROM app_users WHERE id IN ${sql(users)}`;
    if(printingId)await sql`DELETE FROM printings WHERE id=${printingId}`;
    if(setId){await sql`DELETE FROM cards WHERE set_id=${setId}`;await sql`DELETE FROM card_sets WHERE id=${setId}`;}
    await closeDatabase();
  }
});
