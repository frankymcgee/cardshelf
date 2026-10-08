// Disposable HTTP/PostgreSQL checks. SMTP verification and sending are injected
// only into internal functions. No real mailbox or provider is contacted.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, generateKeyPairSync, sign } from 'node:crypto';
import postgres from 'postgres';
import { readFileSync } from 'node:fs';
import { AppError } from '../../lib/errors.mjs';
import { hashPassword, randomToken, digest, verifyPassword } from '../../lib/security.mjs';
import { closeDatabase } from '../../lib/db.mjs';
import { encryptEmailSecret, emailConfigurationFromRow } from '../../lib/email-settings.mjs';
import { decryptSmtpSecret } from '../../lib/smtp-settings.mjs';
import { verifyAdminEmailConnection } from '../../lib/email-admin.mjs';
import { enqueueEmail, processEmailOutbox } from '../../lib/email-outbox.mjs';
import { processRecoveryMail } from '../../lib/password-recovery.mjs';
import { recoveryDeliveryStatus } from '../../lib/password-recovery-mail.mjs';

const base=process.env.TEST_BASE_URL,url=process.env.DATABASE_URL,origin=process.env.APP_ORIGIN||base;
if(process.env.ALLOW_TEST_DATABASE!=='yes'||!base||!new URL(url||'http://invalid').pathname.endsWith('_test')||process.env.EMAIL_WORKER_ENABLED!=='false')throw Error('Use a disposable _test database and pause EMAIL_WORKER_ENABLED.');
const sql=postgres(url,{max:4}),password='Synthetic email providers administrator password 123',smtpSecret='SYNTHETIC-SMTP-PASSWORD-'+randomUUID(),postalSecret='SYNTHETIC-POSTAL-API-'+randomUUID(),users=[];
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048}),publicPem=publicKey.export({type:'spki',format:'pem'}).toString(),webhookIds=[];
async function request(path,{user,method='GET',body,headers={}}={}){
  const response=await fetch(base+path,{method,headers:{Origin:origin,'X-Requested-With':'cardshelf',...(user?{Cookie:user.cookie}:{}),...(body?{'Content-Type':'application/json'}:{}),...headers},body:body?JSON.stringify(body):undefined});
  return {status:response.status,data:await response.json(),headers:response.headers};
}
async function account(role='user'){
  const id=randomUUID(),token=randomToken(),email=id+'@example.test';users.push(id);
  await sql`INSERT INTO app_users(id,email,name,password_hash,role) VALUES(${id},${email},'Synthetic mail provider fixture',${await hashPassword(password)},${role})`;
  await sql`INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(${digest(token)},${id},now()+interval '1 hour')`;
  return {id,email,cookie:'cardshelf_session='+token};
}
function secretFree(value){for(const secret of [smtpSecret,postalSecret,password,process.env.CARDSHELF_INTEGRATION_KEY])assert.ok(!JSON.stringify(value).includes(secret),'Mail credential leaked.');}
await test('SMTP and Postal provider selection, recovery, pacing and ambiguous delivery',async t=>{
  const oldSettings=await sql`SELECT * FROM email_settings`,oldThrottle=await sql`SELECT * FROM email_dispatch_state`;
  const previousOutbox=await sql`SELECT id,available_at::text AS schedule FROM email_outbox WHERE status='queued'`;
  const previousRecovery=await sql`SELECT id,available_at::text AS schedule FROM password_recovery_mail WHERE status='queued'`;
  let admin,guard,member,other,settings;
  async function overview(){const response=await request('/api/admin/emails',{user:admin});assert.equal(response.status,200);secretFree(response.data);settings=response.data.settings;return response.data;}
  function body(changes={}){return {revision:settings?.revision||0,password,provider:settings?.provider||'postal',enabled:settings?.enabled||false,sender_name:'CardShelf',from_address:'noreply@cardshelf.cloud',reply_to:'support@cardshelf.cloud',api_key:'',clear_api_key:false,dkim_selector:'',dkim_public_key:'',webhook_public_key:settings?.webhook_public_key||'',smtp_preset:settings?.smtp_preset||'custom',smtp_host:settings?.smtp_host||'',smtp_port:settings?.smtp_port||587,smtp_security:settings?.smtp_security||'starttls',smtp_user:settings?.smtp_user||'',smtp_rate_limit:settings?.smtp_rate_limit||10,smtp_password:'',clear_smtp_password:false,...changes};}
  async function save(changes={}){await overview();const response=await request('/api/admin/emails/settings',{user:admin,method:'POST',body:body(changes)});assert.equal(response.status,200,JSON.stringify(response.data));secretFree(response.data);await overview();return response.data;}
  async function queue(user=member){const key='smtp-integration:'+randomUUID();await enqueueEmail(sql,{eventKey:key,kind:'password_changed',userId:user.id});return (await sql`SELECT * FROM email_outbox WHERE event_key=${key}`)[0];}
  async function onlyOutbox(id){await sql`UPDATE email_outbox SET available_at=now()+interval '1 day' WHERE user_id IN ${sql(users)} AND status='queued'`;await sql`UPDATE email_outbox SET available_at=now()-interval '1 second' WHERE id=${id}`;}
  async function onlyRecovery(id){await sql`UPDATE password_recovery_mail SET available_at=now()+interval '1 day' WHERE email IN ${sql(users.map(user=>user+'@example.test'))} AND status='queued'`;await sql`UPDATE password_recovery_mail SET available_at=now()-interval '1 second' WHERE id=${id}`;}
  async function clearPacing(){await sql`UPDATE email_dispatch_state SET next_send_at=now()-interval '1 second' WHERE singleton`;}
  const outbox=id=>sql`SELECT * FROM email_outbox WHERE id=${id}`.then(rows=>rows[0]);
  const capture=[];
  const send=async(address,message,options)=>{capture.push({address,message,options});return {provider:options.configuration.provider,provider_id:options.configuration.provider==='postal'?'900001':null,message_id:options.configuration.provider==='postal'?options.messageId.slice(1,-1):options.messageId};};
  try{
    await sql`DELETE FROM email_settings`;await sql`DELETE FROM email_dispatch_state`;
    if(previousOutbox.length)await sql`UPDATE email_outbox SET available_at=now()+interval '1 day' WHERE id IN ${sql(previousOutbox.map(row=>row.id))}`;
    if(previousRecovery.length)await sql`UPDATE password_recovery_mail SET available_at=now()+interval '1 day' WHERE id IN ${sql(previousRecovery.map(row=>row.id))}`;
    admin=await account('admin');guard=await account('admin');member=await account();other=await account();await overview();
    let historicalPostal;
    await t.test('migration preserves Postal state and holds previously attempted jobs before a new worker can resend',async()=>{
      const schema='smtp_upgrade_'+randomUUID().replaceAll('-',''),id=randomUUID(),encrypted=encryptEmailSecret(postalSecret);
      await sql.begin(async tx=>{
        await tx`CREATE SCHEMA ${tx(schema)}`;await tx`SET LOCAL search_path TO ${tx(schema)},public`;
        await tx`CREATE TABLE app_users(id uuid PRIMARY KEY)`;await tx`INSERT INTO app_users(id) VALUES(${id})`;
        await tx`CREATE TABLE password_recovery_mail(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),email text,kind text,status text CONSTRAINT password_recovery_mail_status_check CHECK(status IN ('queued','sending','failed','sent')),attempts integer NOT NULL DEFAULT 0,lease_token text,lease_until timestamptz,created_at timestamptz DEFAULT now(),finished_at timestamptz,last_error text NOT NULL DEFAULT '')`;
        await tx.unsafe(readFileSync(new URL('../../migrations/018_postal_email.sql',import.meta.url),'utf8'),[],{prepare:false});
        await tx`INSERT INTO email_settings(enabled,api_secret) VALUES(true,${encrypted})`;
        for(const table of ['email_outbox','password_recovery_mail']){
          for(const [state,attempts] of [['queued',0],['queued',1],['failed',3],['sending',1],['accepted',1]]){
            const fixtureId=randomUUID(),key=state+'-'+attempts;
            if(table==='email_outbox')await tx`INSERT INTO email_outbox(id,event_key,kind,user_id,status,attempts,lease_token,lease_until,provider,provider_id,accepted_at,message_id) VALUES(${fixtureId},${key},'password_changed',${id},${state},${attempts},'old-lease',now()+interval '1 minute','postal',${state==='accepted'?'123':null},${state==='accepted'?new Date():null},${state==='accepted'?'historical-postal-id':null})`;
            else await tx`INSERT INTO password_recovery_mail(id,email,kind,status,attempts,lease_token,lease_until,provider,provider_id,accepted_at,message_id) VALUES(${fixtureId},${key+'@example.test'},'reset',${state},${attempts},'old-lease',now()+interval '1 minute','postal',${state==='accepted'?'123':null},${state==='accepted'?new Date():null},${state==='accepted'?'historical-postal-id':null})`;
          }
        }
        await tx.unsafe(readFileSync(new URL('../../migrations/031_email_providers.sql',import.meta.url),'utf8'),[],{prepare:false});
        const [row]=await tx`SELECT * FROM email_settings`;assert.equal(row.api_secret,encrypted);assert.equal(row.provider,'postal');assert.equal(row.enabled,true);assert.equal(emailConfigurationFromRow(row).secret,postalSecret);assert.equal(row.smtp_secret,null);
        for(const table of ['email_outbox','password_recovery_mail']){
          const rows=await tx`SELECT * FROM ${tx(table)} ORDER BY attempts`;
          assert.equal(rows.filter(r=>r.status==='queued'&&r.attempts===0).length,1);assert.equal(rows.filter(r=>r.status==='uncertain').length,3);
          for(const r of rows.filter(r=>r.status==='uncertain')){assert.equal(r.lease_token,null);assert.equal(r.lease_until,null);assert.ok(r.dispatch_started_at);assert.equal(r.last_error,'DELIVERY_UNCERTAIN');}
          const accepted=rows.find(r=>r.status==='accepted');assert.equal(accepted.provider_id,'123');assert.equal(accepted.message_id,'historical-postal-id');assert.ok(accepted.accepted_at);
        }
        await tx`DROP SCHEMA ${tx(schema)} CASCADE`;
      });
    });
    await t.test('the upgrade preserves Postal credentials and old deliveries while switching to SMTP',async()=>{
      await save({provider:'postal',enabled:true,api_key:postalSecret,webhook_public_key:publicPem});const job=await queue();await onlyOutbox(job.id);assert.equal(await processEmailOutbox({sql,origin,send}),true);historicalPostal=await outbox(job.id);assert.equal(historicalPostal.provider,'postal');assert.equal(historicalPostal.status,'accepted');
      await save({provider:'smtp',enabled:false,smtp_preset:'wpmu',smtp_host:'mailu.wpmudev.host',smtp_port:587,smtp_security:'starttls',smtp_user:'noreply@cardshelf.cloud',smtp_rate_limit:10,smtp_password:smtpSecret});
      assert.equal(settings.provider,'smtp');assert.equal(settings.configured,true);assert.equal(settings.api_key_set,true);assert.equal(settings.smtp_password_set,true);assert.equal(settings.origin,'');
      const [row]=await sql`SELECT * FROM email_settings`;assert.ok(row.api_secret);assert.ok(row.smtp_secret);secretFree(row);assert.equal(decryptSmtpSecret(row.smtp_secret,row),smtpSecret);
      assert.equal((await recoveryDeliveryStatus(sql)).configured,false);assert.equal((await recoveryDeliveryStatus(sql)).provider,'smtp');
    });
    await t.test('SMTP connection endpoints reject guests, members, wrong passwords, cross-origin requests and extra fields',async()=>{
      const input={password,revision:settings.revision};
      assert.equal((await request('/api/admin/emails/connection',{method:'POST',body:input})).status,401);
      assert.equal((await request('/api/admin/emails/connection',{user:member,method:'POST',body:input})).status,403);
      assert.equal((await request('/api/admin/emails/connection',{user:guard,method:'POST',body:{...input,password:'wrong'}})).status,403);
      assert.equal((await request('/api/admin/emails/connection',{user:guard,method:'POST',body:input,headers:{Origin:'https://other.example.com'}})).status,403);
      assert.equal((await request('/api/admin/emails/connection',{user:guard,method:'POST',body:{...input,email:member.email}})).status,400);
      assert.equal((await request('/api/admin/emails/connection',{user:guard,method:'POST',body:{...input,revision:input.revision-1}})).status,409);
      const bad=await request('/api/admin/emails/settings',{user:guard,method:'POST',body:body({smtp_host:'127.0.0.1'})});assert.equal(bad.status,400);secretFree(bad.data);
    });
    await t.test('connection verification can run while paused and records no sending or secrets',async()=>{
      const before=await sql`SELECT id FROM email_outbox WHERE user_id=${admin.id}`;let checks=0;
      const result=await verifyAdminEmailConnection(admin.id,{password,revision:settings.revision},{verify:async config=>{checks++;assert.equal(config.smtp_password,smtpSecret);assert.equal(config.enabled,false);}});
      assert.equal(result.verified,true);assert.equal(checks,1);secretFree(result);await overview();assert.ok(settings.smtp_verified_at);
      assert.deepEqual(await sql`SELECT id FROM email_outbox WHERE user_id=${admin.id}`,before);
      const ready=await request('/api/admin/readiness',{user:admin});assert.equal(ready.status,200);secretFree(ready.data);assert.equal(ready.data.checks.find(c=>c.id==='smtp-connection').status,'pass');assert.equal(ready.data.checks.find(c=>c.id==='postal-webhook'),undefined);assert.equal(ready.data.checks.find(c=>c.id==='email-delivery').status,'review');
      await save({enabled:true});assert.equal(settings.smtp_verified_at,null);assert.equal((await recoveryDeliveryStatus(sql)).configured,true);
    });
    await t.test('recovery and activity share durable SMTP pacing and record only acceptance',async()=>{
      const job=await queue();await onlyOutbox(job.id);const [recovery]=await sql`INSERT INTO password_recovery_mail(email,kind) VALUES(${member.email},'reset') RETURNING id`;await onlyRecovery(recovery.id);await clearPacing();
      const before=capture.length;assert.equal(await processEmailOutbox({sql,origin,send}),true);const accepted=await outbox(job.id);assert.equal(accepted.provider,'smtp');assert.equal(accepted.status,'accepted');assert.equal(accepted.provider_id,null);assert.equal(accepted.delivered_at,null);
      assert.equal(await processRecoveryMail({sql,origin,send}),false);assert.equal(capture.length,before+1);assert.equal((await sql`SELECT attempts FROM password_recovery_mail WHERE email=${member.email} AND kind='reset'`)[0].attempts,0);assert.equal((await sql`SELECT token_hash FROM password_recovery_tokens WHERE user_id=${member.id}`).length,0);
      await clearPacing();assert.equal(await processRecoveryMail({sql,origin,send}),true);const [reset]=await sql`SELECT * FROM password_recovery_mail WHERE email=${member.email} AND kind='reset'`;assert.equal(reset.status,'accepted');assert.equal(reset.provider,'smtp');assert.equal(reset.delivered_at,null);
      const text=capture.at(-1).message.text,token=text.match(/#token=([a-f0-9]{64})/)[1];assert.ok(!JSON.stringify(reset).includes(token));
      const changed='Changed synthetic SMTP recovery password 456';const redeemed=await request('/api/public/password-recovery/complete',{method:'POST',body:{token,password:changed,confirm_password:changed}});assert.equal(redeemed.status,200,JSON.stringify(redeemed.data));assert.equal(await verifyPassword(changed,(await sql`SELECT password_hash FROM app_users WHERE id=${member.id}`)[0].password_hash),true);assert.equal((await sql`SELECT * FROM sessions WHERE user_id=${member.id}`).length,0);
      const timestamp=Math.floor(Date.now()/1000),uuid=randomUUID();webhookIds.push(uuid);
      const event={uuid,timestamp,event:'MessageSent',payload:{message:{id:Number(historicalPostal.provider_id),direction:'outgoing',message_id:historicalPostal.message_id,to:member.email,timestamp},timestamp,status:'Sent',sent_with_ssl:true}};
      const signature=sign('RSA-SHA256',Buffer.from(JSON.stringify(event)),privateKey).toString('base64');
      const delivered=await request('/api/webhooks/postal',{method:'POST',body:event,headers:{'X-Postal-Signature-256':signature}});assert.equal(delivered.status,200,JSON.stringify(delivered.data));assert.equal(settings.provider,'smtp');assert.equal(settings.webhook_public_key,publicPem);assert.equal((await outbox(historicalPostal.id)).status,'delivered');assert.equal((await outbox(job.id)).status,'accepted');
    });
    await t.test('lost acceptance acknowledgments and interrupted submissions are held without retry across provider changes',async()=>{
      const job=await queue(other);await onlyOutbox(job.id);await clearPacing();let calls=0;
      assert.equal(await processEmailOutbox({sql,origin,send:async()=>{calls++;throw Error('Synthetic lost acknowledgment '+smtpSecret);}}),true);
      const uncertain=await outbox(job.id);assert.equal(uncertain.status,'uncertain');assert.equal(uncertain.attempts,1);assert.equal(uncertain.last_error,'DELIVERY_UNCERTAIN');assert.ok(uncertain.dispatch_started_at);secretFree(uncertain);
      await save({provider:'postal'});await onlyOutbox(job.id);assert.equal(await processEmailOutbox({sql,origin,send:async()=>{calls++;}}),false);assert.equal(calls,1);assert.equal((await request('/api/admin/emails/retry',{user:admin,method:'POST',body:{password,id:job.id}})).status,409);
      const interrupted=await queue(other);await onlyOutbox(interrupted.id);await sql`UPDATE email_outbox SET status='sending',attempts=1,dispatch_started_at=now()-interval '3 minutes',lease_token='synthetic-old-lease',lease_until=now()-interval '1 minute' WHERE id=${interrupted.id}`;
      assert.equal(await processEmailOutbox({sql,origin,send:async()=>{calls++;}}),false);assert.equal((await outbox(interrupted.id)).status,'uncertain');assert.equal(calls,1);
      await save({provider:'smtp'});
    });
    await t.test('an uncertain recovery remains redeemable and never stores the outgoing token or retries it',async()=>{
      const [recovery]=await sql`INSERT INTO password_recovery_mail(email,kind) VALUES(${other.email},'reset') RETURNING id`;await onlyRecovery(recovery.id);await clearPacing();let token,calls=0;
      assert.equal(await processRecoveryMail({sql,origin,send:async(address,message)=>{assert.equal(address,other.email);calls++;const match=message.text.match(/#token=([a-f0-9]{64})/);assert.ok(match,'The selected reset job must contain a recovery link.');token=match[1];throw Error('Lost SMTP acknowledgment');}}),true);
      const [row]=await sql`SELECT * FROM password_recovery_mail WHERE id=${recovery.id}`;assert.equal(row.status,'uncertain');assert.equal(row.attempts,1);assert.equal((await sql`SELECT token_hash FROM password_recovery_tokens WHERE token_hash=${digest(token)}`).length,1);assert.ok(!JSON.stringify(row).includes(token));
      assert.equal(await processRecoveryMail({sql,origin,send:async()=>{calls++;}}),false);assert.equal(calls,1);
      const redeemed=await request('/api/public/password-recovery/complete',{method:'POST',body:{token,password:'Recovered synthetic uncertain mail password 456',confirm_password:'Recovered synthetic uncertain mail password 456'}});assert.equal(redeemed.status,200);
    });
    await t.test('blank updates retain credentials and changed SMTP identities require re-entry',async()=>{
      const [before]=await sql`SELECT * FROM email_settings`;await save({sender_name:'Updated CardShelf identity'});assert.equal((await sql`SELECT smtp_secret FROM email_settings`)[0].smtp_secret,before.smtp_secret);
      const changed=await request('/api/admin/emails/settings',{user:admin,method:'POST',body:body({smtp_preset:'custom',smtp_host:'smtp.example.com'})});assert.equal(changed.status,409);assert.equal((await sql`SELECT smtp_host FROM email_settings`)[0].smtp_host,'mailu.wpmudev.host');
      const revision=settings.revision;await save({smtp_preset:'custom',smtp_host:'smtp.example.com',smtp_password:smtpSecret});assert.equal(settings.smtp_host,'smtp.example.com');assert.equal(settings.smtp_verified_at,null);
      const stale=await request('/api/admin/emails/settings',{user:guard,method:'POST',body:body({revision,enabled:false})});assert.equal(stale.status,409);
    });
    await t.test('a failed check clears verification and a concurrent settings edit cannot record stale success',async()=>{
      await verifyAdminEmailConnection(admin.id,{password,revision:settings.revision},{verify:async()=>{}});await overview();assert.ok(settings.smtp_verified_at);
      await assert.rejects(verifyAdminEmailConnection(admin.id,{password,revision:settings.revision},{verify:async()=>{throw new AppError(502,'Synthetic verification failed.');}}));await overview();assert.equal(settings.smtp_verified_at,null);
      await assert.rejects(verifyAdminEmailConnection(admin.id,{password,revision:settings.revision},{verify:async()=>{await sql`UPDATE email_settings SET revision=revision+1,smtp_verified_at=NULL,smtp_verified_revision=NULL WHERE singleton`;}}),/changed during the check/);await overview();assert.equal(settings.smtp_verified_at,null);
    });
    await t.test('clearing inactive credentials preserves sending while clearing the active password pauses SMTP',async()=>{
      await save({clear_api_key:true});assert.equal(settings.api_key_set,false);assert.equal(settings.enabled,true);assert.equal(settings.configured,true);
      await save({clear_smtp_password:true});assert.equal(settings.smtp_password_set,false);assert.equal(settings.enabled,false);assert.equal(settings.configured,false);assert.equal((await sql`SELECT smtp_secret FROM email_settings`)[0].smtp_secret,null);
      const job=await queue(other);await onlyOutbox(job.id);let calls=0;assert.equal(await processEmailOutbox({sql,origin,send:async()=>{calls++;}}),false);assert.equal(calls,0);assert.equal((await outbox(job.id)).attempts,0);
      secretFree(await sql`SELECT detail FROM audit_log WHERE user_id IN ${sql([admin.id,guard.id])}`);
    });
  }finally{
    for(const row of previousOutbox)await sql`UPDATE email_outbox SET available_at=${row.schedule}::text::timestamptz WHERE id=${row.id}`;
    for(const row of previousRecovery)await sql`UPDATE password_recovery_mail SET available_at=${row.schedule}::text::timestamptz WHERE id=${row.id}`;
    await sql`DELETE FROM email_settings`;if(oldSettings.length)await sql`INSERT INTO email_settings ${sql(oldSettings)}`;
    await sql`DELETE FROM email_dispatch_state`;if(oldThrottle.length)await sql`INSERT INTO email_dispatch_state ${sql(oldThrottle)}`;
    if(webhookIds.length)await sql`DELETE FROM email_webhook_receipts WHERE event_key IN ${sql(webhookIds.map(id=>digest(id)))}`;
    if(users.length){await sql`DELETE FROM password_recovery_mail WHERE email IN ${sql(users.map(id=>id+'@example.test'))}`;await sql`DELETE FROM app_users WHERE id IN ${sql(users)}`;}
    await sql.end();await closeDatabase();
  }
});
