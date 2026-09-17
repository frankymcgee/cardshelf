import { db,audit } from './db.mjs';
import { ensure } from './errors.mjs';
import * as v from './validate.mjs';
import { CURRENT_FEATURES } from '../shared/platform.mjs';
import { PLAN_FEATURES } from '../shared/binder-types.mjs';
import { squareConfiguration,today,membershipAccess,tierInput,strictObject } from './subscription-logic.mjs';
import { hashPassword } from './security.mjs';
export async function membershipState(userId,sql=db(),cfg=squareConfiguration()) {
  const [users,grants,overrides,subscriptions]=await Promise.all([
    sql`SELECT id,role FROM app_users WHERE id=${userId}`,sql`SELECT kind,granted_at,expires_at FROM account_access_grants WHERE user_id=${userId}`,
    sql`SELECT tier,reason,expires_at,revision FROM account_tier_overrides WHERE user_id=${userId}`,
    sql`SELECT environment,paid_through,offer_snapshot FROM square_subscriptions WHERE user_id=${userId} AND environment=${cfg.environment} ORDER BY paid_through DESC NULLS LAST LIMIT 1`
  ]);
  ensure(users[0],404,'Account not found.');
  const access=membershipAccess({user:users[0],grant:grants[0],override:overrides[0],subscription:subscriptions[0],features:CURRENT_FEATURES,
    collectorFeatures:PLAN_FEATURES.collector,enforce:cfg.enforce,environment:cfg.environment,date:today(cfg.timezone)});
  access.billing_enabled=cfg.enabled&&cfg.configured;
  return {access,grant:grants[0]??null,override:overrides[0]??null};
}
export async function requireCapability(userId,feature) {
  if(!squareConfiguration().enforce)return;
  const {access}=await membershipState(userId);
  ensure(access.features.some(f=>f.code===feature),403,'This action needs an active membership with this feature. Open Membership to review your access.');
}
export async function setTier(actorId,userId,input) {
  v.uuid(userId);const o=tierInput(input);
  return db().begin(async sql=>{
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${'billing:'+userId},0))`;
    ensure((await sql`SELECT id FROM app_users WHERE id=${userId}`).length,404,'Account not found.');
    const [old]=await sql`SELECT revision FROM account_tier_overrides WHERE user_id=${userId} FOR UPDATE`;
    ensure((old?.revision??0)===o.revision,409,'Account tier changed. Reload before saving.');
    const [saved]=await sql`INSERT INTO account_tier_overrides(user_id,tier,reason,expires_at)
      VALUES(${userId},${o.tier},${o.reason},${o.expires_at}) ON CONFLICT(user_id) DO UPDATE SET
      tier=excluded.tier,reason=excluded.reason,expires_at=excluded.expires_at,revision=account_tier_overrides.revision+1,updated_at=now() RETURNING tier,revision`;
    await audit(sql,actorId,'membership.tier_assigned',{user_id:userId,tier:o.tier,reason:o.reason});
    return {...saved,...await membershipState(userId,sql),billing_unchanged:true};
  });
}
export async function createSubscriptionAccount(actorId,input) {
  const o=strictObject(input,['name','email','password','confirm_no_tester_grant']);
  ensure(o.confirm_no_tester_grant===true,400,'Confirm this NEW account is subscription-ready, not an invited tester.');
  const name=v.text(o.name,'Name',1,80),email=v.email(o.email),hash=await hashPassword(v.password(o.password));
  try{return await db().begin(async sql=>{
    // The INSERT must succeed first. Duplicate emails never remove an existing grant.
    const [user]=await sql`INSERT INTO app_users(name,email,password_hash) VALUES(${name},${email},${hash}) RETURNING id,name,email,role`;
    await sql`DELETE FROM account_access_grants WHERE user_id=${user.id} AND kind='beta_tester'`;
    await audit(sql,actorId,'membership.subscription_account_created',{user_id:user.id});return user;
  });}catch(error){if(error.code==='23505')ensure(false,409,'That email already has an account. Existing access was not changed.');throw error;}
}
