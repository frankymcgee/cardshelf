// Bounded, dependency-free Stripe contracts. Payment state must come from authenticated API reads.
import { createHmac, timingSafeEqual, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { ensure, AppError } from './errors.mjs';
export const STRIPE_VERSION='2025-06-30.basil';
export function stripeEnvironment(value) {ensure(['sandbox','production'].includes(value),400,'Choose Stripe Test or Live.');return value;}
export function stripePolicy(env=process.env) {
  const environment=stripeEnvironment(env.STRIPE_ENVIRONMENT||'sandbox');
  return {environment,enabled:env.STRIPE_BILLING_ENABLED==='true',enforce:env.MEMBERSHIP_ENFORCEMENT_ENABLED==='true'};
}
export function stripeId(value,prefix) {
  ensure(typeof value==='string'&&new RegExp('^'+prefix+'_[A-Za-z0-9_]{1,240}$').test(value),400,'Invalid Stripe '+prefix+' identifier.');return value;
}
export const objectId=value=>typeof value==='string'?value:value?.id;
export function stripeKey(value,environment) {
  stripeEnvironment(environment);
  ensure(typeof value==='string'&&new RegExp('^(sk|rk)_'+(environment==='production'?'live':'test')+'_[A-Za-z0-9]{16,250}$').test(value),400,'Use a secret/restricted key for the selected Stripe mode, not a publishable key.');return value;
}
function vaultKey() {ensure(/^[a-f0-9]{64}$/i.test(process.env.CARDSHELF_INTEGRATION_KEY||''),503,'Run scripts/configure-integrations.sh to prepare the server encryption key.');return Buffer.from(process.env.CARDSHELF_INTEGRATION_KEY,'hex');}
export function stripeEncrypt(value,environment,field) {
  const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',vaultKey(),iv);
  c.setAAD(Buffer.from(`cardshelf:stripe:v1:${stripeEnvironment(environment)}:${field}`));
  const out=Buffer.concat([c.update(value,'utf8'),c.final()]);
  return ['v1',iv.toString('base64'),c.getAuthTag().toString('base64'),out.toString('base64')].join('.');
}
export function stripeDecrypt(value,environment,field) {
  try {const [version,iv,tag,data,extra]=String(value).split('.');if(version!=='v1'||extra)throw new Error();
    const c=createDecipheriv('aes-256-gcm',vaultKey(),Buffer.from(iv,'base64'));c.setAAD(Buffer.from(`cardshelf:stripe:v1:${stripeEnvironment(environment)}:${field}`));c.setAuthTag(Buffer.from(tag,'base64'));
    return Buffer.concat([c.update(Buffer.from(data,'base64')),c.final()]).toString('utf8');
  }catch{throw new AppError(503,'Stripe credentials cannot be unlocked. Check the integration encryption key.');}
}
export function stripeSignature(raw,header,secret,now=Date.now()) {
  if(!Buffer.isBuffer(raw)||raw.length>262144||typeof header!=='string'||header.length>4096||!secret)return false;
  const fields=header.split(',').map(s=>s.trim().split('=')),times=fields.filter(([k])=>k==='t');
  if(times.length!==1||!/^\d+$/.test(times[0][1]??''))return false;
  const timestamp=Number(times[0][1]);if(!Number.isSafeInteger(timestamp)||Math.abs(now/1000-timestamp)>300)return false;
  const mac=createHmac('sha256',secret).update(times[0][1]+'.').update(raw).digest();
  return fields.some(([k,s])=>k==='v1'&&/^[a-f0-9]{64}$/i.test(s||'')&&timingSafeEqual(mac,Buffer.from(s,'hex')));
}
export function stripeOrigin(environment) {
  const u=new URL(process.env.APP_ORIGIN||'http://localhost:3000');
  ensure(!u.username&&!u.password&&!u.search&&!u.hash&&u.pathname==='/'&&(u.protocol==='https:'||(environment==='sandbox'&&u.protocol==='http:'&&['localhost','127.0.0.1'].includes(u.hostname))),503,'Configure the public HTTPS application origin.');return u.origin;
}
export function stripeUrl(value,kind='checkout') {
  try{const u=new URL(value),hosts={checkout:'checkout.stripe.com',portal:'billing.stripe.com',invoice:'invoice.stripe.com'};
    return u.protocol==='https:'&&u.hostname===hosts[kind]&&!u.port&&!u.username&&!u.password?u.href:null;
  }catch{return null;}
}
export function stripePrice(price,environment,tax=null) {
  ensure(price?.object==='price'&&price.active===true&&price.livemode===(environment==='production')&&price.currency==='aud'&&price.type==='recurring'&&price.billing_scheme==='per_unit'&&!price.transform_quantity&&
    price.recurring?.usage_type==='licensed'&&price.recurring.interval_count===1&&['month','year'].includes(price.recurring.interval)&&!price.recurring.trial_period_days&&Number.isSafeInteger(price.unit_amount)&&price.unit_amount>=100&&price.unit_amount<=10000000,409,'Choose an active fixed-price AUD monthly or annual price without usage tiers or trials.');
  let bps=0,inclusive=false,taxId=null;
  if(tax){ensure(tax.active===true&&tax.livemode===(environment==='production')&&typeof tax.percentage==='number'&&Number.isInteger(tax.percentage*100)&&tax.percentage>=0&&tax.percentage<=100&&typeof tax.inclusive==='boolean'&&!tax.flat_amount,409,'Use an active fixed percentage Stripe tax rate.');bps=Math.round(tax.percentage*100);inclusive=tax.inclusive;taxId=stripeId(tax.id,'txr');}
  const amount=price.unit_amount,total=inclusive?amount:amount+Math.round(amount*bps/10000),taxMinor=inclusive?amount-Math.round(amount*10000/(10000+bps)):total-amount;
  return {price_id:stripeId(price.id,'price'),cadence:price.recurring.interval==='month'?'MONTHLY':'ANNUAL',amount_minor:amount,total_minor:total,tax_minor:taxMinor,tax_rate_id:taxId,tax_bps:bps,tax_inclusive:inclusive};
}
export function verifyStripePortal(c) {
  ensure(c?.active===true&&c.features?.payment_method_update?.enabled===true&&c.features?.invoice_history?.enabled===true&&c.features?.subscription_cancel?.enabled===true&&c.features.subscription_cancel.mode==='at_period_end'&&c.features?.subscription_update?.enabled===false,409,'Portal must allow payment-method updates, invoice history and end-of-period cancellation, with plan changes disabled.');return stripeId(c.id,'bpc');
}
function monthAt(anchor,months){const d=new Date(anchor*1000),day=d.getUTCDate();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+months);d.setUTCDate(Math.min(day,new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate()));return d.getTime()/1000;}
export function stripePeriod(sub,line,cadence) {
  const anchor=sub.billing_cycle_anchor,start=line?.period?.start,end=line?.period?.end;
  if(![anchor,start,end].every(n=>Number.isSafeInteger(n)&&n>0)||!['MONTHLY','ANNUAL'].includes(cadence)||start<anchor||line.parent?.subscription_item_details?.proration!==false)return null;
  const a=new Date(anchor*1000),s=new Date(start*1000),months=(s.getUTCFullYear()-a.getUTCFullYear())*12+s.getUTCMonth()-a.getUTCMonth(),step=cadence==='ANNUAL'?12:1;
  if(months%step||monthAt(anchor,months)!==start||monthAt(anchor,months+step)!==end)return null;
  return {start:new Date(start*1000),end:new Date(end*1000),cycle:months/step+1};
}
export function stripeInvoiceFacts(invoice,sub,offer,intent,charge,refunds={data:[],has_more:false}) {
  ensure(invoice?.livemode===sub.livemode&&objectId(invoice.customer)===objectId(sub.customer)&&objectId(invoice.parent?.subscription_details?.subscription)===sub.id,409,'Stripe invoice identity mismatch.');
  const cash=n=>Number.isSafeInteger(n)&&n>=0&&n<=20000000;
  ensure(cash(invoice.total)&&cash(invoice.total_excluding_tax)&&invoice.total_excluding_tax<=invoice.total,409,'Invalid Stripe invoice totals.');
  const line=invoice.lines?.data?.[0],period=stripePeriod(sub,line,offer.cadence);
  const supported=Boolean(period)&&invoice.lines?.has_more===false&&invoice.lines.data.length===1&&line.quantity===1&&objectId(line.pricing?.price_details?.price)===offer.price_id&&
    invoice.currency==='aud'&&['subscription_create','subscription_cycle'].includes(invoice.billing_reason)&&invoice.total===offer.total_minor&&Math.abs(invoice.total-invoice.total_excluding_tax-offer.tax_minor)<=1&&
    invoice.amount_due===invoice.total&&!invoice.starting_balance&&!invoice.ending_balance&&!(invoice.total_discount_amounts||[]).some(d=>d.amount)&&!invoice.pre_payment_credit_notes_amount&&!invoice.post_payment_credit_notes_amount;
  const payments=invoice.payments?.data?.filter(p=>p.status==='paid')??[];
  const verified=Boolean(intent&&charge&&invoice.payments?.has_more===false&&payments.length===1&&objectId(payments[0].invoice)===invoice.id&&payments[0].payment?.type==='payment_intent'&&objectId(payments[0].payment.payment_intent)===intent.id&&payments[0].amount_paid===invoice.total&&
    intent.livemode===sub.livemode&&charge.livemode===sub.livemode&&intent.status==='succeeded'&&intent.currency==='aud'&&objectId(intent.customer)===objectId(sub.customer)&&objectId(intent.latest_charge)===charge.id&&objectId(charge.payment_intent)===intent.id&&objectId(charge.customer)===objectId(sub.customer)&&
    charge.paid===true&&charge.captured===true&&charge.status==='succeeded'&&charge.payment_method_details?.type==='card'&&charge.currency==='aud'&&charge.amount===invoice.total&&intent.amount_received===invoice.total);
  const refundValid=!charge||(cash(charge.amount_refunded)&&charge.amount_refunded<=invoice.total);
  const paid=verified?invoice.total:0,refunded=verified&&refundValid?charge.amount_refunded:0;
  const pending=!refundValid||refunds.has_more!==false||!Array.isArray(refunds.data)||refunds.data.some(r=>!['succeeded','failed','canceled'].includes(r.status)||objectId(r.charge)!==charge?.id||r.currency!=='aud')||(verified&&refunds.data.filter(r=>r.status==='succeeded').reduce((n,r)=>n+(cash(r.amount)?r.amount:Infinity),0)!==refunded);
  return {total_minor:invoice.total,tax_minor:invoice.total-invoice.total_excluding_tax,paid_minor:paid,refunded_minor:refunded,
    settled:supported&&verified&&invoice.status==='paid'&&invoice.amount_paid===invoice.total&&invoice.amount_remaining===0&&refunded<paid,
    disputed:Boolean(charge?.disputed),refund_pending:pending,period_start:period?.start??null,period_end:period?.end??null,cycle_number:period?.cycle??null,
    payment_intent_id:verified?intent.id:null,charge_id:verified?charge.id:null,supported};
}
export function stripeEntitlement(square,rows,now=Date.now()) {
  const active=rows.filter(s=>s.paid_through&&Date.parse(s.paid_through)>now&&['collector','plus'].includes(s.offer_snapshot?.plan_code));
  if(!active.length)return square;
  const best=active.find(s=>s.offer_snapshot.plan_code==='plus')||active[0];
  // Grant choice only; the shared access policy still applies tester/admin/manual precedence.
  if(square?.offer_snapshot?.plan_code==='plus')return square;
  return {...best,provider:'stripe'};
}
