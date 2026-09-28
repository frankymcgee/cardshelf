import webpush from 'web-push';
import { randomUUID } from 'node:crypto';
import { db } from './db.mjs';
import { configuration } from './config.mjs';
import { digest, randomToken } from './security.mjs';
import { ensure } from './errors.mjs';
import * as v from './validate.mjs';
import { PUSH_GROUPS,pushObject,pushEndpoint,pushSubscription,pushPreferences,pushPayload,pushMessage,pushOriginReady } from './push-logic.mjs';

export async function pushIdentity(sql=db()) {
  const [existing]=await sql`SELECT public_key,private_key FROM push_identity WHERE singleton`;
  if(existing)return existing;
  const keys=webpush.generateVAPIDKeys();
  await sql`INSERT INTO push_identity(public_key,private_key) VALUES(${keys.publicKey},${keys.privateKey}) ON CONFLICT(singleton) DO NOTHING`;
  return (await sql`SELECT public_key,private_key FROM push_identity WHERE singleton`)[0];
}
export async function pushConfiguration() {
  const available=pushOriginReady(configuration().origin);
  return {available,public_key:available?(await pushIdentity()).public_key:null};
}
const view=row=>row?{enabled:true,marketplace:row.marketplace,membership:row.membership,revision:row.revision}:{enabled:false};
export async function pushStatus(userId,token,input,sql=db()) {
  const {endpoint}=pushObject(input,['endpoint']);
  const [row]=await sql`SELECT p.marketplace,p.membership,p.revision FROM push_subscriptions p JOIN sessions s ON s.token_hash=p.session_hash
    WHERE p.user_id=${userId} AND p.session_hash=${digest(token)} AND p.endpoint=${pushEndpoint(endpoint)} AND s.expires_at>now()`;
  return view(row);
}
export async function savePushSubscription(userId,token,input,sql=db()) {
  const data=pushObject(input,['subscription','preferences']),subscription=pushSubscription(data.subscription),preferences=pushPreferences(data.preferences);
  return sql.begin(async tx=>{
    await tx`SELECT id FROM app_users WHERE id=${userId} FOR UPDATE`;
    ensure((await tx`SELECT token_hash FROM sessions WHERE token_hash=${digest(token)} AND user_id=${userId} AND expires_at>now() FOR SHARE`).length,401,'Sign in again to enable notifications.');
    const [previous]=await tx`SELECT id,user_id FROM push_subscriptions WHERE endpoint=${subscription.endpoint} FOR UPDATE`;
    ensure(!previous||previous.user_id===userId,409,'Reset notifications on this device before linking another account.');
    if(!previous)ensure(Number((await tx`SELECT count(*) AS n FROM push_subscriptions WHERE user_id=${userId}`)[0].n)<10,409,'You have reached the limit of 10 notification devices. Sign out of an unused device first.');
    const [row]=await tx`INSERT INTO push_subscriptions(user_id,session_hash,endpoint,p256dh,auth,marketplace,membership)
      VALUES(${userId},${digest(token)},${subscription.endpoint},${subscription.keys.p256dh},${subscription.keys.auth},${preferences.marketplace},${preferences.membership})
      ON CONFLICT(endpoint) DO UPDATE SET session_hash=excluded.session_hash,p256dh=excluded.p256dh,auth=excluded.auth,
        marketplace=excluded.marketplace,membership=excluded.membership,revision=push_subscriptions.revision+1,updated_at=now()
      WHERE push_subscriptions.user_id=excluded.user_id RETURNING marketplace,membership,revision`;
    ensure(row,409,'This device was linked in another session. Try again.');return view(row);
  });
}
export async function updatePushPreferences(userId,token,input,sql=db()) {
  const data=pushObject(input,['endpoint','preferences','revision']),preferences=pushPreferences(data.preferences),revision=v.integer(data.revision,'Revision',1,2147483647);
  const [row]=await sql`UPDATE push_subscriptions SET marketplace=${preferences.marketplace},membership=${preferences.membership},revision=revision+1,updated_at=now()
    WHERE endpoint=${pushEndpoint(data.endpoint)} AND user_id=${userId} AND session_hash=${digest(token)} AND revision=${revision} RETURNING marketplace,membership,revision`;
  ensure(row,409,'Notification settings changed. Reload before saving.');return view(row);
}
export async function removePushSubscription(userId,token,input,sql=db()) {
  const {endpoint}=pushObject(input,['endpoint']);
  await sql`DELETE FROM push_subscriptions WHERE endpoint=${pushEndpoint(endpoint)} AND user_id=${userId} AND session_hash=${digest(token)}`;
  return {enabled:false};
}
export async function enqueuePush(sql,{eventKey,kind,userId,payload={}}) {
  ensure(typeof eventKey==='string'&&eventKey.length>0&&eventKey.length<=200,400,'Invalid notification event.');v.uuid(userId);
  const safe=pushPayload(kind,payload),group=PUSH_GROUPS[kind];
  ensure(group,400,'Unsupported notification group.');
  await sql`INSERT INTO push_outbox(event_key,subscription_id,kind,payload)
    SELECT ${eventKey},p.id,${kind},${sql.json(safe)} FROM push_subscriptions p JOIN sessions s ON s.token_hash=p.session_hash
    WHERE p.user_id=${userId} AND s.expires_at>now() AND p.${sql(group)}
    ON CONFLICT(event_key,subscription_id) DO NOTHING`;
}
export async function queuePushTest(userId,token,input,sql=db()) {
  const {endpoint}=pushObject(input,['endpoint']);
  const rows=await sql`INSERT INTO push_outbox(event_key,subscription_id,kind,expires_at)
    SELECT ${'test:'+randomUUID()},p.id,'test',now()+interval '5 minutes' FROM push_subscriptions p JOIN sessions s ON s.token_hash=p.session_hash
    WHERE p.user_id=${userId} AND p.session_hash=${digest(token)} AND p.endpoint=${pushEndpoint(endpoint)} AND s.expires_at>now() RETURNING id`;
  ensure(rows.length,409,'Enable notifications on this device first.');return {queued:true};
}
async function permitted(sql,job) {
  const [device]=await sql`SELECT p.* FROM push_subscriptions p JOIN sessions s ON s.token_hash=p.session_hash
    WHERE p.id=${job.subscription_id} AND s.user_id=p.user_id AND s.expires_at>now()`;
  if(!device||(PUSH_GROUPS[job.kind]&&!device[PUSH_GROUPS[job.kind]]))return null;
  if(job.kind.startsWith('marketplace_')) {
    const [thread]=await sql`SELECT t.id,t.buyer_id,l.seller_id FROM marketplace_conversations t JOIN marketplace_listings l ON l.id=t.listing_id
      WHERE t.id=${job.payload.conversation_id} AND NOT l.hidden AND (t.buyer_id=${device.user_id} OR l.seller_id=${device.user_id})`;
    if(!thread||job.kind==='marketplace_enquiry'&&thread.seller_id!==device.user_id)return null;
    if(job.kind==='marketplace_reply'&&!(await sql`SELECT id FROM marketplace_messages WHERE id=${job.payload.message_id}::bigint AND conversation_id=${thread.id} AND sender_id<>${device.user_id}`).length)return null;
  }
  return device;
}
export async function processPushOutbox({sql=db(),send=webpush.sendNotification.bind(webpush),origin=configuration().origin}={}) {
  const lease=randomToken();
  const job=await sql.begin(async tx=>{
    await tx`UPDATE push_outbox SET status='expired',finished_at=now(),lease_token=NULL,lease_until=NULL WHERE expires_at<=now() AND (status='queued' OR status='sending' AND lease_until<now())`;
    await tx`UPDATE push_outbox SET status=CASE WHEN attempts<3 THEN 'queued' ELSE 'failed' END,lease_token=NULL,lease_until=NULL,
      finished_at=CASE WHEN attempts>=3 THEN now() ELSE NULL END WHERE status='sending' AND lease_until<now()`;
    const [next]=await tx`SELECT id FROM push_outbox WHERE status='queued' AND attempts<3 AND available_at<=now() AND expires_at>now() ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1`;
    if(!next)return null;
    return (await tx`UPDATE push_outbox SET status='sending',attempts=attempts+1,lease_token=${lease},lease_until=now()+interval '2 minutes' WHERE id=${next.id} RETURNING *`)[0];
  });
  if(!job)return false;
  try {
    const device=await permitted(sql,job);
    if(!device) {
      await sql`UPDATE push_outbox SET status='suppressed',finished_at=now(),lease_token=NULL,lease_until=NULL WHERE id=${job.id} AND lease_token=${lease}`;
      return true;
    }
    const identity=await pushIdentity(sql),subscription=pushSubscription({endpoint:device.endpoint,keys:{p256dh:device.p256dh,auth:device.auth}});
    const ttl=Math.min(3600,Math.floor((new Date(job.expires_at).getTime()-Date.now())/1000));
    if(ttl<=0) {
      await sql`UPDATE push_outbox SET status='expired',finished_at=now(),lease_token=NULL,lease_until=NULL WHERE id=${job.id} AND lease_token=${lease}`;return true;
    }
    await send(subscription,JSON.stringify(pushMessage(job.kind,job.payload,job.event_key)),{
      vapidDetails:{subject:origin,publicKey:identity.public_key,privateKey:identity.private_key},
      TTL:ttl,timeout:10000,urgency:'normal',contentEncoding:'aes128gcm',topic:digest(job.event_key).slice(0,32)
    });
    await sql`UPDATE push_outbox SET status='accepted',finished_at=now(),lease_token=NULL,lease_until=NULL WHERE id=${job.id} AND lease_token=${lease}`;
  } catch(error) {
    if([404,410].includes(error?.statusCode)) {
      await sql`DELETE FROM push_subscriptions WHERE id=${job.subscription_id}`;
    } else {
      // No provider response, endpoint, auth secret or VAPID key is logged.
      const transient=!error?.statusCode||error.statusCode===429||error.statusCode>=500;
      await sql`UPDATE push_outbox SET status=CASE WHEN ${transient} AND attempts<3 THEN 'queued' ELSE 'failed' END,
        available_at=now()+attempts*interval '2 minutes',lease_token=NULL,lease_until=NULL,
        finished_at=CASE WHEN NOT ${transient} OR attempts>=3 THEN now() ELSE NULL END WHERE id=${job.id} AND lease_token=${lease}`;
    }
  }
  return true;
}
export async function pushOutboxTick() {
  const sql=db();
  await sql`DELETE FROM push_subscriptions WHERE session_hash IN (SELECT token_hash FROM sessions WHERE expires_at<=now())`;
  await sql`DELETE FROM push_outbox WHERE coalesce(finished_at,created_at)<now()-interval '7 days' AND status<>'sending'`;
  if(!pushOriginReady(configuration().origin))return;
  for(let n=0;n<10;n++)if(!await processPushOutbox({sql}))break;
}
