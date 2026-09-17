import { db } from './db.mjs';
import { ensure } from './errors.mjs';
import { signatureValid,squareConfiguration,squareId } from './subscription-logic.mjs';
const EVENTS=new Set(['subscription.created','subscription.updated','invoice.published','invoice.payment_made','invoice.refunded','invoice.updated','invoice.scheduled_charge_failed','payment.updated','refund.created','refund.updated','dispute.created','dispute.state.updated']);
export async function receiveSquareWebhook(raw,signature) {
  const cfg=squareConfiguration();ensure(cfg.configured,503,'Square webhooks are not configured.');
  ensure(signatureValid(raw,signature,cfg.signatureKey,cfg.webhookUrl),403,'Invalid Square webhook signature.');
  let e;try{e=JSON.parse(raw.toString('utf8'));}catch{ensure(false,400,'Invalid webhook JSON.');}
  ensure(e?.merchant_id===cfg.merchant,403,'Unexpected Square merchant.');
  const eventId=squareId(e.event_id);
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
