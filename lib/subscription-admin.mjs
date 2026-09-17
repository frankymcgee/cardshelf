import { db,audit } from './db.mjs';
import { ensure } from './errors.mjs';
import * as v from './validate.mjs';
import { squareConfiguration,publicConfiguration,strictObject,squareId } from './subscription-logic.mjs';
export async function subscriptionAdmin(query={}) {
  const sql=db(),cfg=squareConfiguration(),page=v.integer(Number(query.page??1),'Page',1,10000),q=v.text(String(query.q??''),'Search',0,100);
  const [members,offers,partners,commissions,events,heartbeat]=await Promise.all([
    sql`SELECT u.id,u.name,u.email,u.role,g.kind AS tester_grant,o.tier,o.reason,o.expires_at,coalesce(o.revision,0) AS revision,to_jsonb(p) AS referral_partner
      FROM app_users u LEFT JOIN account_access_grants g ON g.user_id=u.id LEFT JOIN account_tier_overrides o ON o.user_id=u.id LEFT JOIN referral_partners p ON p.user_id=u.id
      WHERE u.name ILIKE ${'%'+q+'%'} OR u.email ILIKE ${'%'+q+'%'} ORDER BY u.created_at,u.id LIMIT 50 OFFSET ${(page-1)*50}`,
    sql`SELECT * FROM subscription_offers WHERE environment=${cfg.environment} ORDER BY created_at DESC LIMIT 50 OFFSET ${(page-1)*50}`,
    sql`SELECT p.*,u.name,u.email FROM referral_partners p JOIN app_users u ON u.id=p.user_id ORDER BY approved_at DESC LIMIT 50 OFFSET ${(page-1)*50}`,
    sql`SELECT c.*,u.name AS partner_name,u.email AS partner_email,i.subscription_id,i.verified_at,i.status AS invoice_status
      FROM referral_commissions c JOIN referral_attributions a ON a.id=c.attribution_id JOIN app_users u ON u.id=a.partner_user_id
      JOIN square_invoices i ON i.environment=c.environment AND i.square_id=c.invoice_id ORDER BY c.created_at DESC LIMIT 50 OFFSET ${(page-1)*50}`,
    sql`SELECT event_id,event_type,status,attempts,last_error,received_at FROM square_webhook_events WHERE environment=${cfg.environment} AND status<>'done' ORDER BY received_at LIMIT 50`,
    sql`SELECT updated_at FROM app_state WHERE key='billing_heartbeat'`
  ]);
  const subscriptions=await sql`SELECT s.id,s.user_id,s.status,s.current,s.paid_through,s.canceled_date,s.last_error,s.synced_at,s.offer_snapshot->>'plan_code' AS plan_code,u.email
    FROM square_subscriptions s JOIN app_users u ON u.id=s.user_id WHERE s.environment=${cfg.environment} ORDER BY s.created_at DESC LIMIT 50 OFFSET ${(page-1)*50}`;
  return {...publicConfiguration(cfg),members,offers,partners,commissions,events,subscriptions,page,has_more:[members,offers,partners,commissions,subscriptions].some(rows=>rows.length===50),worker_seen_at:heartbeat[0]?.updated_at??null};
}
export async function retryWebhook(actorId,eventId) {
  squareId(eventId);const cfg=squareConfiguration();
  await db()`UPDATE square_webhook_events SET status='queued',next_attempt_at=now(),attempts=0,last_error='' WHERE environment=${cfg.environment} AND event_id=${eventId}`;
  await audit(db(),actorId,'billing.webhook_retry',{event_id:eventId});return {queued:true};
}
