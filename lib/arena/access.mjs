import { db,audit } from '../db.mjs';
import { verifyPassword } from '../security.mjs';
import { arenaPaidTier } from '../../shared/arena.mjs';
import * as v from './input.mjs';
export const ARENA_LOCK=72491701;
export async function arenaEntitlement(userId,sql=db()) {
  const [overrides,subscriptions]=await Promise.all([
    sql`SELECT tier,expires_at FROM account_tier_overrides WHERE user_id=${userId}`,
    sql`SELECT environment,paid_through,offer_snapshot FROM stripe_subscriptions WHERE user_id=${userId} AND environment='production' AND paid_through>now()`
  ]);
  return arenaPaidTier({override:overrides[0],subscriptions});
}
export async function arenaSettings(sql=db()) {
  const [row]=await sql`SELECT enabled,revision,updated_at FROM arena_settings WHERE singleton`;
  return row||{enabled:false,revision:0,updated_at:null};
}
export async function arenaAccess(userId,sql=db()) {
  const [user]=await sql`SELECT id,role FROM app_users WHERE id=${userId}`;v.check(user,'Sign in to continue.',401);
  const [settings,entitlement]=await Promise.all([arenaSettings(sql),arenaEntitlement(userId,sql)]);
  return {enabled:settings.enabled,allowed:settings.enabled&&!!entitlement,tier:entitlement?.tier||null,reason:entitlement?.reason||'subscription_required',is_admin:user.role==='admin',game:'pokemon',
    message:!entitlement?'Arena requires Collector, Collector Plus or an explicit Complimentary assignment. Free and general tester access do not automatically include battles.':!settings.enabled?'Automated battles are paused by the administrator.':'Automated Casual Expanded is available.'};
}
export async function requireArena(userId,sql=db(),locking=false) {
  if(locking){await sql`SELECT pg_advisory_xact_lock_shared(${ARENA_LOCK})`;await sql`SELECT pg_advisory_xact_lock(hashtextextended(${'billing:'+userId},0))`;}
  const access=await arenaAccess(userId,sql);v.check(access.allowed,access.message,403);return access;
}
export async function saveArenaSettings(actorId,value) {
  const o=v.object(value,['enabled','revision','password','reason','confirm_rules','confirm_rights']);v.integer(o.revision);v.check(typeof o.enabled==='boolean','Choose enabled or disabled.');
  const reason=v.text(o.reason,5,500);v.check(typeof o.password==='string'&&o.password.length>0&&o.password.length<=128,'Confirm your administrator password.');
  if(o.enabled)v.check(o.confirm_rules===true&&o.confirm_rights===true,'Confirm the supported card pool and publisher-rights review.');
  return db().begin(async sql=>{
    await sql`SELECT pg_advisory_xact_lock(${ARENA_LOCK})`;
    const [actor]=await sql`SELECT role,password_hash FROM app_users WHERE id=${actorId} FOR UPDATE`;
    v.check(actor?.role==='admin'&&await verifyPassword(o.password,actor.password_hash),'Administrator password is incorrect or permission changed.',403);
    const old=await arenaSettings(sql);v.check(old.revision===o.revision,'Settings changed. Reload before saving.',409);
    await sql`INSERT INTO arena_settings(singleton,enabled,updated_by) VALUES(true,${o.enabled},${actorId}) ON CONFLICT(singleton) DO UPDATE SET enabled=excluded.enabled,revision=arena_settings.revision+1,updated_by=excluded.updated_by,updated_at=now()`;
    await audit(sql,actorId,'arena.enabled',{enabled:o.enabled,reason});return arenaSettings(sql);
  });
}
