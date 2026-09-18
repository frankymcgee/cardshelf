import { db } from './db.mjs';
import { ensure } from './errors.mjs';
import { stripeConfig } from './stripe-connection.mjs';
import { stripeSignature,stripeEnvironment,stripeId,objectId } from './stripe-logic.mjs';
import { stripeRequest } from './stripe-client.mjs';
import { syncStripeSubscription } from './stripe-subscriptions.mjs';
export const STRIPE_EVENTS=Object.freeze(['checkout.session.completed','checkout.session.expired','customer.subscription.created','customer.subscription.updated','customer.subscription.deleted','invoice.paid','invoice.payment_failed','invoice.updated','charge.refunded','charge.dispute.created','charge.dispute.updated','charge.dispute.closed','refund.created','refund.updated']);
export async function receiveStripeWebhook(environment,raw,signature) {
  const env=stripeEnvironment(environment),cfg=await stripeConfig(env);
  ensure(cfg.webhookSecret,503,'Stripe webhook is not configured.');ensure(stripeSignature(raw,signature,cfg.webhookSecret),400,'Stripe signature is invalid or expired.');
  let event;try{event=JSON.parse(raw.toString('utf8'));}catch{ensure(false,400,'Invalid Stripe event.');}
  stripeId(event.id,'evt');ensure(event.object==='event'&&event.livemode===(env==='production')&&!event.account,400,'Unexpected Stripe event mode or connected-account event.');
  if(!STRIPE_EVENTS.includes(event.type))return {received:true};
  const resource=event.data?.object?.id;ensure(typeof resource==='string'&&/^[a-z]+_[A-Za-z0-9_]{1,240}$/.test(resource),400,'Invalid Stripe event resource.');
  await db().begin(async sql=>{
    // No payment payload, customer identity or card details are stored in the event queue.
    await sql`INSERT INTO stripe_webhook_events(environment,event_id,event_type,resource_id) VALUES(${env},${event.id},${event.type},${resource}) ON CONFLICT DO NOTHING`;
    await sql`UPDATE stripe_connections SET webhook_seen_at=now() WHERE environment=${env}`;
  });return {received:true};
}
async function processEvent(event,api) {
  const cfg=await stripeConfig(event.environment),sql=db();ensure(cfg.configured,503,'Stripe credentials unavailable.');
  // An authenticated re-fetch binds even a misconfigured signing secret to the saved Stripe account.
  const checked=await api(cfg,'/v1/events/'+event.event_id);
  ensure(checked.id===event.event_id&&checked.type===event.event_type&&checked.livemode===(event.environment==='production')&&!checked.account&&checked.data?.object?.id===event.resource_id,409,'Stripe event identity mismatch.');
  const obj=checked.data.object;let row=null,invoiceId=null,sessionHint=null;
  if(event.event_type.startsWith('checkout.session.')){
    [row]=await sql`SELECT id FROM stripe_subscriptions WHERE environment=${event.environment} AND (session_id=${obj.id} OR id::text=${obj.client_reference_id||''})`;
    sessionHint=obj.id;
  }else if(event.event_type.startsWith('customer.subscription.')){
    [row]=await sql`SELECT id FROM stripe_subscriptions WHERE environment=${event.environment} AND (stripe_id=${obj.id} OR id::text=${obj.metadata?.cardshelf_request||''})`;
  }else if(event.event_type.startsWith('invoice.')){
    const invoice=await api(cfg,'/v1/invoices/'+obj.id);invoiceId=invoice.id;
    const subId=objectId(invoice.parent?.subscription_details?.subscription);
    if(subId)[row]=await sql`SELECT id FROM stripe_subscriptions WHERE environment=${event.environment} AND stripe_id=${subId}`;
    if(!row&&subId){const sub=await api(cfg,'/v1/subscriptions/'+stripeId(subId,'sub'));[row]=await sql`SELECT id FROM stripe_subscriptions WHERE environment=${event.environment} AND id::text=${sub.metadata?.cardshelf_request||''}`;}
  }else{
    const chargeId=event.event_type==='charge.refunded'?obj.id:objectId(obj.charge);
    if(chargeId){const [invoice]=await sql`SELECT subscription_id,stripe_id FROM stripe_invoices WHERE environment=${event.environment} AND charge_id=${chargeId}`;if(invoice){row={id:invoice.subscription_id};invoiceId=invoice.stripe_id;}}
  }
  if(row)await syncStripeSubscription(row.id,null,api,invoiceId,sessionHint);
}
let ticking=false;
export async function stripeTick(api=stripeRequest) {
  if(ticking)return;ticking=true;const sql=db();
  try{
    // A process without decryptable credentials must not take the shared lease
    // or consume retries for work another instance can reconcile. Check both
    // modes: pausing new billing or selecting Test must not stop Live renewals.
    const configs=await Promise.all(['sandbox','production'].map(env=>stripeConfig(env)));
    const environments=configs.filter(cfg=>cfg.configured).map(cfg=>cfg.environment);
    if(!environments.length)return;
    // A short lease, rather than a held DB connection, also bounds work across server instances.
    const lease=await sql`INSERT INTO app_state(key,value) VALUES('stripe_worker_lease','{}'::jsonb)
      ON CONFLICT(key) DO UPDATE SET updated_at=now() WHERE app_state.updated_at<now()-interval '2 minutes' RETURNING key`;
    if(!lease.length)return;
    await sql`INSERT INTO app_state(key,value) VALUES('stripe_heartbeat','{}'::jsonb) ON CONFLICT(key) DO UPDATE SET updated_at=now()`;
    try{
      const events=await sql`SELECT * FROM stripe_webhook_events WHERE environment IN ${sql(environments)} AND status='queued' AND next_attempt_at<=now() ORDER BY received_at LIMIT 3`;
      for(const e of events)try{await processEvent(e,api);await sql`UPDATE stripe_webhook_events SET status='done',last_error='' WHERE environment=${e.environment} AND event_id=${e.event_id}`;}
      catch{await sql`UPDATE stripe_webhook_events SET attempts=attempts+1,status=CASE WHEN attempts>=9 THEN 'failed' ELSE 'queued' END,next_attempt_at=now()+interval '5 minutes',last_error='Stripe reconciliation failed. Check account, permissions and subscription details; retry after correction.' WHERE environment=${e.environment} AND event_id=${e.event_id}`;}
      const rows=await sql`SELECT id FROM stripe_subscriptions WHERE environment IN ${sql(environments)} AND next_sync_at<=now() AND (session_id IS NOT NULL OR customer_id IS NOT NULL) AND (current OR paid_through>now()) ORDER BY next_sync_at LIMIT 2`;
      for(const r of rows)try{await syncStripeSubscription(r.id,null,api);}catch{await sql`UPDATE stripe_subscriptions SET next_sync_at=now()+interval '15 minutes',last_error='Stripe payment reconciliation needs administrator attention.' WHERE id=${r.id}`;}
    }finally{await sql`UPDATE app_state SET updated_at=now()-interval '105 seconds' WHERE key='stripe_worker_lease'`;}
  }finally{ticking=false;}
}
