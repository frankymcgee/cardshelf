import { db } from './db.mjs';
import { ensure } from './errors.mjs';
import * as v from './validate.mjs';
import { digest, randomToken } from './security.mjs';
import { configuration } from './config.mjs';
import { recoveryEmail, recoveryOrigin } from './password-recovery-logic.mjs';
import { sendRecoveryEmail, deliveryConfiguration, suppressedEmail } from './password-recovery-mail.mjs';
import { reserveEmailDispatch, knownEmailRejection } from './email-dispatch.mjs';
import { smtpHistoryCode } from './smtp-errors.mjs';

const groups={marketplace_enquiry:'marketplace',marketplace_reply:'marketplace',membership_changed:'membership'};
const kinds=['password_changed','marketplace_enquiry','marketplace_reply','membership_changed','test'];
const safePayload=(kind,payload)=>{
  if(kind==='marketplace_enquiry'||kind==='marketplace_reply'){
    const conversation_id=v.uuid(payload.conversation_id,'Conversation');
    if(kind==='marketplace_enquiry')return {conversation_id};
    const message_id=String(payload.message_id);
    ensure(/^[1-9]\d{0,18}$/.test(message_id)&&BigInt(message_id)<=9223372036854775807n,400,'Invalid message identifier.');
    return {conversation_id,message_id};
  }
  if(kind==='membership_changed')return {revision:v.integer(payload.revision,'Revision',1,2147483647)};
  return {};
};
export async function emailPreferences(userId,sql=db()) {
  const [row]=await sql`SELECT marketplace,membership,revision FROM email_preferences WHERE user_id=${userId}`;
  return row||{marketplace:false,membership:false,revision:0};
}
export async function saveEmailPreferences(userId,input) {
  const data=v.object(input);
  ensure(Object.keys(data).every(key=>['marketplace','membership','revision'].includes(key)),400,'Unsupported email preference.');
  const marketplace=v.bool(data.marketplace,'Marketplace emails'),membership=v.bool(data.membership,'Membership emails'),revision=v.integer(data.revision,'Revision',0,2147483647);
  return db().begin(async sql=>{
    await sql`SELECT id FROM app_users WHERE id=${userId} FOR UPDATE`;
    const current=await emailPreferences(userId,sql);ensure(current.revision===revision,409,'Email preferences changed. Reload before saving.');
    const [saved]=await sql`INSERT INTO email_preferences(user_id,marketplace,membership) VALUES(${userId},${marketplace},${membership})
      ON CONFLICT(user_id) DO UPDATE SET marketplace=excluded.marketplace,membership=excluded.membership,
      revision=email_preferences.revision+1,updated_at=now() RETURNING marketplace,membership,revision`;
    return saved;
  });
}
export async function enqueueEmail(sql,{eventKey,kind,userId,payload={},expiresHours=24}) {
  ensure(kinds.includes(kind)&&typeof eventKey==='string'&&eventKey.length>=1&&eventKey.length<=200,400,'Unsupported email event.');
  v.uuid(userId);v.integer(expiresHours,'Email lifetime',1,24);
  if(groups[kind]&&!(await emailPreferences(userId,sql))[groups[kind]])return null;
  const safe=safePayload(kind,payload);
  const [job]=await sql`INSERT INTO email_outbox(event_key,kind,user_id,payload,expires_at)
    VALUES(${eventKey},${kind},${userId},${sql.json(safe)},now()+${expiresHours}*interval '1 hour')
    ON CONFLICT(event_key) DO NOTHING RETURNING id,status`;
  return job||null;
}
export function notificationMail(kind,payload,origin) {
  const site=recoveryOrigin(origin);
  if(kind==='password_changed')return {subject:'Your CardShelf password was changed',text:`Your CardShelf password was changed. Other sessions and reset links were invalidated.\n\nIf this was not you, contact your administrator immediately and recover your account at ${site}/forgot-password.\n\nNo password is included in this email.`};
  if(kind==='test')return {subject:'CardShelf email delivery test',text:`This is the administrator-requested delivery test for ${site}. No account access has changed.`};
  if(kind==='membership_changed')return {subject:'Your CardShelf membership was updated',text:`An administrator updated your CardShelf membership access. Sign in to review your current access:\n${site}/membership\n\nYour subscription billing was not changed by this account assignment. You can manage optional email notifications in your CardShelf account.`};
  ensure(kind==='marketplace_enquiry'||kind==='marketplace_reply',400,'Unsupported notification kind.');
  const thread=v.uuid(payload.conversation_id,'Conversation');
  return {subject:kind==='marketplace_enquiry'?'New CardShelf marketplace enquiry':'New reply in your CardShelf conversation',
    text:`You have ${kind==='marketplace_enquiry'?'a new marketplace enquiry':'a new reply in a marketplace conversation'}. Sign in to read it:\n${site}/marketplace/inbox?thread=${thread}\n\nPrivate messages are only shown after you sign in. You can manage optional email notifications in your CardShelf account.`};
}
async function permittedJob(sql,job) {
  const [user]=await sql`SELECT id,email FROM app_users WHERE id=${job.user_id}`;
  if(!user)return {reason:'RECIPIENT_UNAVAILABLE'};
  if(groups[job.kind]&&!(await emailPreferences(user.id,sql))[groups[job.kind]])return {reason:'PREFERENCE_DISABLED'};
  if(job.kind.startsWith('marketplace_')) {
    const [thread]=await sql`SELECT t.id,t.buyer_id,l.seller_id FROM marketplace_conversations t
      JOIN marketplace_listings l ON l.id=t.listing_id
      WHERE t.id=${job.payload.conversation_id} AND NOT l.hidden AND (t.buyer_id=${user.id} OR l.seller_id=${user.id})`;
    if(!thread)return {reason:'EVENT_UNAVAILABLE'};
    if(job.kind==='marketplace_enquiry'&&thread.seller_id!==user.id)return {reason:'RECIPIENT_UNAVAILABLE'};
    if(job.kind==='marketplace_reply') {
      const [message]=await sql`SELECT id FROM marketplace_messages WHERE id=${job.payload.message_id}::bigint
        AND conversation_id=${thread.id} AND sender_id<>${user.id}`;
      if(!message)return {reason:'EVENT_UNAVAILABLE'};
    }
  }
  const address=recoveryEmail(user.email);
  if(await suppressedEmail(address,sql))return {reason:'RECIPIENT_SUPPRESSED'};
  return {address};
}
export function deliveryMessageId(scope,id,origin) {
  ensure(['outbox','recovery'].includes(scope),400,'Invalid email identifier.');v.uuid(id,'Email identifier');
  return `<cardshelf.${scope}.${id}@${new URL(recoveryOrigin(origin)).hostname}>`;
}
export async function processEmailOutbox({sql=db(),send=sendRecoveryEmail,origin=configuration().origin}={}) {
  const config=await deliveryConfiguration(sql);
  if(!config.enabled||!config.configured)return false;
  const lease=randomToken();
  const job=await sql.begin(async tx=>{
    await tx`UPDATE email_outbox SET status='expired',finished_at=now(),updated_at=now(),lease_token=NULL,lease_until=NULL
      WHERE expires_at<=now() AND (status='queued' OR status='sending' AND lease_until<now())`;
    await tx`UPDATE email_outbox SET status=CASE WHEN dispatch_started_at IS NOT NULL THEN 'uncertain' WHEN attempts<3 THEN 'queued' ELSE 'failed' END,
      lease_token=NULL,lease_until=NULL,last_error=CASE WHEN dispatch_started_at IS NOT NULL THEN 'DELIVERY_UNCERTAIN' ELSE 'DELIVERY_INTERRUPTED' END,updated_at=now(),finished_at=CASE WHEN dispatch_started_at IS NOT NULL OR attempts>=3 THEN now() ELSE NULL END
      WHERE status='sending' AND lease_until<now()`;
    const [row]=await tx`SELECT * FROM email_outbox WHERE status='queued' AND attempts<3 AND available_at<=now() AND expires_at>now()
      ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1`;
    if(!row)return null;
    if(!await reserveEmailDispatch(tx,config))return null;
    const [claimed]=await tx`UPDATE email_outbox SET status='sending',attempts=attempts+1,lease_token=${lease},
      lease_until=now()+interval '2 minutes',updated_at=now() WHERE id=${row.id} RETURNING *`;
    return claimed;
  });
  if(!job)return false;
  try {
    const prepared=await permittedJob(sql,job);
    if(prepared.reason) {
      await sql`UPDATE email_outbox SET status='suppressed',last_error=${prepared.reason},finished_at=now(),updated_at=now(),
        lease_token=NULL,lease_until=NULL WHERE id=${job.id} AND lease_token=${lease}`;
      return true;
    }
    const messageId=deliveryMessageId('outbox',job.id,origin),recipientHash=digest(prepared.address);
    const reserved=await sql`UPDATE email_outbox SET message_id=${messageId},recipient_hash=${recipientHash},provider=${config.provider},dispatch_started_at=now(),updated_at=now(),lease_until=now()+interval '2 minutes'
      WHERE id=${job.id} AND lease_token=${lease} AND status='sending' AND lease_until>now() AND expires_at>now() RETURNING id`;
    if(!reserved.length)return true;
    const result=await send(prepared.address,notificationMail(job.kind,job.payload,origin),{messageId,tag:'cardshelf-'+job.kind,configuration:config});
    await sql`UPDATE email_outbox SET status=CASE WHEN status='sending' THEN 'accepted' ELSE status END,
      provider=${result?.provider||config.provider},provider_id=${result?.provider_id?String(result.provider_id):null},
      message_id=${result?.message_id||messageId},accepted_at=coalesce(accepted_at,now()),updated_at=now(),
      lease_token=NULL,lease_until=NULL,last_error=CASE WHEN status='sending' THEN '' ELSE last_error END WHERE id=${job.id} AND lease_token=${lease}`;
  }catch(error) {
    const suppressed=error?.emailCode==='RECIPIENT_SUPPRESSED',rejected=knownEmailRejection(error);
    const failureCode=smtpHistoryCode(error)||'EMAIL_DELIVERY_FAILED';
    await sql`UPDATE email_outbox SET status=CASE WHEN ${suppressed} THEN 'suppressed' WHEN dispatch_started_at IS NOT NULL AND NOT ${rejected} THEN 'uncertain' WHEN attempts<3 THEN 'queued' ELSE 'failed' END,
      available_at=now()+interval '2 minutes',lease_token=NULL,lease_until=NULL,updated_at=now(),
      dispatch_started_at=CASE WHEN ${suppressed||rejected} THEN NULL ELSE dispatch_started_at END,
      last_error=CASE WHEN ${suppressed} THEN 'RECIPIENT_SUPPRESSED' WHEN dispatch_started_at IS NOT NULL AND NOT ${rejected} THEN 'DELIVERY_UNCERTAIN' ELSE ${failureCode} END,
      finished_at=CASE WHEN ${suppressed} OR dispatch_started_at IS NOT NULL AND NOT ${rejected} OR attempts>=3 THEN now() ELSE NULL END
      WHERE id=${job.id} AND lease_token=${lease} AND status='sending'`;
  }
  return true;
}
export async function emailOutboxTick() {
  const sql=db();
  await sql`UPDATE email_outbox SET status='expired',finished_at=now(),updated_at=now(),lease_token=NULL,lease_until=NULL
    WHERE expires_at<=now() AND (status='queued' OR status='sending' AND lease_until<now())`;
  await sql`DELETE FROM email_outbox WHERE coalesce(finished_at,accepted_at,created_at)<now()-interval '30 days' AND status<>'sending'`;
  await sql`DELETE FROM email_webhook_receipts WHERE received_at<now()-interval '30 days'`;
  for(let n=0;n<5;n++)if(!await processEmailOutbox({sql}))break;
}

// Called only after the webhook has verified its signature and exact envelope.
// The caller owns the transaction, including its deduplicated webhook receipt.
export async function applyPostalDeliveryEvent({providerId,messageId,recipient,event,at,sentWithSsl},sql=db()) {
  ensure(['accepted','delivered','failed','bounced','suppressed'].includes(event),400,'Unsupported delivery event.');
  const address=recoveryEmail(recipient),recipientHash=digest(address),timestamp=new Date(at);
  ensure(Number.isFinite(timestamp.getTime()),400,'Invalid delivery event time.');
  let matched=false;
  for(const table of ['email_outbox','password_recovery_mail']) {
    const rows=await sql`SELECT id,status,event_at,accepted_at,created_at FROM ${sql(table)} WHERE recipient_hash=${recipientHash}
      AND provider='postal' AND provider_id=${String(providerId)} AND message_id=${messageId} FOR UPDATE`;
    for(const row of rows) {
      matched=true;
      if(timestamp.getTime()<new Date(row.created_at).getTime()-300000)continue;
      if(row.event_at){
        const previous=new Date(row.event_at).getTime(),rank={accepted:0,failed:1,delivered:2,suppressed:3,bounced:4};
        // Postal timestamps have second precision. A bounce in the same second
        // as delivery must still win, regardless of webhook arrival order.
        if(timestamp.getTime()<previous||timestamp.getTime()===previous&&(rank[event]??-1)<=(rank[row.status]??-1))continue;
      }
      // A delayed/held event must never undo confirmed delivery or a terminal failure.
      if(event==='accepted'&&['delivered','bounced','failed','suppressed'].includes(row.status))continue;
      // A bounce can follow a delivery confirmation; other failures cannot undo it.
      if(row.status==='delivered'&&!['delivered','bounced'].includes(event)||row.status==='bounced'&&event!=='bounced')continue;
      await sql`UPDATE ${sql(table)} SET status=${event},provider='postal',provider_id=${String(providerId)},event_at=${timestamp},
        sent_with_ssl=CASE WHEN ${typeof sentWithSsl==='boolean'} THEN ${typeof sentWithSsl==='boolean'?sentWithSsl:null} ELSE sent_with_ssl END,
        delivered_at=CASE WHEN ${event}='delivered' THEN ${timestamp} ELSE delivered_at END,
        finished_at=CASE WHEN ${event}<>'accepted' THEN now() ELSE finished_at END,
        last_error=${event==='failed'?'POSTAL_DELIVERY_FAILED':event==='bounced'?'POSTAL_BOUNCED':event==='suppressed'?'RECIPIENT_SUPPRESSED':''}
        WHERE id=${row.id}`;
      if(['bounced','suppressed'].includes(event))await sql`INSERT INTO email_suppressions(email,reason,source)
        VALUES(${address},${event==='bounced'?'Postal bounce':'Postal suppression'},'postal') ON CONFLICT(email) DO NOTHING`;
    }
  }
  return {matched};
}
