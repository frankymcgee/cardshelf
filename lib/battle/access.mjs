import { db, audit } from '../db.mjs';
import { ensure } from '../errors.mjs';
import { verifyPassword } from '../security.mjs';
import * as input from './input.mjs';
export const BATTLE_LOCK = 72491501;
export async function battleAccess(userId, sql=db()) {
  const [u]=await sql`SELECT role FROM app_users WHERE id=${userId}`;ensure(u,401,'Sign in to continue.');
  const [settings]=await sql`SELECT enabled FROM battle_settings WHERE singleton`;
  const approved=u.role==='admin'||(await sql`SELECT user_id FROM battle_access WHERE user_id=${userId}`).length>0;
  return {enabled:settings?.enabled===true,approved,allowed:settings?.enabled===true&&approved,is_admin:u.role==='admin',game:'pokemon'};
}
export async function requireBattle(userId,sql=db(),locking=false) {
  if(locking)await sql`SELECT pg_advisory_xact_lock_shared(${BATTLE_LOCK})`;
  const access=await battleAccess(userId,sql);
  ensure(access.enabled,403,'Battle beta is disabled. Your saved decks and matches are retained.');
  ensure(access.approved,403,'An administrator must approve your account for the battle beta.');return access;
}
async function administrator(sql,userId,password) {
  const [u]=await sql`SELECT role,password_hash FROM app_users WHERE id=${userId}`;
  ensure(u?.role==='admin',403,'Administrator access is required.');
  if(password!==undefined)ensure(await verifyPassword(password,u.password_hash),403,'Confirm your current administrator password.');
}
export async function battleAdministration(userId,query='',sql=db()) {
  await administrator(sql,userId);
  const q=input.text(query,'account search',0,80),pattern='%'+q.replace(/[\\%_]/g,'\\$&')+'%';
  const [settings]=await sql`SELECT enabled,revision,updated_at FROM battle_settings WHERE singleton`;
  const accounts=await sql`SELECT u.id,u.name,u.email,u.role,(b.user_id IS NOT NULL) AS approved FROM app_users u
    LEFT JOIN battle_access b ON b.user_id=u.id WHERE ${q?sql`u.email ILIKE ${pattern} OR u.name ILIKE ${pattern}`:sql`b.user_id IS NOT NULL`}
    ORDER BY lower(u.name),u.id LIMIT 30`;
  return {settings:settings||{enabled:false,revision:0,updated_at:null},accounts};
}
export async function updateBattleAdministration(userId,value) {
  const o=input.object(value,['revision','password','reason','enabled','user_id','approved','confirm_assisted','confirm_rights']);
  input.integer(o.revision);const reason=input.text(o.reason,'reason',5,500);
  ensure(typeof o.password==='string'&&o.password.length>0&&o.password.length<=128,400,'Confirm your administrator password.');
  const grant=o.user_id!==undefined;
  if(grant){input.uuid(o.user_id);ensure(typeof o.approved==='boolean'&&o.enabled===undefined,400,'Choose an account approval state only.');}
  else {ensure(typeof o.enabled==='boolean'&&o.approved===undefined,400,'Choose whether to enable battle beta.');if(o.enabled)ensure(o.confirm_assisted===true&&o.confirm_rights===true,400,'Confirm assisted-play limitations and review of game-data/artwork rights before enabling.');}
  return db().begin(async sql=>{
    await sql`SELECT pg_advisory_xact_lock(${BATTLE_LOCK})`;
    await administrator(sql,userId,o.password);
    const [old]=await sql`SELECT enabled,revision FROM battle_settings WHERE singleton FOR UPDATE`;
    ensure((old?.revision??0)===o.revision,409,'Battle settings changed. Reload before saving.');
    if(grant){
      const [target]=await sql`SELECT role FROM app_users WHERE id=${o.user_id}`;ensure(target,404,'Account not found.');
      ensure(target.role!=='admin',400,'Administrators are already eligible when the beta is enabled.');
      if(o.approved)await sql`INSERT INTO battle_access(user_id,granted_by) VALUES(${o.user_id},${userId}) ON CONFLICT(user_id) DO NOTHING`;
      else await sql`DELETE FROM battle_access WHERE user_id=${o.user_id}`;
    }
    await sql`INSERT INTO battle_settings(singleton,enabled,updated_by) VALUES(true,${grant?(old?.enabled??false):o.enabled},${userId})
      ON CONFLICT(singleton) DO UPDATE SET enabled=excluded.enabled,revision=battle_settings.revision+1,updated_by=excluded.updated_by,updated_at=now()`;
    await audit(sql,userId,grant?'battle.access_changed':'battle.enabled_changed',{reason,...(grant?{user_id:o.user_id,approved:o.approved}:{enabled:o.enabled})});
    return battleAdministration(userId,'',sql);
  });
}
