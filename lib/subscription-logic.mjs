import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { ensure } from './errors.mjs';
import * as v from './validate.mjs';
export const SQUARE_VERSION = '2026-09-16';
export const hashValue = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function strictObject(input, keys) {
  const o=v.object(input); ensure(Object.keys(o).every(k=>keys.includes(k)),400,'Unsupported request field.'); return o;
}
export function squareId(value) {
  const s=v.text(value,'Square identifier',1,255);
  ensure(/^[A-Za-z0-9_:.-]+$/.test(s),400,'Invalid Square identifier.'); return s;
}
export function squareConfiguration(env=process.env) {
  const environment=env.SQUARE_ENVIRONMENT||'sandbox';
  ensure(['sandbox','production'].includes(environment),503,'SQUARE_ENVIRONMENT must be sandbox or production.');
  const enabled=env.SQUARE_BILLING_ENABLED==='true';
  const cfg={environment,enabled,enforce:env.MEMBERSHIP_ENFORCEMENT_ENABLED==='true',
    token:env.SQUARE_ACCESS_TOKEN||'',location:env.SQUARE_LOCATION_ID||'',merchant:env.SQUARE_MERCHANT_ID||'',
    signatureKey:env.SQUARE_WEBHOOK_SIGNATURE_KEY||'',
    webhookUrl:env.SQUARE_WEBHOOK_URL||`${env.APP_ORIGIN||'http://localhost:3000'}/api/billing/square/webhook`,
    timezone:env.SQUARE_TIMEZONE||'Australia/Perth'};
  try { new Intl.DateTimeFormat('en',{timeZone:cfg.timezone}); } catch { ensure(false,503,'Invalid Square timezone.'); }
  if(enabled || cfg.enforce) {
    let u; try { u=new URL(cfg.webhookUrl); } catch { ensure(false,503,'Invalid Square webhook URL.'); }
    ensure(u.protocol==='https:'&&!u.username&&!u.password&&!u.search&&!u.hash&&u.pathname==='/api/billing/square/webhook',503,'Use the exact public HTTPS Square webhook URL.');
  }
  cfg.configured=Boolean(cfg.token&&cfg.location&&cfg.merchant&&cfg.signatureKey);
  // Deliberately separate billing from access enforcement; neither is enabled on upgrade.
  ensure(!cfg.enforce||(enabled&&environment==='production'&&cfg.configured),503,'Enforcement requires configured production billing.');
  return cfg;
}
export function publicConfiguration(cfg=squareConfiguration()) {
  return {environment:cfg.environment,enabled:cfg.enabled&&cfg.configured,enforcement_enabled:cfg.enforce,configured:cfg.configured,
    payment_flow:'square_hosted_invoice'};
}
export function signatureValid(raw, signature, key, notificationUrl) {
  if(!Buffer.isBuffer(raw)||raw.length>262144||typeof signature!=='string'||!key||!notificationUrl) return false;
  const expected=createHmac('sha256',key).update(notificationUrl).update(raw).digest('base64');
  const actual=Buffer.from(signature);const wanted=Buffer.from(expected);
  return actual.length===wanted.length&&timingSafeEqual(actual,wanted);
}
export function isoDate(value) {
  return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
}
export function today(timezone='Australia/Perth',now=new Date()) {
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
  return ['year','month','day'].map(k=>parts.find(p=>p.type===k).value).join('-');
}
function anchoredMonth(start,offset) {
  const [y,m,d]=start.split('-').map(Number),first=new Date(Date.UTC(y,m-1+offset,1));
  const days=new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+1,0)).getUTCDate();
  first.setUTCDate(Math.min(d,days));return first.toISOString().slice(0,10);
}
// Only single-phase, unprorated subscriptions on their original monthly anchor are supported.
// Never grant access merely from ACTIVE or charged_through_date (which mean invoiced, not paid).
export function invoicePeriodEnd(subscription,invoice,cadence) {
  const start=subscription.start_date,req=invoice.payment_requests;
  if(!isoDate(start)||!Array.isArray(req)||req.length!==1||req[0].request_type!=='BALANCE'||!isoDate(req[0].due_date)) return null;
  if(!['MONTHLY','ANNUAL'].includes(cadence)) return null;
  const due=req[0].due_date,[sy,sm,sd]=start.split('-').map(Number),[dy,dm]=due.split('-').map(Number);
  if(subscription.monthly_billing_anchor_date&&subscription.monthly_billing_anchor_date!==sd) return null;
  const months=(dy-sy)*12+dm-sm,step=cadence==='ANNUAL'?12:1;
  if(months<0||months%step!==0||anchoredMonth(start,months)!==due) return null;
  return anchoredMonth(start,months+step); // exclusive local-calendar boundary
}
export function offerInput(input) {
  const o=strictObject(input,['plan_code','cadence','variation_id','amount_minor','tax_bps','terms']);
  return {plan_code:v.oneOf(o.plan_code,'Plan',['collector','plus']),cadence:v.oneOf(o.cadence,'Cadence',['MONTHLY','ANNUAL']),
    variation_id:squareId(o.variation_id),amount_minor:v.integer(o.amount_minor,'Amount in AUD cents',100,10000000),
    tax_bps:v.integer(o.tax_bps??0,'Tax basis points',0,10000),terms:v.text(o.terms,'Subscription terms',60,6000)};
}
export function offerTotal(offer) {return offer.amount_minor+Math.round(offer.amount_minor*offer.tax_bps/10000);}
export function verifyVariation(object,offer,location) {
  const data=object?.subscription_plan_variation_data,p=data?.phases?.[0];
  ensure(object?.id===offer.variation_id&&object.type==='SUBSCRIPTION_PLAN_VARIATION'&&!object.is_deleted,409,'Square plan variation was not found.');
  ensure(Array.isArray(data?.phases)&&data.phases.length===1&&p.cadence===offer.cadence&&p.pricing?.type==='STATIC'&&p.pricing.price_money?.currency==='AUD'&&p.pricing.price_money.amount===offer.amount_minor,
    409,'Use a single-phase STATIC AUD variation with exactly the configured price and cadence.');
  ensure(!p.periods&&!p.pricing.discount_ids?.length&&!data.monthly_billing_anchor_date&&!data.can_prorate,409,'Trials, finite phases, discounts, proration and custom anchors are not supported.');
  ensure(!object.absent_at_location_ids?.includes(location)&&(object.present_at_all_locations===true||object.present_at_location_ids?.includes(location)),409,'Square variation is not available at this location.');
  return true;
}
export function invoiceUrl(value,environment) {
  if(typeof value!=='string')return null;
  try {const u=new URL(value),hosts=environment==='sandbox'?['squareupsandbox.com','connect.squareupsandbox.com']:['squareup.com','square.link'];
    return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&hosts.some(h=>u.hostname===h||u.hostname.endsWith('.'+h))?u.href:null;
  }catch{return null;}
}
export function audMoney(value,allowMissing=false) {
  if(value==null&&allowMissing)return 0;
  ensure(value?.currency==='AUD'&&Number.isSafeInteger(value.amount)&&value.amount>=0&&value.amount<=20000000,409,'Unsupported or invalid Square money value.');
  return value.amount;
}
export function invoiceAmounts(invoice,order,payments) {
  const total=audMoney(order.total_money),tax=audMoney(order.total_tax_money,true);
  ensure(tax<=total,409,'Invalid invoice tax.');
  const ids=new Set();let paid=0,refunded=0;
  for(const p of payments) {
    ensure(p?.order_id===order.id&&p.location_id===order.location_id&&!ids.has(p.id),409,'Square payment does not match its invoice order.');ids.add(p.id);
    if(p.status!=='COMPLETED'||!['CARD','BANK_ACCOUNT'].includes(p.source_type))continue;
    paid+=audMoney(p.amount_money);refunded+=audMoney(p.refunded_money,true);
  }
  ensure(paid<=total&&refunded<=paid,409,'Invoice amounts require manual review.');
  return {total_minor:total,tax_minor:tax,paid_minor:paid,refunded_minor:refunded,
    settled:['PAID','PARTIALLY_REFUNDED'].includes(invoice.status)&&paid===total&&paid>0&&refunded<paid};
}
export function referralInput(input) {
  const o=strictObject(input,['status','reward_type','reward_value','max_payments','hold_days','terms','revision']);
  const type=v.oneOf(o.reward_type,'Reward type',['percentage','fixed']);
  return {status:v.oneOf(o.status,'Status',['approved','suspended']),reward_type:type,
    reward_value:v.integer(o.reward_value,'Reward value',0,type==='percentage'?10000:1000000),
    max_payments:v.integer(o.max_payments??1,'Rewarded payments',1,120),hold_days:v.integer(o.hold_days??30,'Hold days',0,180),
    terms:v.text(o.terms,'Referral terms',30,6000),revision:v.integer(o.revision,'Revision',0,Number.MAX_SAFE_INTEGER)};
}
export function referralReady(partner) {return partner?.status==='approved'&&Boolean(partner.opted_in_at)&&partner.opted_in_revision===partner.revision;}
export function commissionAmount(invoice,terms,environment='production') {
  if(environment!=='production'||!invoice.settled||invoice.disputed||invoice.refund_pending)return 0;
  const {paid_minor:paid,refunded_minor:refund,total_minor:total,tax_minor:tax}=invoice;
  if(![paid,refund,total,tax].every(n=>Number.isSafeInteger(n)&&n>=0)||!total||tax>total||refund>paid||paid>total)return 0;
  const base=BigInt(total-tax)*BigInt(paid-refund)/BigInt(total);
  if(!Number.isSafeInteger(terms.reward_value)||terms.reward_value<0)return 0;
  const value=BigInt(terms.reward_value);
  if(terms.reward_type==='percentage'&&value<=10000n)return Number(base*value/10000n);
  if(terms.reward_type==='fixed'){const full=BigInt(total-tax),cap=full<value?full:value;return Number(cap*BigInt(paid-refund)/BigInt(total));}
  return 0;
}
export function tierInput(input) {
  const o=strictObject(input,['tier','reason','expires_at','revision','confirm_billing_unchanged']);
  ensure(o.confirm_billing_unchanged===true,400,'Confirm that tier changes do not cancel or create Square billing.');
  const tier=v.oneOf(o.tier,'Tier',['inherit','collector','plus','complimentary']);
  const expires=o.expires_at==null?null:v.text(o.expires_at,'Expiry',10,40);
  ensure(!expires||(Number.isFinite(Date.parse(expires))&&Date.parse(expires)>Date.now()),400,'Expiry must be in the future.');
  ensure(tier!=='complimentary'||expires===null,400,'Complimentary access is non-expiring.');
  return {tier,expires_at:expires,reason:v.text(o.reason,'Reason',5,500),revision:v.integer(o.revision,'Revision',0,Number.MAX_SAFE_INTEGER)};
}
export function membershipAccess({user,grant,override,subscription,features,collectorFeatures,enforce=false,environment='sandbox',date=today(),now=Date.now()}) {
  let tier=null,reason='subscription_required';
  if(user?.role==='admin'){tier='complimentary';reason='administrator';}
  else if(['legacy_tester','beta_tester'].includes(grant?.kind)){tier='complimentary';reason=grant.kind;}
  else if(override?.tier==='complimentary'){tier='complimentary';reason='complimentary';}
  else if(override&&['collector','plus'].includes(override.tier)&&(!override.expires_at||Date.parse(override.expires_at)>now)){tier=override.tier;reason='administrator_assignment';}
  else if(subscription?.environment===environment&&subscription?.paid_through>date){tier=subscription.offer_snapshot.plan_code;reason='square_subscription';}
  if(!enforce&&!tier){tier='plus';reason='testing_policy';}
  const effective=enforce&&tier==='collector'?features.filter(f=>collectorFeatures.includes(f.code)):tier?features:[];
  return {allowed:effective.length>0,tier,reason,expires_at:null,payment_required:!tier,billing_enabled:false,enforcement_enabled:enforce,features:effective};
}

export function invoiceCycle(subscription,invoice,cadence) {
  if(!invoicePeriodEnd(subscription,invoice,cadence))return null;
  const [sy,sm]=subscription.start_date.split('-').map(Number),[dy,dm]=invoice.payment_requests[0].due_date.split('-').map(Number);
  return ((dy-sy)*12+dm-sm)/(cadence==='ANNUAL'?12:1)+1;
}
