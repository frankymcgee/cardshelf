import { db,audit } from './db.mjs';
import { ensure } from './errors.mjs';
import * as v from './validate.mjs';
import { strictObject,today } from './subscription-logic.mjs';
import { stripeConfig } from './stripe-connection.mjs';
import { stripeRequest } from './stripe-client.mjs';
import { stripeId,stripeOrigin,stripeUrl,stripePrice,stripeInvoiceFacts,verifyStripePortal,objectId } from './stripe-logic.mjs';
import { reconcileCommission } from './subscription-referrals.mjs';
const billingLock=(sql,id)=>sql`SELECT pg_advisory_xact_lock(hashtextextended(${'billing:'+id},0))`;
export async function stripeAccount(userId) {
  const cfg=await stripeConfig(),sql=db();
  const offers=cfg.enabled&&cfg.configured&&cfg.accepting?await sql`SELECT id,plan_code,cadence,total_minor,tax_minor,terms,terms_hash,revision FROM stripe_offers WHERE environment=${cfg.environment} AND published ORDER BY plan_code,cadence`:[];
  const subscriptions=await sql`SELECT id,status,current,cancel_at_period_end,paid_through,checkout_url,checkout_expires_at,request_id,offer_snapshot,last_error,synced_at,(stripe_id IS NOT NULL) AS confirmed FROM stripe_subscriptions WHERE user_id=${userId} AND environment=${cfg.environment} ORDER BY created_at DESC LIMIT 20`;
  return {environment:cfg.environment,enabled:cfg.enabled&&cfg.configured&&cfg.accepting,configured:cfg.configured,offers,subscriptions};
}
export async function startStripeCheckout(userId,input,api=stripeRequest) {
  const cfg=await stripeConfig();ensure(cfg.enabled&&cfg.configured&&cfg.accepting&&cfg.portalId,409,'Stripe subscription checkout is not enabled.');
  const o=strictObject(input,['offer_id','revision','terms_hash','request_id','consent']);const offerId=v.uuid(o.offer_id),requestId=v.uuid(o.request_id);v.integer(o.revision,'Revision',1);ensure(o.consent===true,400,'Accept the recurring subscription terms first.');
  const origin=stripeOrigin(cfg.environment);
  const reserved=await db().begin(async sql=>{
    await billingLock(sql,userId);
    const [old]=await sql`SELECT * FROM stripe_subscriptions WHERE user_id=${userId} AND environment=${cfg.environment} AND request_id=${requestId}`;
    if(old){ensure(old.offer_id===offerId&&old.offer_snapshot.terms_hash===o.terms_hash&&old.offer_snapshot.revision===o.revision,409,'This request ID was used for different terms.');return old;}
    const [user]=await sql`SELECT role FROM app_users WHERE id=${userId}`;ensure(user,404,'Account not found.');
    ensure(user.role!=='admin'&&!(await sql`SELECT user_id FROM account_access_grants WHERE user_id=${userId}`).length&&!(await sql`SELECT user_id FROM account_tier_overrides WHERE user_id=${userId} AND tier='complimentary'`).length,409,'This account has protected free access. No subscription is needed.');
    ensure(!(await sql`SELECT id FROM stripe_subscriptions WHERE user_id=${userId} AND environment=${cfg.environment} AND (current OR paid_through>now())`).length,409,'A Stripe subscription or unresolved checkout already exists. Refresh it instead.');
    ensure(!(await sql`SELECT id FROM square_subscriptions WHERE user_id=${userId} AND environment=${cfg.environment} AND (current OR paid_through>${today()})`).length,409,'A Square subscription or pending request already exists. Do not subscribe with both providers.');
    const [offer]=await sql`SELECT * FROM stripe_offers WHERE id=${offerId} AND environment=${cfg.environment} AND published`;
    ensure(offer&&offer.revision===o.revision&&offer.terms_hash===o.terms_hash,409,'Offer changed. Review the current terms.');
    const [r]=await sql`INSERT INTO stripe_subscriptions(user_id,environment,request_id,offer_id,offer_snapshot,checkout_expires_at) VALUES(${userId},${cfg.environment},${requestId},${offerId},${sql.json(offer)},${new Date(Date.now()+3600000)}) RETURNING *`;return r;
  });
  // Reservation survived even if the process dies between the provider call and DB commit.
  return db().begin(async sql=>{
    await billingLock(sql,userId);const [row]=await sql`SELECT * FROM stripe_subscriptions WHERE id=${reserved.id} FOR UPDATE`;
    if(row.session_id)return {id:row.id,url:stripeUrl(row.checkout_url),replayed:true};
    ensure(row.current&&Date.now()-Date.parse(row.created_at)<23*3600000,409,'This unresolved checkout is too old to retry safely. Administrator reconciliation is required.');
    try{
      const price=stripePrice(await api(cfg,'/v1/prices/'+row.offer_snapshot.price_id),cfg.environment,row.offer_snapshot.tax_rate_id?await api(cfg,'/v1/tax_rates/'+row.offer_snapshot.tax_rate_id):null);
      ensure(price.total_minor===row.offer_snapshot.total_minor&&price.tax_minor===row.offer_snapshot.tax_minor&&price.cadence===row.offer_snapshot.cadence,409,'Stripe price or tax changed. Review the offer.');
      let [customer]=await sql`SELECT stripe_id FROM stripe_customers WHERE user_id=${userId} AND environment=${cfg.environment}`;
      if(!customer){const [u]=await sql`SELECT name,email FROM app_users WHERE id=${userId}`;
        const c=await api(cfg,'/v1/customers',{name:cfg.environment==='sandbox'?'CardShelf test collector':u.name,email:cfg.environment==='sandbox'?`cardshelf-${userId}@example.test`:u.email,metadata:{cardshelf_user:userId}},'POST','cardshelf-customer-'+row.id);
        stripeId(c.id,'cus');ensure(c.livemode===(cfg.environment==='production'),409,'Stripe customer mode mismatch.');
        [customer]=await sql`INSERT INTO stripe_customers(user_id,environment,stripe_id) VALUES(${userId},${cfg.environment},${c.id}) RETURNING stripe_id`;
      }
      await sql`UPDATE stripe_subscriptions SET customer_id=${customer.stripe_id} WHERE id=${row.id}`;
      const data={mode:'subscription',customer:customer.stripe_id,client_reference_id:row.id,payment_method_types:['card'],line_items:[{price:price.price_id,quantity:1,...(price.tax_rate_id?{tax_rates:[price.tax_rate_id]}:{})}],allow_promotion_codes:false,automatic_tax:{enabled:false},
        success_url:origin+'/membership?stripe=returned',cancel_url:origin+'/membership?stripe=cancelled',expires_at:Math.floor(Date.parse(row.checkout_expires_at)/1000),
        metadata:{cardshelf_request:row.id},subscription_data:{metadata:{cardshelf_request:row.id}},custom_text:{submit:{message:'Recurring CardShelf membership. Review the terms accepted in CardShelf; manage renewals through Membership.'}}};
      const s=await api(cfg,'/v1/checkout/sessions',data,'POST','cardshelf-checkout-'+row.id);
      stripeId(s.id,'cs');ensure(s.mode==='subscription'&&s.client_reference_id===row.id&&objectId(s.customer)===customer.stripe_id&&s.livemode===(cfg.environment==='production')&&stripeUrl(s.url),502,'Stripe checkout identity or URL mismatch.');
      await sql`UPDATE stripe_subscriptions SET session_id=${s.id},checkout_url=${s.url},status='checkout_open',last_error='' WHERE id=${row.id}`;
      await audit(sql,userId,'stripe.checkout_requested',{subscription_id:row.id,offer_id:offerId,terms_hash:row.offer_snapshot.terms_hash});return {id:row.id,url:s.url};
    }catch{await sql`UPDATE stripe_subscriptions SET last_error='Stripe has not confirmed checkout. Retry the original request or ask the administrator to reconcile it; do not start another subscription.' WHERE id=${row.id}`;return {id:row.id,pending:true};}
  });
}
async function invoiceSnapshot(sql,row,sub,id,cfg,api) {
  // Invoice payments are expandable in the pinned Stripe API version.
  const invoice=await api(cfg,'/v1/invoices/'+stripeId(id,'in')+'?expand%5B%5D=payments');
  ensure(invoice?.id===id,409,'Stripe returned a different invoice.');
  const payments=invoice.payments?.data?.filter(p=>p.status==='paid')??[];
  let intent=null,charge=null,refunds={data:[],has_more:false};
  if(payments.length===1&&payments[0].payment?.type==='payment_intent'){
    intent=await api(cfg,'/v1/payment_intents/'+stripeId(objectId(payments[0].payment.payment_intent),'pi'));
    if(intent.latest_charge){charge=await api(cfg,'/v1/charges/'+stripeId(objectId(intent.latest_charge),'ch'));refunds=await api(cfg,'/v1/refunds?charge='+stripeId(charge.id,'ch')+'&limit=100');}
  }
  const facts=stripeInvoiceFacts(invoice,sub,row.offer_snapshot,intent,charge,refunds),values={...facts};delete values.supported;
  const [old]=await sql`SELECT first_paid_at FROM stripe_invoices WHERE environment=${row.environment} AND stripe_id=${id}`;
  const data={environment:row.environment,stripe_id:id,subscription_id:row.id,status:String(invoice.status),...values,verified_at:new Date(),first_paid_at:old?.first_paid_at??(facts.settled?new Date():null)};
  await sql`INSERT INTO stripe_invoices ${sql(data)} ON CONFLICT(environment,stripe_id) DO UPDATE SET ${sql(data)}`;
  await reconcileCommission(sql,{...row,provider:'stripe'},data);
  return facts;
}
export async function syncStripeSubscription(id,userId=null,api=stripeRequest,extraInvoice=null,sessionHint=null) {
  v.uuid(id);const sql=db(),[initial]=await sql`SELECT environment FROM stripe_subscriptions WHERE id=${id} ${userId?sql`AND user_id=${userId}`:sql``}`;ensure(initial,404,'Stripe subscription not found.');
  const cfg=await stripeConfig(initial.environment);ensure(cfg.configured,409,'Stripe credentials are not available for reconciliation.');
  let calls=0;const deadline=Date.now()+45000,bounded=async(...args)=>{ensure(++calls<=65&&Date.now()<deadline,409,'Stripe reconciliation limit reached. Try again or review the dashboard.');return api(...args);};
  return sql.begin(async tx=>{
    await tx`SELECT pg_advisory_xact_lock(72490703)`;
    const [row]=await tx`SELECT * FROM stripe_subscriptions WHERE id=${id} FOR UPDATE`;
    let sessionId=row.session_id||sessionHint;
    if(!sessionId&&row.customer_id){const list=await bounded(cfg,'/v1/checkout/sessions?customer='+stripeId(row.customer_id,'cus')+'&limit=100');const found=list.data.filter(s=>s.client_reference_id===id);ensure(found.length===1,409,'Unconfirmed checkout requires Stripe dashboard review; no new charge has been requested.');sessionId=found[0].id;}
    ensure(sessionId,409,'Checkout was not confirmed. Retry its original request before 23 hours; older unknown requests require administrator review.');
    const s=await bounded(cfg,'/v1/checkout/sessions/'+stripeId(sessionId,'cs'));
    ensure(s.client_reference_id===id&&objectId(s.customer)===row.customer_id&&s.livemode===(row.environment==='production')&&s.mode==='subscription',409,'Stripe checkout does not belong to this account.');
    if(!s.subscription){ensure(['open','expired'].includes(s.status),409,'Stripe has not confirmed the subscription yet.');await tx`UPDATE stripe_subscriptions SET session_id=${s.id},status=${s.status==='open'?'checkout_open':'expired'},current=${s.status==='open'},checkout_url=${s.status==='open'?stripeUrl(s.url):null},synced_at=now(),next_sync_at=now()+interval '5 minutes',last_error='' WHERE id=${id}`;return {status:s.status};}
    const sub=await bounded(cfg,'/v1/subscriptions/'+stripeId(objectId(s.subscription),'sub'));
    ensure(sub.metadata?.cardshelf_request===id&&objectId(sub.customer)===row.customer_id&&sub.livemode===(row.environment==='production')&&(!row.stripe_id||row.stripe_id===sub.id),409,'Stripe subscription identity mismatch.');
    ensure(sub.items?.data?.length===1&&objectId(sub.items.data[0].price)===row.offer_snapshot.price_id&&sub.items.data[0].quantity===1&&!sub.trial_end,409,'This Stripe subscription was changed outside the supported plan. Administrator review is required.');
    const page=await bounded(cfg,'/v1/invoices?subscription='+sub.id+'&limit=5');
    const invoiceIds=[...new Set([...page.data.map(i=>i.id),...(extraInvoice?[extraInvoice]:[])])];
    let needsReview=false;
    for(const invoiceId of invoiceIds){const facts=await invoiceSnapshot(tx,row,sub,invoiceId,cfg,bounded);if(!facts.supported)needsReview=true;}
    const [paid]=await tx`SELECT max(period_end) AS end_date FROM stripe_invoices WHERE subscription_id=${id} AND settled AND NOT disputed AND NOT refund_pending`;
    const current=!['canceled','incomplete_expired'].includes(sub.status);
    await tx`UPDATE stripe_subscriptions SET session_id=${s.id},stripe_id=${sub.id},checkout_url=NULL,status=${sub.status},current=${current},cancel_at_period_end=${sub.cancel_at_period_end===true},paid_through=${paid.end_date??null},synced_at=now(),next_sync_at=now()+interval '1 hour',last_error=${needsReview?'An invoice has unsupported prices, adjustments or dates. Its payment does not extend access; review it in Stripe.':''} WHERE id=${id}`;
    return {status:sub.status,paid_through:paid.end_date??null,current};
  });
}
export async function stripePortal(userId,api=stripeRequest) {
  const cfg=await stripeConfig();ensure(cfg.configured&&cfg.portalId,409,'Stripe customer portal is not configured.');
  const [c]=await db()`SELECT stripe_id FROM stripe_customers WHERE user_id=${userId} AND environment=${cfg.environment}`;ensure(c,404,'No Stripe billing account exists for this user.');
  verifyStripePortal(await api(cfg,'/v1/billing_portal/configurations/'+cfg.portalId));
  const s=await api(cfg,'/v1/billing_portal/sessions',{customer:c.stripe_id,configuration:cfg.portalId,return_url:stripeOrigin(cfg.environment)+'/membership'},'POST');
  ensure(stripeUrl(s.url,'portal'),502,'Stripe returned an unexpected portal URL.');return {url:s.url};
}
export async function cancelStripeSubscription(userId,id,input,admin=false,api=stripeRequest) {
  ensure(strictObject(input,['confirm']).confirm===true,400,'Confirm cancellation of future Stripe renewals.');v.uuid(id);
  const sql=db(),[r]=await sql`SELECT * FROM stripe_subscriptions WHERE id=${id} ${admin?sql``:sql`AND user_id=${userId}`}`;ensure(r,404,'Stripe subscription not found.');const cfg=await stripeConfig(r.environment);
  if(r.stripe_id){const sub=await api(cfg,'/v1/subscriptions/'+r.stripe_id);ensure(objectId(sub.customer)===r.customer_id,409,'Stripe account mismatch.');
    if(!sub.cancel_at_period_end&&!['canceled','incomplete_expired'].includes(sub.status))await api(cfg,'/v1/subscriptions/'+r.stripe_id,{cancel_at_period_end:true},'POST','cardshelf-cancel-'+r.id);
  }else{ensure(r.session_id,409,'Reconcile the unknown checkout before cancelling.');const s=await api(cfg,'/v1/checkout/sessions/'+r.session_id);ensure(s.client_reference_id===id,409,'Checkout identity mismatch.');if(s.status==='open')await api(cfg,'/v1/checkout/sessions/'+r.session_id+'/expire',{},'POST','cardshelf-expire-'+r.id);}
  await audit(sql,userId,'stripe.cancellation_requested',{subscription_id:id});return syncStripeSubscription(id,admin?null:userId,api);
}
