import { billingPolicy } from './billing-policy.mjs';
import { db,audit } from './db.mjs';
import { ensure } from './errors.mjs';
import * as v from './validate.mjs';
import { verifyPassword } from './security.mjs';
import { strictObject,hashValue } from './subscription-logic.mjs';
import { stripeEnvironment,stripeKey,stripeEncrypt,stripeDecrypt,stripeId,stripeOrigin,stripePrice,verifyStripePortal } from './stripe-logic.mjs';
import { stripeRequest } from './stripe-client.mjs';
export async function stripeAdmin(id,password) {
  const [u]=await db()`SELECT role,password_hash FROM app_users WHERE id=${v.uuid(id)}`;ensure(u?.role==='admin',403,'Administrator access is required.');
  if(password!==undefined)ensure(await verifyPassword(password,u.password_hash),403,'Confirm your current administrator password.');
}
export async function stripeConfig(environment=null) {
  const policy=await billingPolicy(),env=stripeEnvironment(environment??policy.environment),[row]=await db()`SELECT * FROM stripe_connections WHERE environment=${env}`;
  const cfg={...policy,environment:env,enabled:policy.enabled&&env===policy.environment,connection_revision:row?.revision??0,secret:'',webhookSecret:'',account:row?.account_id??'',portalId:row?.portal_id??null,accepting:row?.accepting_new??false,configured:false};
  if(row)try{cfg.secret=stripeDecrypt(row.api_secret,env,'api');cfg.webhookSecret=stripeDecrypt(row.webhook_secret,env,'webhook');cfg.configured=Boolean(cfg.secret&&cfg.webhookSecret&&cfg.account);}catch{cfg.connection_error='Stripe credentials need administrator attention.';}
  return cfg;
}
export async function stripeStatus(userId,environment) {
  await stripeAdmin(userId);const env=stripeEnvironment(environment),[r]=await db()`SELECT * FROM stripe_connections WHERE environment=${env}`;
  const cfg=await stripeConfig(env);
  const offers=await db()`SELECT * FROM stripe_offers WHERE environment=${env} ORDER BY created_at DESC LIMIT 100`;
  const events=await db()`SELECT event_id,event_type,status,last_error,received_at FROM stripe_webhook_events WHERE environment=${env} AND status<>'done' ORDER BY received_at DESC LIMIT 30`;
  const subscriptions=await db()`SELECT s.id,s.user_id,s.status,s.current,s.paid_through,s.cancel_at_period_end,s.last_error,s.synced_at,s.offer_snapshot->>'plan_code' AS plan_code,u.email FROM stripe_subscriptions s JOIN app_users u ON u.id=s.user_id WHERE s.environment=${env} ORDER BY s.created_at DESC LIMIT 50`;
  return {environment:env,active_environment:(await billingPolicy()).environment,billing_switch:cfg.enabled,enforcement_switch:cfg.enforce,configured:cfg.configured,accepting_new:r?.accepting_new??false,account_id:r?.account_id??'',account_name:r?.account_name??'',portal_id:r?.portal_id??'',revision:r?.revision??0,checked_at:r?.checked_at??null,webhook_seen_at:r?.webhook_seen_at??null,last_error:cfg.connection_error||r?.last_error||'',webhook_url:stripeOrigin(env)+'/api/billing/stripe/webhook/'+env,key_available:/^[a-f0-9]{64}$/i.test(process.env.CARDSHELF_INTEGRATION_KEY||''),offers,events,subscriptions};
}
async function inspect(cfg,api) {
  const account=await api(cfg,'/v1/account'),balance=await api(cfg,'/v1/balance');stripeId(account.id,'acct');
  ensure(balance.livemode===(cfg.environment==='production'),409,'Stripe key belongs to the wrong mode.');
  ensure(!cfg.account||cfg.account===account.id,409,'Reconnect the original Stripe business.');
  if(cfg.environment==='production')ensure(account.charges_enabled===true,409,'Stripe has not enabled charges for this business.');return account;
}
export async function saveStripeConnection(userId,environment,input,api=stripeRequest) {
  const env=stripeEnvironment(environment),o=strictObject(input,['revision','password','secret_key','webhook_secret','portal_id','accepting_new','confirm']);
  await stripeAdmin(userId,o.password??'');const revision=v.integer(o.revision,'Revision',0),accepting=v.bool(o.accepting_new??false,'Accept new subscriptions');ensure(o.confirm===true,400,'Confirm Stripe handles platform subscriptions only.');stripeOrigin(env);
  return db().begin(async sql=>{
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${'stripe-connection:'+env},0))`;
    const [old]=await sql`SELECT * FROM stripe_connections WHERE environment=${env} FOR UPDATE`;ensure((old?.revision??0)===revision,409,'Stripe settings changed. Reload.');
    const secret=o.secret_key?stripeKey(o.secret_key,env):old?stripeDecrypt(old.api_secret,env,'api'):null;
    const webhook=o.webhook_secret|| (old?stripeDecrypt(old.webhook_secret,env,'webhook'):null);ensure(typeof webhook==='string'&&/^whsec_[A-Za-z0-9]{16,250}$/.test(webhook),400,'Enter the Stripe endpoint signing secret.');ensure(secret,400,'Enter a Stripe secret key.');
    const cfg={environment:env,secret,account:old?.account_id??''},account=await inspect(cfg,api),portalId=o.portal_id?stripeId(o.portal_id,'bpc'):null;
    if(portalId)verifyStripePortal(await api(cfg,'/v1/billing_portal/configurations/'+portalId));
    if(accepting)ensure(portalId,409,'Configure a supported Stripe customer portal before accepting subscriptions.');
    await sql`INSERT INTO stripe_connections(environment,account_id,account_name,api_secret,webhook_secret,portal_id,accepting_new,checked_at)
      VALUES(${env},${account.id},${String(account.business_profile?.name||account.settings?.dashboard?.display_name||account.id).slice(0,200)},${stripeEncrypt(secret,env,'api')},${stripeEncrypt(webhook,env,'webhook')},${portalId},${accepting},now())
      ON CONFLICT(environment) DO UPDATE SET api_secret=excluded.api_secret,webhook_secret=excluded.webhook_secret,portal_id=excluded.portal_id,accepting_new=excluded.accepting_new,checked_at=now(),last_error='',revision=stripe_connections.revision+1,updated_at=now()`;
    await audit(sql,userId,'stripe.connection_saved',{environment:env,account_id:account.id,accepting_new:accepting});return {saved:true,billing_switch_unchanged:true};
  });
}
export async function testStripeConnection(userId,environment,api=stripeRequest) {
  await stripeAdmin(userId);const cfg=await stripeConfig(environment);await inspect(cfg,api);
  // Check each permission used in setup without creating a customer, subscription or charge.
  await api(cfg,'/v1/prices?active=true&type=recurring&limit=1');await api(cfg,'/v1/subscriptions?limit=1');
  await db()`UPDATE stripe_connections SET checked_at=now(),last_error='' WHERE environment=${cfg.environment}`;return {ok:true,charge_created:false};
}
export async function stripeCatalogue(userId,environment,query={},api=stripeRequest) {
  await stripeAdmin(userId);const cfg=await stripeConfig(environment);ensure(cfg.configured,409,'Save and verify Stripe credentials first.');
  const cursor=query.cursor?stripeId(query.cursor,'price'):'';
  const page=await api(cfg,'/v1/prices?active=true&type=recurring&limit=50&expand%5B%5D=data.product'+(cursor?'&starting_after='+cursor:''));
  return {prices:(page.data??[]).map(p=>{try{return {...stripePrice(p,cfg.environment),name:String(p.product?.name||p.nickname||p.id).slice(0,200)};}catch{return null;}}).filter(Boolean),next_cursor:page.has_more?page.data.at(-1)?.id??null:null};
}
export async function saveStripeOffer(userId,environment,input,api=stripeRequest) {
  await stripeAdmin(userId);const cfg=await stripeConfig(environment),o=strictObject(input,['price_id','plan_code','terms','tax_rate_id']);
  const plan=v.oneOf(o.plan_code,'Plan',['collector','plus']),terms=v.text(o.terms,'Subscription terms',60,6000),priceId=stripeId(o.price_id,'price'),taxId=o.tax_rate_id?stripeId(o.tax_rate_id,'txr'):null;
  const price=await api(cfg,'/v1/prices/'+priceId),tax=taxId?await api(cfg,'/v1/tax_rates/'+taxId):null;
  const data={...stripePrice(price,cfg.environment,tax),plan_code:plan,terms};
  const [saved]=await db()`INSERT INTO stripe_offers ${db()({...data,environment:cfg.environment,terms_hash:hashValue(data)})} ON CONFLICT(environment,price_id) DO NOTHING RETURNING id`;
  ensure(saved,409,'This price already has an offer. Use a new Stripe price for changed terms.');await audit(db(),userId,'stripe.offer_drafted',{offer_id:saved.id});return saved;
}
export async function publishStripeOffer(userId,environment,id,input,api=stripeRequest) {
  await stripeAdmin(userId);v.uuid(id);const cfg=await stripeConfig(environment),o=strictObject(input,['revision','published','confirm_terms_reviewed']),published=v.bool(o.published,'Published');v.integer(o.revision,'Revision',1);
  return db().begin(async sql=>{
    await sql`SELECT pg_advisory_xact_lock(72490901)`;
    const [offer]=await sql`SELECT * FROM stripe_offers WHERE id=${id} AND environment=${cfg.environment} FOR UPDATE`;ensure(offer?.revision===o.revision,409,'Offer changed. Reload.');
    if(published){ensure(o.confirm_terms_reviewed===true,400,'Confirm the price, tax and recurring terms.');const data=stripePrice(await api(cfg,'/v1/prices/'+offer.price_id),cfg.environment,offer.tax_rate_id?await api(cfg,'/v1/tax_rates/'+offer.tax_rate_id):null);ensure(data.total_minor===offer.total_minor&&data.tax_minor===offer.tax_minor&&data.cadence===offer.cadence,409,'Stripe price or tax changed. Use a new offer.');
      await sql`UPDATE stripe_offers SET published=false,revision=revision+1 WHERE environment=${cfg.environment} AND plan_code=${offer.plan_code} AND cadence=${offer.cadence} AND published AND id<>${id}`;}
    await sql`UPDATE stripe_offers SET published=${published},revision=revision+1 WHERE id=${id}`;await audit(sql,userId,'stripe.offer_publication',{offer_id:id,published});return {saved:true};
  });
}
