import { db,audit,collectionLock } from './db.mjs';
import { ensure } from './errors.mjs';
import * as v from './validate.mjs';
import { rateLimit } from './auth.mjs';
import { hashPassword,verifyPassword } from './security.mjs';
import { membershipState } from './membership.mjs';
import { queueEmailVerification } from './email-verification.mjs';
import { freeSettingsInput,sponsorEligible,publicSponsor,FREE_PLACEMENTS } from './free-settings-logic.mjs';
const DEFAULTS={registration_enabled:false,ads_enabled:false,sponsor_name:'',sponsor_text:'',sponsor_url:'',sponsor_cta:'Learn more',sponsor_image_alt:'',has_image:false,revision:0};
export async function freeSettings(sql=db()) {
  const [row]=await sql`SELECT registration_enabled,ads_enabled,sponsor_name,sponsor_text,sponsor_url,sponsor_cta,sponsor_image_alt,
    (sponsor_image IS NOT NULL) AS has_image,revision,updated_at FROM free_platform_settings WHERE singleton`;
  return row??{...DEFAULTS};
}
async function confirmAdministrator(sql,actorId,password) {
  const [user]=await sql`SELECT role,password_hash FROM app_users WHERE id=${actorId}`;
  ensure(user?.role==='admin',403,'Administrator access is required.');
  await rateLimit('free-settings:'+actorId,20);
  ensure(typeof password==='string'&&password.length<=128&&await verifyPassword(password,user.password_hash),403,'Administrator password is incorrect.');
}
export async function saveFreeSettings(actorId,input) {
  const data=freeSettingsInput(input);
  await confirmAdministrator(db(),actorId,data.password);
  return db().begin(async sql=>{
    await sql`SELECT pg_advisory_xact_lock(72491301)`;
    const old=await freeSettings(sql);ensure(old.revision===data.revision,409,'Free settings changed. Reload before saving.');
    const {password,revision,reason,remove_image,...values}=data;
    await sql`INSERT INTO free_platform_settings ${sql({...values,singleton:true,updated_by:actorId})}
      ON CONFLICT(singleton) DO UPDATE SET ${sql(values)},updated_by=${actorId},revision=free_platform_settings.revision+1,updated_at=now()`;
    if(remove_image)await sql`UPDATE free_platform_settings SET sponsor_image=NULL WHERE singleton`;
    await audit(sql,actorId,'platform.free_settings',{registration_enabled:data.registration_enabled,ads_enabled:data.ads_enabled,reason});
    return freeSettings(sql);
  });
}
export async function uploadSponsorImage(actorId,input) {
  const o=v.object(input);
  ensure(Object.keys(o).every(k=>['password','revision','image_base64'].includes(k)),400,'Unsupported image field.');
  v.integer(o.revision,'Revision',1,Number.MAX_SAFE_INTEGER);
  await confirmAdministrator(db(),actorId,o.password);
  ensure(typeof o.image_base64==='string'&&o.image_base64.length<=1400000&&/^[A-Za-z0-9+/]+={0,2}$/.test(o.image_base64),400,'Upload a PNG, JPEG or WebP image smaller than 1 MB.');
  const bytes=Buffer.from(o.image_base64,'base64');
  ensure(bytes.length<=1024*1024&&bytes.length>10&&bytes.toString('base64')===o.image_base64,400,'Invalid image data.');
  const {default:sharp}=await import('sharp');let content;
  try {
    const image=sharp(bytes,{limitInputPixels:16000000,animated:false,failOn:'error'}),meta=await image.metadata();
    ensure(['jpeg','png','webp'].includes(meta.format)&&!(meta.pages>1),400,'Use a still PNG, JPEG or WebP image.');
    content=await image.rotate().resize({width:1400,height:500,fit:'inside',withoutEnlargement:true}).webp({quality:85}).toBuffer();
  }catch{ensure(false,400,'The image could not be decoded safely.');}
  return db().begin(async sql=>{
    await sql`SELECT pg_advisory_xact_lock(72491301)`;
    const [saved]=await sql`UPDATE free_platform_settings SET sponsor_image=${content},revision=revision+1,updated_at=now(),updated_by=${actorId}
      WHERE singleton AND revision=${o.revision} RETURNING revision`;
    ensure(saved,409,'Save the Free settings first, then reload before uploading.');
    await audit(sql,actorId,'platform.sponsor_image_uploaded');return freeSettings(sql);
  });
}
export async function createFreeAccount(input,ip,actorId=null) {
  const o=v.object(input);
  ensure(Object.keys(o).every(key=>['name','email','password','consent','website'].includes(key)),400,'Unsupported registration field.');
  if(actorId){const [u]=await db()`SELECT role FROM app_users WHERE id=${actorId}`;ensure(u?.role==='admin',403,'Administrator access required.');}
  else {
    ensure((await freeSettings()).registration_enabled,403,'Free self-registration is not open. Contact the administrator for access.');
    await rateLimit('free-register-ip:'+ip,5);await rateLimit('free-register-global',100);
  }
  ensure(!o.website&&o.consent===true,400,'Confirm the account and privacy notice.');
  const email=v.email(o.email),name=v.text(o.name,'Name',1,80);
  await rateLimit('free-register-email:'+email,3);
  const passwordHash=await hashPassword(v.password(o.password));
  try{return await db().begin(async sql=>{
    // Serialize with the registration kill switch. Never modify an existing email/account.
    await sql`SELECT pg_advisory_xact_lock_shared(72491301)`;
    if(!actorId)ensure((await freeSettings(sql)).registration_enabled,403,'Free registration has been paused.');
    ensure((await sql`SELECT id FROM app_users WHERE role='admin' LIMIT 1`).length,403,'The administrator must complete initial setup first.');
    const [user]=await sql`INSERT INTO app_users(name,email,password_hash,role,email_verification_required,email_verification_grandfathered_at) VALUES(${name},${email},${passwordHash},'user',true,NULL) RETURNING id`;
    // The historic invite trigger is retained for old administrative workflows.
    // Remove its automatic tester grant ONLY from this brand-new Free account.
    await sql`DELETE FROM account_access_grants WHERE user_id=${user.id} AND kind='beta_tester'`;
    await sql`INSERT INTO free_accounts(user_id) VALUES(${user.id})`;
    await sql`UPDATE account_memberships SET plan_code='free',updated_at=now() WHERE user_id=${user.id}`;
    await audit(sql,actorId??user.id,'auth.free_account_created',{user_id:user.id});
    await queueEmailVerification(sql,user.id,email);
    return {created:true,verification_required:true,message:'Check your email to verify your address before signing in.'};
  });}catch(error){if(error.code==='23505')ensure(false,409,'An account cannot be created with those details. Try signing in or contact the administrator.');throw error;}
}
async function adState(user) {
  if(!user || user.role!=='user')return {eligible:false};
  const [state,settings,requests]=await Promise.all([membershipState(user.id),freeSettings(),
    db()`SELECT 1 FROM stripe_subscriptions WHERE user_id=${user.id} AND (current OR paid_through>now()) LIMIT 1`]);
  const eligible=sponsorEligible({user,access:state.access,grant:state.grant,pendingBilling:requests.length>0,enabled:settings.ads_enabled});
  return {eligible,settings};
}
export async function advertisement(user,placement) {
  v.oneOf(placement,'Advertisement placement',FREE_PLACEMENTS);
  const {eligible,settings}=await adState(user);
  return eligible?{eligible:true,placement,creative:publicSponsor(settings)}:{eligible:false};
}
export async function sponsorImage(user) {
  ensure((await adState(user)).eligible,404,'Image not available.');
  const [row]=await db()`SELECT sponsor_image FROM free_platform_settings WHERE singleton AND ads_enabled`;
  ensure(row?.sponsor_image,404,'Image not available.');return row.sponsor_image;
}
