import { resolveSquareConfiguration } from './square-connector.mjs';
import { db } from './db.mjs';
import { squareRequest,resourcePath } from './square-client.mjs';
import { syncSubscription } from './square-subscriptions.mjs';
let busy=false,lastRun=0;
export async function billingTick(api=squareRequest) {
  const cfg=await resolveSquareConfiguration();if(!cfg.configured||busy||Date.now()-lastRun<15000)return;
  busy=true;lastRun=Date.now();const sql=db();
  try {
    await sql`INSERT INTO app_state(key,value) VALUES('billing_heartbeat','{}'::jsonb) ON CONFLICT(key) DO UPDATE SET updated_at=now()`;
    // DB-level lock serialises workers; persisted event IDs make duplicate deliveries harmless.
    await sql.begin(async tx=>{
      const [lock]=await tx`SELECT pg_try_advisory_xact_lock(72490702) AS acquired`;if(!lock.acquired)return;
      const events=await tx`SELECT * FROM square_webhook_events WHERE environment=${cfg.environment} AND status='queued' AND next_attempt_at<=now() ORDER BY received_at LIMIT 1 FOR UPDATE SKIP LOCKED`;
      for(const event of events){
        try {
          const kind=event.event_type.split('.')[0];let row,extra=null;
          if(kind==='subscription') [row]=await sql`SELECT id FROM square_subscriptions WHERE environment=${cfg.environment} AND square_id=${event.resource_id}`;
          else if(kind==='invoice'){
            const {invoice}=await api(resourcePath('invoices',event.resource_id));
            [row]=await sql`SELECT id FROM square_subscriptions WHERE environment=${cfg.environment} AND square_id=${invoice?.subscription_id??''}`;
            if(row)extra=event.resource_id;
          }else if(event.payment_id){
            [row]=await sql`SELECT i.subscription_id AS id,i.square_id FROM square_invoice_payments p JOIN square_invoices i ON i.environment=p.environment AND i.square_id=p.invoice_id WHERE p.environment=${cfg.environment} AND p.payment_id=${event.payment_id}`;
            if(row)extra=row.square_id;
            if(row&&kind==='dispute'){
              const {dispute}=await api(resourcePath('disputes',event.resource_id));
              const paymentId=dispute?.disputed_payment?.payment_id??dispute?.payment_id;
              if(paymentId!==event.payment_id)throw new Error('Dispute identity mismatch.');
              // Any disputed subscription invoice is held for operator review; no automatic payout.
              await sql`UPDATE square_invoices SET disputed=true WHERE environment=${cfg.environment} AND square_id=${row.square_id}`;
            }
          }
          if(row)await syncSubscription(row.id,null,api,extra);
          else if(['refund','dispute','payment'].includes(kind))throw new Error('Payment is not mapped yet. Retain this event for retry.');
          await tx`UPDATE square_webhook_events SET status='done',attempts=attempts+1,last_error='' WHERE environment=${cfg.environment} AND event_id=${event.event_id}`;
        }catch{
          await tx`UPDATE square_webhook_events SET attempts=attempts+1,status=CASE WHEN attempts>=9 THEN 'failed' ELSE 'queued' END,
            next_attempt_at=now()+interval '5 minutes',last_error='Square reconciliation failed. Review the provider record and retry.' WHERE environment=${cfg.environment} AND event_id=${event.event_id}`;
        }
      }
      const [due]=await sql`SELECT id FROM square_subscriptions WHERE environment=${cfg.environment} AND square_id IS NOT NULL AND next_sync_at<=now() ORDER BY next_sync_at,id LIMIT 1`;
      if(due)try{await syncSubscription(due.id,null,api);}catch{
        await sql`UPDATE square_subscriptions SET next_sync_at=now()+interval '15 minutes',last_error='Automatic reconciliation needs review. Previous verified access has not been extended.' WHERE id=${due.id}`;
      }
    });
  }finally{busy=false;}
}
