// Isolated HTTP + PostgreSQL integration. The background dispatcher must be
// paused; every manual worker call below injects a recording sender. No real
// Postal, SMTP or external mailbox is contacted.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, generateKeyPairSync, sign } from 'node:crypto';
import postgres from 'postgres';
import sharp from 'sharp';
import { hashPassword, randomToken, digest } from '../../lib/security.mjs';
import { closeDatabase } from '../../lib/db.mjs';
import { enqueueEmail, processEmailOutbox } from '../../lib/email-outbox.mjs';
import { recoveryDeliveryStatus } from '../../lib/password-recovery-mail.mjs';

const base=process.env.TEST_BASE_URL,url=process.env.DATABASE_URL;
if(process.env.ALLOW_TEST_DATABASE!=='yes'||!base||!new URL(url||'http://invalid').pathname.endsWith('_test')||process.env.EMAIL_WORKER_ENABLED!=='false')throw Error('Use a disposable _test database and pause EMAIL_WORKER_ENABLED before running email tests.');
if(!/^[a-f0-9]{64}$/i.test(process.env.CARDSHELF_INTEGRATION_KEY||''))throw Error('Provide a synthetic integration encryption key.');
const sql=postgres(url,{max:2}),origin=process.env.APP_ORIGIN||base;
const password='Synthetic CardShelf email integration password 123',apiKey='synthetic-postal-secret-'+randomUUID(),users=[];
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const publicPem=publicKey.export({type:'spki',format:'pem'}).toString();
async function request(path,{user,method='GET',body,raw,headers={}}={}){
  const response=await fetch(base+path,{method,redirect:'manual',headers:{...(!path.startsWith('/api/webhooks/')?{Origin:origin,'X-Requested-With':'cardshelf'}:{}),...(user?{Cookie:user.cookie}:{}),...(body===undefined&&raw===undefined?{}:{'Content-Type':'application/json'}),...headers},body:raw??(body===undefined?undefined:JSON.stringify(body))});
  const text=await response.text();let data;try{data=JSON.parse(text);}catch{data=text;}
  return {status:response.status,data,headers:response.headers};
}
async function account(name,role='user'){
  const id=randomUUID(),token=randomToken(),email=id+'@example.test';users.push(id);
  await sql`INSERT INTO app_users(id,email,name,password_hash,role) VALUES(${id},${email},${name},${await hashPassword(password)},${role})`;
  await sql`INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(${digest(token)},${id},now()+interval '1 hour')`;
  return {id,email,cookie:'cardshelf_session='+token};
}
function assertSecretFree(value){const text=JSON.stringify(value);for(const secret of [apiKey,password,process.env.CARDSHELF_INTEGRATION_KEY])assert.ok(!text.includes(secret),'A credential appeared in a response or record.');}

await test('Postal settings, personal preferences, queue hooks and authenticated delivery events',async t=>{
  const previousSettings=await sql`SELECT * FROM email_settings`;
  const smtpKeys=['RECOVERY_EMAIL_ENABLED','SMTP_HOST','SMTP_FROM','SMTP_PORT','SMTP_SECURITY','SMTP_USER','SMTP_PASSWORD'];
  const oldSmtp=Object.fromEntries(smtpKeys.map(key=>[key,process.env[key]]));
  let admin,guardAdmin,sender,buyer,outsider,settings,setId,printingId,listingId,threadId;
  const existingUserId=randomUUID();let existingQueued=[];
  const eventIds=[],recorded=[];
  const queueEvent=async(kind,user,payload={})=>{
    const eventKey='integration-email:'+randomUUID();await enqueueEmail(sql,{eventKey,kind,userId:user.id,payload});
    const [job]=await sql`SELECT * FROM email_outbox WHERE event_key=${eventKey}`;assert.ok(job,'Expected a queued email');return job;
  };
  const jobById=async id=>(await sql`SELECT * FROM email_outbox WHERE id=${id}`)[0];
  const onlyJob=async id=>{await sql`UPDATE email_outbox SET available_at=now()+interval '1 day' WHERE user_id IN ${sql(users)} AND status='queued'`;await sql`UPDATE email_outbox SET available_at=now()-interval '1 second' WHERE id=${id}`;};
  async function deliver(job,send){await onlyJob(job.id);assert.equal(await processEmailOutbox({sql,origin,send:send||(async(address,message,options)=>{recorded.push({address,message,options});const provider_id=String(100000+recorded.length);return {provider:'postal',provider_id,message_id:options.messageId.slice(1,-1)};})}),true);return jobById(job.id);}
  async function save(changes={},actor=admin){
    const current=await request('/api/admin/emails',{user:actor});assert.equal(current.status,200,JSON.stringify(current.data));
    const body={revision:current.data.settings.revision,password,enabled:current.data.settings.enabled,sender_name:'CardShelf',from_address:'noreply@cardshelf.cloud',reply_to:'',api_key:'',clear_api_key:false,dkim_selector:'',dkim_public_key:'',webhook_public_key:publicPem,...changes};
    const response=await request('/api/admin/emails/settings',{user:actor,method:'POST',body});assert.equal(response.status,200,JSON.stringify(response.data));
    settings=(await request('/api/admin/emails',{user:actor})).data.settings;return response;
  }
  async function preferences(user,changes){const current=await request('/api/emails/preferences',{user});assert.equal(current.status,200);const response=await request('/api/emails/preferences',{user,method:'PATCH',body:{...current.data,...changes}});assert.equal(response.status,200,JSON.stringify(response.data));return response.data;}
  async function webhook(event,patch={},options={}){
    const now=Math.floor(Date.now()/1000),uuid=randomUUID();eventIds.push(uuid);
    const message={id:Number(event.provider_id),direction:'outgoing',message_id:event.message_id,to:event.email,timestamp:now};
    const payload={event:'MessageSent',timestamp:now,uuid,payload:{message,status:'Sent',timestamp:now,sent_with_ssl:true},...patch};
    const raw=JSON.stringify(payload),signature=sign('RSA-SHA256',Buffer.from(raw),privateKey).toString('base64');
    return {payload,raw,signature,response:await request('/api/webhooks/postal',{method:'POST',raw,headers:{'X-Postal-Signature-256':signature,...options.headers}})};
  }
  try{
    await sql`DELETE FROM email_settings`;
    // Other integration files deliberately retain their accounts. Password
    // changes now leave due security notifications for those accounts, so the
    // real FIFO worker must not be assumed to pick this suite's newest job.
    // Seed that situation even when this file is run by itself, including
    // microseconds that cannot survive conversion through a JavaScript Date.
    await sql`INSERT INTO app_users(id,email,name,password_hash) VALUES(${existingUserId},${existingUserId+'@example.test'},'Existing queued recipient',${await hashPassword(password)})`;
    await sql`INSERT INTO email_outbox(event_key,kind,user_id,available_at,created_at)
      VALUES(${'existing-email:'+randomUUID()},'password_changed',${existingUserId},date_trunc('second',now())-interval '1 hour'+interval '0.123456 seconds',now()-interval '1 hour')`;
    existingQueued=await sql`SELECT *,available_at::text AS original_available_at FROM email_outbox WHERE status='queued' ORDER BY id`;
    // Temporarily isolate fixture scheduling; keep production claiming global
    // and restore the original timestamps (including microseconds) in finally.
    await sql`UPDATE email_outbox SET available_at=now()+interval '1 day' WHERE id IN ${sql(existingQueued.map(row=>row.id))}`;
    admin=await account('Email administrator','admin');guardAdmin=await account('Email security administrator','admin');sender=await account('Marketplace seller');buyer=await account('Marketplace buyer');outsider=await account('Independent member');
    await t.test('email endpoints require login and administration stays role-protected',async()=>{
      for(const path of ['/api/admin/emails','/api/admin/emails/diagnostics','/api/emails/preferences']){const r=await request(path);assert.equal(r.status,401,path);assert.match(r.headers.get('content-type'),/json/);}
      assert.equal((await request('/api/admin/emails',{user:sender})).status,403);
      assert.equal((await request('/api/admin/emails/diagnostics',{user:sender})).status,403);
      const status=await request('/api/admin/emails',{user:admin});assert.equal(status.status,200);assert.equal(status.data.settings.exists,false);assert.equal(status.data.settings.enabled,false);assertSecretFree(status.data);
    });
    await t.test('legacy SMTP is considered only before Postal settings have been saved',async()=>{
      Object.assign(process.env,{RECOVERY_EMAIL_ENABLED:'true',SMTP_HOST:'smtp.example.test',SMTP_FROM:'legacy@example.test',SMTP_PORT:'587',SMTP_SECURITY:'starttls',SMTP_USER:'',SMTP_PASSWORD:''});
      const status=await recoveryDeliveryStatus(sql);assert.equal(status.provider,'smtp');assert.equal(status.configured,true);
    });
    await t.test('settings require password reauthentication, same origin and exact fields',async()=>{
      const current=(await request('/api/admin/emails',{user:admin})).data.settings;
      const body={revision:current.revision,password,enabled:true,sender_name:'CardShelf',from_address:'noreply@cardshelf.cloud',reply_to:'',api_key:apiKey,clear_api_key:false,dkim_selector:'',dkim_public_key:'',webhook_public_key:publicPem};
      assert.equal((await request('/api/admin/emails/settings',{user:sender,method:'POST',body})).status,403);
      assert.equal((await request('/api/admin/emails/settings',{user:guardAdmin,method:'POST',body:{...body,password:'wrong'}})).status,403);
      assert.equal((await request('/api/admin/emails/settings',{user:guardAdmin,method:'POST',body,headers:{Origin:'https://other.example.test'}})).status,403);
      for(const extra of [{origin:'https://attacker.example.test'},{from_address:'attacker@example.test'},{sender_name:'CardShelf\r\nBcc: attacker@example.test'}])assert.equal((await request('/api/admin/emails/settings',{user:guardAdmin,method:'POST',body:{...body,...extra}})).status,400);
      assert.equal((await sql`SELECT * FROM email_settings`).length,0);
    });
    await t.test('saved API credentials are encrypted, retained on blank update and never returned',async()=>{
      await save({enabled:true,api_key:apiKey});assert.equal(settings.configured,true);assert.equal(settings.api_key_set,true);assert.equal(settings.origin,'https://postal.cardshelf.cloud');
      const [stored]=await sql`SELECT * FROM email_settings`;assert.ok(stored.api_secret);assert.ok(!stored.api_secret.includes(apiKey));assertSecretFree(stored);assertSecretFree(settings);
      await save({sender_name:'CardShelf test installation'});assert.equal((await sql`SELECT api_secret FROM email_settings`)[0].api_secret,stored.api_secret);
      const stale=await request('/api/admin/emails/settings',{user:admin,method:'POST',body:{revision:stored.revision,password,enabled:false,sender_name:'Stale overwrite',from_address:'noreply@cardshelf.cloud',reply_to:'',api_key:'',clear_api_key:false}});assert.equal(stale.status,409);assert.equal((await sql`SELECT enabled FROM email_settings`)[0].enabled,true);
      assertSecretFree(await sql`SELECT detail FROM audit_log WHERE user_id IN ${sql([admin.id,guardAdmin.id])}`);
    });
    await t.test('disabling configured Postal prevents fallback and leaves queued attempts untouched',async()=>{
      const job=await queueEvent('password_changed',sender);await onlyJob(job.id);await save({enabled:false});
      const status=await recoveryDeliveryStatus(sql);assert.equal(status.provider,'postal');assert.equal(status.configured,false);
      let calls=0;assert.equal(await processEmailOutbox({sql,origin,send:async()=>{calls++;}}),false);assert.equal(calls,0);assert.equal((await jobById(job.id)).attempts,0);
      await save({enabled:true});
    });
    await t.test('personal optional preferences default off, enforce revisions and cannot select another account',async()=>{
      const first=(await request('/api/emails/preferences',{user:sender})).data;assert.equal(first.marketplace,false);assert.equal(first.membership,false);
      const changed=await preferences(sender,{marketplace:true,membership:true});assert.ok(changed.revision>first.revision);
      assert.equal((await request('/api/emails/preferences',{user:sender,method:'PATCH',body:{...first,marketplace:false}})).status,409);
      assert.equal((await request('/api/emails/preferences',{user:sender,method:'PATCH',body:{...changed,user_id:buyer.id}})).status,400);
      assert.equal((await request('/api/emails/preferences',{user:buyer})).data.marketplace,false);
      assert.equal((await request('/api/emails/preferences',{user:sender,method:'PATCH',body:{...changed,security:false}})).status,400);
    });
    await t.test('test deliveries are queued only to the authenticated administrator',async()=>{
      assert.equal((await request('/api/admin/emails/test',{user:guardAdmin,method:'POST',body:{password,email:buyer.email}})).status,400);
      assert.equal((await request('/api/admin/emails/test',{user:guardAdmin,method:'POST',body:{password:'wrong'}})).status,403);
      const result=await request('/api/admin/emails/test',{user:admin,method:'POST',body:{password}});assert.equal(result.status,200,JSON.stringify(result.data));
      const rows=await sql`SELECT * FROM email_outbox WHERE kind='test' AND user_id=${admin.id}`;assert.equal(rows.length,1);
      const sent=await deliver(rows[0]);assert.equal(sent.status,'accepted');assert.equal(recorded.at(-1).address,admin.email);assert.equal(sent.recipient_hash,digest(admin.email));assert.ok(sent.message_id);assert.equal(sent.delivered_at,null);
    });
    await t.test('unrelated pre-existing notifications are not delivered or changed by fixture workers',async()=>{
      const current=await sql`SELECT *,available_at::text AS original_available_at FROM email_outbox WHERE id IN ${sql(existingQueued.map(row=>row.id))} ORDER BY id`;
      const withoutSchedule=rows=>rows.map(({available_at,original_available_at,...row})=>row);
      assert.deepEqual(withoutSchedule(current),withoutSchedule(existingQueued));
      assert.ok(recorded.every(message=>message.address!==existingUserId+'@example.test'));
    });
    await t.test('queue event deduplication, private templates and bounded failed-send retries',async()=>{
      const job=await queueEvent('password_changed',sender);await enqueueEmail(sql,{eventKey:job.event_key,kind:'password_changed',userId:sender.id});assert.equal((await sql`SELECT id FROM email_outbox WHERE event_key=${job.event_key}`).length,1);
      for(let attempt=1;attempt<=3;attempt++){const failed=await deliver(job,async()=>{throw Object.assign(Error('Secret provider response '+apiKey+' recipient='+sender.email),{emailDelivery:'rejected'});});assert.equal(failed.attempts,attempt);assert.ok(!JSON.stringify(failed).includes(apiKey));assert.ok(!failed.last_error.includes(sender.email));assert.equal(failed.status,attempt<3?'queued':'failed');}
      const result=await request('/api/admin/emails/retry',{user:admin,method:'POST',body:{password,id:job.id}});assert.equal(result.status,200,JSON.stringify(result.data));
      const accepted=await deliver(job);assert.equal(accepted.status,'accepted');const message=recorded.at(-1).message;assert.match(message.subject,/password/i);assert.ok(!message.text.includes(password));assert.ok(!message.text.includes(apiKey));
      assert.equal((await request('/api/admin/emails/retry',{user:admin,method:'POST',body:{password,id:job.id}})).status,409);
      const adminView=await request('/api/admin/emails',{user:admin});assertSecretFree(adminView.data);assert.ok(!JSON.stringify(adminView.data.recent).includes(sender.email));
    });
    await t.test('manual recipient suppression prevents delivery and is admin/password protected',async()=>{
      const body={password,email:buyer.email,suppressed:true,reason:'Synthetic opt-out'};
      assert.equal((await request('/api/admin/emails/suppressions',{user:buyer,method:'POST',body})).status,403);
      const result=await request('/api/admin/emails/suppressions',{user:admin,method:'POST',body});assert.equal(result.status,200,JSON.stringify(result.data));
      const job=await queueEvent('password_changed',buyer);let calls=0;const suppressed=await deliver(job,async()=>{calls++;});assert.equal(calls,0);assert.equal(suppressed.status,'suppressed');
      assert.equal((await request('/api/admin/emails/suppressions',{user:admin,method:'POST',body:{...body,suppressed:false}})).status,200);
    });
    await t.test('expired notifications are not delivered or made retryable',async()=>{
      const job=await queueEvent('password_changed',outsider);await onlyJob(job.id);await sql`UPDATE email_outbox SET expires_at=now()-interval '1 second' WHERE id=${job.id}`;
      let calls=0;assert.equal(await processEmailOutbox({sql,origin,send:async()=>{calls++;}}),false);assert.equal(calls,0);assert.equal((await jobById(job.id)).status,'expired');assert.equal((await jobById(job.id)).attempts,0);
      assert.equal((await request('/api/admin/emails/retry',{user:admin,method:'POST',body:{password,id:job.id}})).status,409);
    });
    await t.test('normal authenticated password changes queue one mandatory security event',async()=>{
      const before=(await sql`SELECT id FROM email_outbox WHERE user_id=${buyer.id} AND kind='password_changed'`).length;
      const changed=await request('/api/password',{user:buyer,method:'POST',body:{current_password:password,password:'Changed synthetic integration password 456'}});assert.equal(changed.status,200,JSON.stringify(changed.data));
      buyer.cookie=changed.headers.get('set-cookie')?.split(';')[0]||buyer.cookie;
      assert.equal((await sql`SELECT id FROM email_outbox WHERE user_id=${buyer.id} AND kind='password_changed'`).length,before+1);
    });
    await t.test('membership assignment queues opted-in updates without changing subscription billing',async()=>{
      const before=await sql`SELECT * FROM stripe_subscriptions WHERE user_id=${sender.id}`;
      const result=await request('/api/admin/billing/tiers/'+sender.id,{user:admin,method:'POST',body:{tier:'plus',reason:'Synthetic email integration tier update',revision:0,expires_at:null,confirm_billing_unchanged:true}});assert.equal(result.status,200,JSON.stringify(result.data));
      const jobs=await sql`SELECT * FROM email_outbox WHERE user_id=${sender.id} AND kind='membership_changed'`;assert.equal(jobs.length,1);
      const accepted=await deliver(jobs[0]);assert.equal(accepted.status,'accepted');assert.equal(recorded.at(-1).address,sender.email);assert.match(recorded.at(-1).message.subject,/membership/i);
      assert.deepEqual(await sql`SELECT * FROM stripe_subscriptions WHERE user_id=${sender.id}`,before);
      const optedOut=await request('/api/admin/billing/tiers/'+outsider.id,{user:admin,method:'POST',body:{tier:'collector',reason:'Synthetic opt-out integration tier update',revision:0,expires_at:null,confirm_billing_unchanged:true}});assert.equal(optedOut.status,200);assert.equal((await sql`SELECT id FROM email_outbox WHERE user_id=${outsider.id} AND kind='membership_changed'`).length,0);
    });
    await t.test('marketplace enquiry and reply hooks target the other participant exactly once without message text',async()=>{
      await preferences(buyer,{marketplace:true,membership:false});
      setId='en:email-'+randomUUID();const cardId=setId+'-1';printingId=randomUUID();
      await sql`INSERT INTO card_sets(id,provider_id,language,name,card_count) VALUES(${setId},${setId.slice(3)},'en','Email integration fixture',1)`;
      await sql`INSERT INTO cards(id,provider_id,set_id,language,local_id,name) VALUES(${cardId},${cardId.slice(3)},${setId},'en','1','Synthetic email fixture card')`;
      await sql`INSERT INTO printings(id,card_id,key,label,source) VALUES(${printingId},${cardId},'normal','Normal','tcgdex')`;
      await sql`INSERT INTO collection_entries(user_id,printing_id,condition,quantity) VALUES(${sender.id},${printingId},'NM',1)`;
      const bytes=await sharp({create:{width:12,height:18,channels:3,background:'#335577'}}).png().toBuffer();
      const listing=await request('/api/marketplace/listings',{user:sender,method:'POST',body:{request_id:randomUUID(),printing_id:printingId,seller_alias:'Synthetic seller',condition:'NM',price_minor:1200,delivery:'postage',postage_minor:500,region:'Perth, WA',description:'Synthetic delivery notification test listing.',ownership_confirmed:true,photos:['front','back'].map(side=>({side,content_type:'image/png',data_base64:bytes.toString('base64')}))}});assert.equal(listing.status,200,JSON.stringify(listing.data));listingId=listing.data.id;
      const current=(await request('/api/marketplace/listings/'+listingId,{user:sender})).data;
      const enquiry={request_id:randomUUID(),revision:current.revision,message:'PRIVATE ENQUIRY must never be in email'};
      const created=await request('/api/marketplace/listings/'+listingId+'/enquiries',{user:buyer,method:'POST',body:enquiry});assert.equal(created.status,200,JSON.stringify(created.data));threadId=created.data.id;
      assert.equal((await request('/api/marketplace/listings/'+listingId+'/enquiries',{user:buyer,method:'POST',body:enquiry})).status,200);
      const enquiries=await sql`SELECT * FROM email_outbox WHERE user_id=${sender.id} AND kind='marketplace_enquiry'`;assert.equal(enquiries.length,1);assert.ok(!JSON.stringify(enquiries).includes(enquiry.message));
      await deliver(enquiries[0]);assert.equal(recorded.at(-1).address,sender.email);assert.ok(!recorded.at(-1).message.text.includes(enquiry.message));
      const reply={request_id:randomUUID(),message:'PRIVATE REPLY must never be in email'};
      for(let i=0;i<2;i++)assert.equal((await request('/api/marketplace/conversations/'+threadId+'/messages',{user:sender,method:'POST',body:reply})).status,200);
      const replies=await sql`SELECT * FROM email_outbox WHERE user_id=${buyer.id} AND kind='marketplace_reply'`;assert.equal(replies.length,1);assert.ok(!JSON.stringify(replies).includes(reply.message));
      await preferences(buyer,{marketplace:false});let calls=0;const suppressed=await deliver(replies[0],async()=>{calls++;});assert.equal(calls,0);assert.equal(suppressed.status,'suppressed');
      assert.equal((await sql`SELECT id FROM email_outbox WHERE user_id=${outsider.id} AND kind IN ('marketplace_enquiry','marketplace_reply')`).length,0);
    });
    await t.test('signed Postal webhooks correlate message and recipient, ignore replay and record verified delivery',async()=>{
      const job=await queueEvent('password_changed',sender),accepted=await deliver(job),event={...accepted,email:sender.email};
      const unsigned=await request('/api/webhooks/postal',{method:'POST',body:{event:'MessageSent'}});assert.equal(unsigned.status,401);
      const attempt=await webhook(event);assert.equal(attempt.response.status,200,JSON.stringify(attempt.response.data));
      const delivered=await jobById(job.id);assert.equal(delivered.status,'delivered');assert.equal(delivered.sent_with_ssl,true);assert.ok(delivered.delivered_at);
      const count=(await sql`SELECT event_key FROM email_webhook_receipts`).length;
      const duplicate=await request('/api/webhooks/postal',{method:'POST',raw:attempt.raw,headers:{'X-Postal-Signature-256':attempt.signature}});assert.equal(duplicate.status,200);assert.equal((await sql`SELECT event_key FROM email_webhook_receipts`).length,count);
      assert.equal((await request('/api/webhooks/postal',{method:'POST',raw:attempt.raw+' ',headers:{'X-Postal-Signature-256':attempt.signature}})).status,401);
      const oversized=JSON.stringify({padding:'x'.repeat(65536)}),oversizedSignature=sign('RSA-SHA256',Buffer.from(oversized),privateKey).toString('base64');assert.equal((await request('/api/webhooks/postal',{method:'POST',raw:oversized,headers:{'X-Postal-Signature-256':oversizedSignature}})).status,413);
      const wrong=await webhook({...event,email:outsider.email});assert.equal(wrong.response.status,503);assert.equal((await sql`SELECT event_key FROM email_webhook_receipts`).length,count);
      const stale=await webhook(event,{timestamp:Math.floor(Date.now()/1000)-90000});assert.equal(stale.response.status,400);
      assert.equal((await jobById(job.id)).status,'delivered');
    });
    await t.test('a signed hard bounce suppresses the exact recipient and cannot be undone by an old sent event',async()=>{
      const job=await queueEvent('password_changed',sender),accepted=await deliver(job),event={...accepted,email:sender.email},now=Math.floor(Date.now()/1000);
      const initiallySent=await webhook(event,{timestamp:now,payload:{message:{id:Number(accepted.provider_id),direction:'outgoing',message_id:accepted.message_id,to:sender.email,timestamp:now},status:'Sent',timestamp:now,sent_with_ssl:true}});assert.equal(initiallySent.response.status,200);assert.equal((await jobById(job.id)).status,'delivered');
      const result=await webhook(event,{event:'MessageBounced',payload:{original_message:{id:Number(accepted.provider_id),direction:'outgoing',message_id:accepted.message_id,to:sender.email,timestamp:now},bounce:{timestamp:now},status:'HardFail',timestamp:now}});assert.equal(result.response.status,200,JSON.stringify(result.response.data));
      assert.equal((await jobById(job.id)).status,'bounced');assert.equal((await sql`SELECT source FROM email_suppressions WHERE email=${sender.email}`)[0].source,'postal');
      const old=await webhook(event,{timestamp:now-10,payload:{message:{id:Number(accepted.provider_id),direction:'outgoing',message_id:accepted.message_id,to:sender.email,timestamp:now-10},status:'Sent',timestamp:now-10,sent_with_ssl:true}});assert.equal(old.response.status,200);assert.equal((await jobById(job.id)).status,'bounced');
      const equal=await webhook(event,{timestamp:now,payload:{message:{id:Number(accepted.provider_id),direction:'outgoing',message_id:accepted.message_id,to:sender.email,timestamp:now},status:'Sent',timestamp:now,sent_with_ssl:true}});assert.equal(equal.response.status,200);assert.equal((await jobById(job.id)).status,'bounced');
      const next=await queueEvent('password_changed',sender);let calls=0;assert.equal((await deliver(next,async()=>{calls++;})).status,'suppressed');assert.equal(calls,0);
    });
    await t.test('email pages are private, non-indexable and do not contain delivery credentials',async()=>{
      for(const [path,user] of [['/emails',sender],['/admin/emails',admin]]){const response=await request(path,{user});assert.equal(response.status,200);assert.match(response.headers.get('x-robots-tag'),/noindex/);assertSecretFree(response.data);}
      const sitemap=await request('/sitemap.xml');assert.ok(!String(sitemap.data).includes('/admin/emails'));assert.ok(!String(sitemap.data).includes('/emails'));
    });
    await t.test('removing the API credential disables Postal and never revives legacy SMTP',async()=>{
      await save({clear_api_key:true});assert.equal(settings.api_key_set,false);assert.equal(settings.enabled,false);assert.equal((await sql`SELECT api_secret FROM email_settings`)[0].api_secret,null);
      const status=await recoveryDeliveryStatus(sql);assert.equal(status.provider,'postal');assert.equal(status.configured,false);
    });
  }finally{
    try{
      // Force a text parameter so the driver does not serialize it as a Date
      // before PostgreSQL restores the timestamp's full microsecond precision.
      for(const row of existingQueued)await sql`UPDATE email_outbox SET available_at=${row.original_available_at}::text::timestamptz WHERE id=${row.id}`;
      if(existingQueued.length){
        const restored=await sql`SELECT *,available_at::text AS original_available_at FROM email_outbox WHERE id IN ${sql(existingQueued.map(row=>row.id))} ORDER BY id`;
        assert.deepEqual(restored,existingQueued,'Other suites\' notifications and exact schedules must be preserved.');
      }
    }finally{
      for(const key of smtpKeys){if(oldSmtp[key]===undefined)delete process.env[key];else process.env[key]=oldSmtp[key];}
      await sql`DELETE FROM email_settings`;if(previousSettings.length)await sql`INSERT INTO email_settings ${sql(previousSettings)}`;
      if(users.length){await sql`DELETE FROM email_suppressions WHERE email IN ${sql(users.map(id=>id+'@example.test'))}`;await sql`DELETE FROM app_users WHERE id IN ${sql(users)}`;}
      await sql`DELETE FROM app_users WHERE id=${existingUserId}`;
      if(eventIds.length)await sql`DELETE FROM email_webhook_receipts WHERE event_key IN ${sql(eventIds.map(id=>digest(id.toLowerCase())))}`;
      if(printingId)await sql`DELETE FROM printings WHERE id=${printingId}`;
      if(setId){await sql`DELETE FROM cards WHERE set_id=${setId}`;await sql`DELETE FROM card_sets WHERE id=${setId}`;}
      await sql.end();await closeDatabase();
    }
  }
});
