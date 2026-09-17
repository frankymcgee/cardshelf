import { resolveSquareConfiguration } from './square-connector.mjs';
import { db,audit } from './db.mjs';
import { AppError,ensure } from './errors.mjs';
import * as v from './validate.mjs';
import { squareRequest,resourcePath } from './square-client.mjs';
import { publicConfiguration,strictObject,offerInput,verifyVariation,hashValue,offerTotal,today,invoiceUrl,invoiceAmounts,invoicePeriodEnd,invoiceCycle,squareId } from './subscription-logic.mjs';
import { membershipState } from './membership.mjs';
import { reconcileCommission } from './subscription-referrals.mjs';
export async function listOffers() {
  const cfg=await resolveSquareConfiguration();
  if(!cfg.enabled||!cfg.configured)return {...publicConfiguration(cfg),offers:[]};
  const rows=await db()`SELECT id,plan_code,cadence,amount_minor,tax_bps,terms,terms_hash,revision FROM subscription_offers WHERE environment=${cfg.environment} AND published ORDER BY plan_code,cadence`;
  return {...publicConfiguration(cfg),offers:rows.map(o=>({...o,total_minor:offerTotal(o)}))};
}
export async function saveOffer(actorId,input) {
  const cfg=await resolveSquareConfiguration(),o=offerInput(input);
  const [saved]=await db()`INSERT INTO subscription_offers(environment,plan_code,cadence,variation_id,amount_minor,tax_bps,terms,terms_hash)
    VALUES(${cfg.environment},${o.plan_code},${o.cadence},${o.variation_id},${o.amount_minor},${o.tax_bps},${o.terms},${hashValue(o)})
    ON CONFLICT(environment,variation_id) DO NOTHING RETURNING *`;
  ensure(saved,409,'That Square variation already has an offer. Use a new variation for changed terms or prices.');
  await audit(db(),actorId,'billing.offer_drafted',{offer_id:saved.id});return saved;
}
export async function publishOffer(actorId,id,input,api=squareRequest) {
  const cfg=await resolveSquareConfiguration({refresh:true}),o=strictObject(input,['revision','published','confirm_terms_reviewed']);v.uuid(id);
  if(api===squareRequest)api=(path,body,method)=>squareRequest(path,body,method,cfg);
  const revision=v.integer(o.revision,'Revision',1),published=v.bool(o.published,'Published');
  const [offer]=await db()`SELECT * FROM subscription_offers WHERE id=${id} AND environment=${cfg.environment}`;
  ensure(offer&&offer.revision===revision,409,'Offer changed. Reload before publishing.');
  if(published){
    ensure(o.confirm_terms_reviewed===true,400,'Review the customer-facing terms, tax settings and Square price first.');
    const {location}=await api(resourcePath('locations',cfg.location));
    ensure(location?.id===cfg.location&&location.merchant_id===cfg.merchant&&location.currency==='AUD'&&location.status==='ACTIVE',409,'Use an active AUD location for this Square merchant.');
    ensure(location.timezone===cfg.timezone,409,'SQUARE_TIMEZONE must match the Square location timezone.');
    const {object}=await api(resourcePath('catalog/object',offer.variation_id));verifyVariation(object,offer,cfg.location);
  }
  return db().begin(async sql=>{
    await sql`SELECT pg_advisory_xact_lock(72490701)`;
    const [check]=await sql`SELECT revision FROM subscription_offers WHERE id=${id} FOR UPDATE`;
    ensure(check?.revision===revision,409,'Offer changed. Reload.');
    if(published)await sql`UPDATE subscription_offers SET published=false,revision=revision+1 WHERE environment=${cfg.environment} AND plan_code=${offer.plan_code} AND cadence=${offer.cadence} AND published AND id<>${id}`;
    const [saved]=await sql`UPDATE subscription_offers SET published=${published},verified_at=${published?new Date():offer.verified_at},revision=revision+1 WHERE id=${id} RETURNING *`;
    await audit(sql,actorId,'billing.offer_publication',{offer_id:id,published});return saved;
  });
}
export async function billingAccount(userId) {
  const cfg=await resolveSquareConfiguration(),sql=db();
  const [state,subscriptions]=await Promise.all([membershipState(userId),sql`SELECT id,request_id,(square_id IS NOT NULL) AS confirmed,status,offer_snapshot,environment,paid_through,canceled_date,current,invoice_url,last_error,synced_at,created_at FROM square_subscriptions WHERE user_id=${userId} AND environment=${cfg.environment} ORDER BY created_at DESC LIMIT 20`]);
  return {...publicConfiguration(cfg),...state,subscriptions,flow_notice:cfg.environment==='sandbox'?'Sandbox uses synthetic customer details. Open the invoice link for test payments; do not use real payment details.':'Square emails recurring subscription invoices. Pay on Square. No card number or bank details are collected by CardShelf.'};
}
export async function startSubscription(userId,input,api=squareRequest) {
  const cfg=await resolveSquareConfiguration({refresh:true});ensure(cfg.enabled&&cfg.configured,409,'Subscription checkout is not enabled.');
  if(api===squareRequest)api=(path,body,method)=>squareRequest(path,body,method,cfg);
  const o=strictObject(input,['offer_id','revision','terms_hash','request_id','consent']);
  const offerId=v.uuid(o.offer_id),requestId=v.uuid(o.request_id),revision=v.integer(o.revision,'Revision',1);
  ensure(o.consent===true,400,'Explicit acceptance of the recurring subscription terms is required.');
  const result=await db().begin(async sql=>{
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${'billing:'+userId},0))`;
    const [user]=await sql`SELECT id,name,email FROM app_users WHERE id=${userId}`;ensure(user,404,'Account not found.');
    const [existing]=await sql`SELECT * FROM square_subscriptions WHERE user_id=${userId} AND environment=${cfg.environment} AND request_id=${requestId}`;
    if(existing){ensure(existing.offer_id===offerId&&existing.offer_snapshot.terms_hash===o.terms_hash&&existing.offer_snapshot.revision===revision,409,'This request ID belongs to different subscription terms.');if(existing.square_id)return {id:existing.id,replayed:true};}
    const [offer]=await sql`SELECT * FROM subscription_offers WHERE id=${offerId} AND environment=${cfg.environment}`;
    ensure(offer&&((offer.published&&offer.revision===revision&&offer.terms_hash===o.terms_hash)||existing),409,'Offer changed or is no longer available. Review it again.');
    const state=await membershipState(userId,sql,cfg);
    ensure(!state.grant&&state.access.reason!=='complimentary'&&state.access.reason!=='administrator',409,'This account already has full free access. No subscription is needed.');
    if(!existing){
      ensure(!(await sql`SELECT id FROM square_subscriptions WHERE user_id=${userId} AND environment=${cfg.environment} AND (current OR paid_through>${today(cfg.timezone)})`).length,409,'A subscription or pending request already exists. Review it instead of starting another.');
    }
    const snapshot=existing?.offer_snapshot??{...offer,total_minor:offerTotal(offer)};
    const {object}=await api(resourcePath('catalog/object',snapshot.variation_id));verifyVariation(object,snapshot,cfg.location);
    const [row]=existing?[existing]:await sql`INSERT INTO square_subscriptions(user_id,environment,offer_id,request_id,offer_snapshot,start_date)
      VALUES(${userId},${cfg.environment},${offerId},${requestId},${sql.json(snapshot)},${today(cfg.timezone)}) RETURNING *`;
    // Commit completed provider stages even if a later provider request fails.
    // Deterministic keys and a saved intent make timeouts safe to retry.
    try {
      let [customer]=await sql`SELECT square_id FROM square_customers WHERE user_id=${userId} AND environment=${cfg.environment}`;
      if(!customer){const response=await api('/v2/customers',{idempotency_key:hashValue([cfg.environment,userId]).slice(0,40),given_name:cfg.environment==='sandbox'?'CardShelf Sandbox':user.name,email_address:cfg.environment==='sandbox'?`cardshelf-test-${userId}@example.test`:user.email,reference_id:userId});
        squareId(response.customer?.id);[customer]=await sql`INSERT INTO square_customers(user_id,environment,square_id) VALUES(${userId},${cfg.environment},${response.customer.id}) RETURNING square_id`;}
      await sql`UPDATE square_subscriptions SET customer_id=${customer.square_id} WHERE id=${row.id}`;
      const response=await api('/v2/subscriptions',{idempotency_key:hashValue([cfg.environment,userId,requestId]).slice(0,40),customer_id:customer.square_id,location_id:cfg.location,
        plan_variation_id:snapshot.variation_id,start_date:row.start_date,timezone:cfg.timezone,
        price_override_money:{amount:snapshot.amount_minor,currency:'AUD'},tax_percentage:(snapshot.tax_bps/100).toFixed(2)});
      const s=response.subscription;ensure(s?.id&&s.customer_id===customer.square_id&&s.location_id===cfg.location&&s.plan_variation_id===snapshot.variation_id,502,'Square returned a subscription with unexpected identity.');
      await sql`UPDATE square_subscriptions SET square_id=${squareId(s.id)},status=${String(s.status)},last_error='',next_sync_at=now() WHERE id=${row.id}`;
      await audit(sql,userId,'billing.subscription_requested',{subscription_id:row.id,offer_id:offerId,terms_hash:snapshot.terms_hash});return {id:row.id,replayed:Boolean(existing)};
    }catch(error){await sql`UPDATE square_subscriptions SET last_error='Square has not confirmed all steps. Retry this same request or ask the administrator to reconcile it.' WHERE id=${row.id}`;return {id:row.id,pending:true};}
  });
  return {...result,message:cfg.environment==='sandbox'?'Sandbox subscription requested with synthetic customer details. Refresh to open its test invoice.':'Square will email the subscription invoice. Access follows verified payment, not this request.'};
}
export async function refreshInvoice(sql,row,invoiceId,subscription,api=squareRequest) {
  const cfg=await resolveSquareConfiguration(),{invoice}=await api(resourcePath('invoices',invoiceId));
  ensure(invoice?.id===invoiceId&&invoice.subscription_id===row.square_id&&invoice.location_id===cfg.location&&invoice.primary_recipient?.customer_id===row.customer_id,409,'Square invoice identity does not match this subscription.');
  const {order}=await api(resourcePath('orders',invoice.order_id));
  ensure(order?.id===invoice.order_id&&order.location_id===cfg.location,409,'Invoice order identity mismatch.');
  const paymentIds=[...new Set((order.tenders??[]).map(t=>t.payment_id).filter(Boolean))];
  ensure(paymentIds.length<=10,409,'This invoice needs manual payment review.');
  const payments=[];let refundPending=false;
  for(const id of paymentIds){const {payment}=await api(resourcePath('payments',id));ensure(payment?.id===id,409,'Payment identity mismatch.');
    ensure((payment.refund_ids??[]).length<=20,409,'This invoice needs manual refund review.');
    for(const rid of payment.refund_ids??[]){const {refund}=await api(resourcePath('refunds',rid));ensure(refund?.payment_id===id,409,'Refund identity mismatch.');if(refund.status==='PENDING')refundPending=true;}
    payments.push(payment);}
  const amounts=invoiceAmounts(invoice,order,payments),end=invoicePeriodEnd(subscription,invoice,row.offer_snapshot.cadence);
  // No paid period is inferred for unexpected prices, partial phases or externally changed schedules.
  const [disputeSignal]=paymentIds.length?await sql`SELECT event_id FROM square_webhook_events WHERE environment=${row.environment} AND event_type IN ('dispute.created','dispute.state.updated') AND payment_id IN ${sql(paymentIds)} LIMIT 1`:[];
  const settled=amounts.settled&&amounts.total_minor===row.offer_snapshot.total_minor&&amounts.tax_minor===row.offer_snapshot.total_minor-row.offer_snapshot.amount_minor&&Boolean(end);
  const [saved]=await sql`INSERT INTO square_invoices(environment,square_id,subscription_id,order_id,status,total_minor,tax_minor,paid_minor,refunded_minor,settled,disputed,refund_pending,period_end,cycle_number,public_url,first_paid_at)
    VALUES(${row.environment},${invoiceId},${row.id},${order.id},${String(invoice.status)},${amounts.total_minor},${amounts.tax_minor},${amounts.paid_minor},${amounts.refunded_minor},${settled},${Boolean(disputeSignal)},${refundPending},${end},${invoiceCycle(subscription,invoice,row.offer_snapshot.cadence)},${invoiceUrl(invoice.public_url,row.environment)},${settled?new Date():null})
    ON CONFLICT(environment,square_id) DO UPDATE SET status=excluded.status,total_minor=excluded.total_minor,tax_minor=excluded.tax_minor,
      paid_minor=excluded.paid_minor,refunded_minor=excluded.refunded_minor,settled=excluded.settled,disputed=square_invoices.disputed OR excluded.disputed,refund_pending=excluded.refund_pending,
      period_end=excluded.period_end,cycle_number=excluded.cycle_number,public_url=excluded.public_url,verified_at=now(),first_paid_at=coalesce(square_invoices.first_paid_at,excluded.first_paid_at)
    WHERE square_invoices.subscription_id=excluded.subscription_id RETURNING *`;
  ensure(saved,409,'Invoice was already linked to another subscription.');
  for(const id of paymentIds)await sql`INSERT INTO square_invoice_payments(environment,payment_id,invoice_id) VALUES(${row.environment},${id},${invoiceId}) ON CONFLICT DO NOTHING`;
  await reconcileCommission(sql,row,saved);
  return saved;
}
export async function syncSubscription(id,userId=null,api=squareRequest,extraInvoice=null) {
  v.uuid(id);const cfg=await resolveSquareConfiguration({refresh:true});
  if(api===squareRequest)api=(path,body,method)=>squareRequest(path,body,method,cfg);
  return db().begin(async sql=>{
    // Keep invoice reconciliation and referral bookkeeping in one consistent lock order.
    await sql`SELECT pg_advisory_xact_lock(72490703)`;
    const [row]=await sql`SELECT * FROM square_subscriptions WHERE id=${id} AND environment=${cfg.environment} ${userId?sql`AND user_id=${userId}`:sql``} FOR UPDATE`;
    ensure(row,404,'Subscription not found.');ensure(row.square_id,409,'A pending creation request must be retried with its original request ID.');
    const {subscription:s}=await api(resourcePath('subscriptions',row.square_id));
    ensure(s?.id===row.square_id&&s.customer_id===row.customer_id&&s.location_id===cfg.location&&s.plan_variation_id===row.offer_snapshot.variation_id&&s.start_date===row.start_date,409,'Square subscription identity changed. Administrator review is required.');
    let requests=0;const deadline=Date.now()+45000;
    const boundedApi=async (...args)=>{ensure(++requests<=100&&Date.now()<deadline,409,'Reconciliation limit reached. Review the invoice in Square.');return api(...args);};
    const ids=[...new Set([...(s.invoice_ids??[]).slice(0,12),...(extraInvoice?[extraInvoice]:[])])];
    let newest=null;
    for(const invoiceId of ids){const invoice=await refreshInvoice(sql,row,squareId(invoiceId),s,boundedApi);if(!newest)newest=invoice;}
    const [paid]=await sql`SELECT max(period_end) AS end_date FROM square_invoices WHERE subscription_id=${id} AND settled AND NOT disputed AND NOT refund_pending`;
    const [review]=await sql`SELECT square_id FROM square_invoices WHERE subscription_id=${id} AND paid_minor>0 AND (period_end IS NULL OR total_minor<>${row.offer_snapshot.total_minor} OR tax_minor<>${row.offer_snapshot.total_minor-row.offer_snapshot.amount_minor}) LIMIT 1`;
    const warning=review?'A paid invoice has unexpected pricing or dates and needs administrator review. Access is not extended for that invoice.':'';
    const current=!['CANCELED','DEACTIVATED'].includes(s.status);
    await sql`UPDATE square_subscriptions SET status=${String(s.status)},current=${current},canceled_date=${s.canceled_date??null},paid_through=${paid.end_date??null},invoice_url=${newest?.public_url??null},synced_at=now(),next_sync_at=now()+interval '1 hour',last_error=${warning} WHERE id=${id}`;
    return {id,status:s.status,paid_through:paid.end_date??null,invoice_url:newest?.public_url??null,current};
  });
}
export async function cancelSubscription(actorId,id,input,admin=false,api=squareRequest) {
  v.uuid(id);const o=strictObject(input,['confirm']);ensure(o.confirm===true,400,'Confirm cancellation of future subscription renewals.');
  const cfg=await resolveSquareConfiguration();
  const [row]=await db()`SELECT * FROM square_subscriptions WHERE id=${id} AND environment=${cfg.environment} ${admin?db()``:db()`AND user_id=${actorId}`}`;
  ensure(row?.square_id,404,'Confirmed Square subscription not found.');
  // Cancellation schedules the end of renewal; it is not a refund or a tier-grant removal.
  const {subscription:current}=await api(resourcePath('subscriptions',row.square_id));
  ensure(current?.id===row.square_id&&current.customer_id===row.customer_id,409,'Square subscription identity mismatch.');
  if(!current.canceled_date&&!['CANCELED','DEACTIVATED'].includes(current.status))await api(resourcePath('subscriptions',row.square_id)+'/cancel',{});
  await audit(db(),actorId,'billing.cancellation_requested',{subscription_id:id});
  return syncSubscription(id,admin?null:actorId,api);
}
