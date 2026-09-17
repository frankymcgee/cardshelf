import { resolveSquareConfiguration } from './square-connector.mjs';
import { db } from './db.mjs';
import { ensure } from './errors.mjs';
import { signatureValid,squareId } from './subscription-logic.mjs';
const EVENTS=new Set(['subscription.created','subscription.updated','invoice.published','invoice.payment_made','invoice.refunded','invoice.updated','invoice.scheduled_charge_failed','payment.updated','refund.created','refund.updated','dispute.created','dispute.state.updated']);
export async function receiveSquareWebhook(raw,signature) {
  const cfg=await resolveSquareConfiguration();ensure(cfg.signatureKey&&cfg.merchant,503,'Square webhooks are not configured.');
  ensure(signatureValid(raw,signature,cfg.signatureKey,cfg.webhookUrl),403,'Invalid Square webhook signature.');
  let e;try{e=JSON.parse(raw.toString('utf8'));}catch{ensure(false,400,'Invalid webhook JSON.');}
  ensure(e?.merchant_id===cfg.merchant,403,'Unexpected Square merchant.');
  const eventId=squareId(e.event_id);
  await db()`UPDATE square_connections SET webhook_seen_at=now() WHERE environment=${cfg.environment} AND merchant_id=${cfg.merchant}`;
  if(e.type==='oauth.authorization.revoked'){
    const revokedAt=e.data?.object?.revocation?.revoked_at??e.created_at;
    ensure(typeof revokedAt==='string'&&Number.isFinite(Date.parse(revokedAt)),400,'Revocation timestamp is missing.');
    await db().begin(async sql=>{
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${'square-connector:'+cfg.environment},0))`;
      const rows=await sql`INSERT INTO square_webhook_events(environment,event_id,event_type,status)
        VALUES(${cfg.environment},${eventId},${e.type},'done') ON CONFLICT DO NOTHING RETURNING event_id`;
      // Ignore duplicate/older notifications after a successful new authorization.
      if(rows.length)await sql`UPDATE square_connections SET source='disconnected',access_secret=NULL,refresh_secret=NULL,
        expires_at=NULL,revision=revision+1,last_error='Square authorization was revoked. Reconnect this business.'
        WHERE environment=${cfg.environment} AND source='oauth' AND connected_at<=${revokedAt}::timestamptz`;
    });
    return {received:true};
  }
  if(!EVENTS.has(e.type))return {received:true};
  const kind=e.type.split('.')[0],object=e.data?.object?.[kind]??{};
  const resourceId=squareId(object.id??e.data?.id);
  const paymentId=object.payment_id??object.disputed_payment?.payment_id??(kind==='payment'?resourceId:null);
  if(paymentId)squareId(paymentId);
  // Store only routing identifiers. Never retain a raw webhook full of customer/payment data.
  await db()`INSERT INTO square_webhook_events(environment,event_id,event_type,resource_id,payment_id)
    VALUES(${cfg.environment},${eventId},${e.type},${resourceId},${paymentId}) ON CONFLICT DO NOTHING`;
  return {received:true};
}
