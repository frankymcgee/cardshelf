import { randomUUID } from 'node:crypto';
import { db,audit } from './db.mjs';
import { ensure } from './errors.mjs';
import * as v from './validate.mjs';
import { recoveryEmail } from './password-recovery-logic.mjs';
import { emailSettings,emailConfiguration,emailObject,requireEmailAdmin,lockEmailAdmin } from './email-settings.mjs';
import { enqueueEmail } from './email-outbox.mjs';
import { smtpVerify } from './smtp-client.mjs';
import { rateLimit } from './auth.mjs';
const safeCodes=new Set(['SMTP_DELIVERY_FAILED','EMAIL_DELIVERY_FAILED','DELIVERY_INTERRUPTED','DELIVERY_UNCERTAIN','RECIPIENT_UNAVAILABLE','RECIPIENT_SUPPRESSED','EVENT_UNAVAILABLE','PREFERENCE_DISABLED','POSTAL_DELIVERY_FAILED','POSTAL_BOUNCED']);
export function maskedEmail(value) {const [name,domain]=String(value||'').split('@');return domain?(name.slice(0,1)||'*')+'***@'+domain:'Unavailable';}
export function retryableEmail(row,now=Date.now()) {return row.source==='notification'&&row.status==='failed'&&!row.dispatch_started_at&&row.last_error!=='DELIVERY_UNCERTAIN'&&!row.provider_id&&!row.accepted_at&&Date.parse(row.expires_at)>now;}
export async function emailAdminOverview(actorId) {
  const sql=db();await requireEmailAdmin(actorId,undefined,sql);
  const [settings,counts,recent,suppressions]=await Promise.all([
    emailSettings(sql),
    sql`SELECT status,count(*)::integer AS count FROM (SELECT status FROM email_outbox UNION ALL SELECT status FROM password_recovery_mail) jobs GROUP BY status ORDER BY status`,
    sql`SELECT * FROM (SELECT o.id,'notification' AS source,o.kind,u.email,o.status,o.attempts,o.created_at,o.updated_at,o.expires_at,o.last_error,o.provider,o.provider_id,o.message_id,o.accepted_at,o.delivered_at,o.sent_with_ssl,o.dispatch_started_at
      FROM email_outbox o JOIN app_users u ON u.id=o.user_id
      UNION ALL SELECT r.id,'recovery' AS source,r.kind,r.email,r.status,r.attempts,r.created_at,coalesce(r.finished_at,r.created_at) AS updated_at,r.expires_at,r.last_error,r.provider,r.provider_id,r.message_id,r.accepted_at,r.delivered_at,r.sent_with_ssl,r.dispatch_started_at FROM password_recovery_mail r)
      jobs ORDER BY created_at DESC,id DESC LIMIT 50`,
    sql`SELECT email,reason,source,created_at FROM email_suppressions ORDER BY created_at DESC,email LIMIT 100`
  ]);
  return {settings,counts,recent:recent.map(({email,expires_at,...row})=>({...row,email:maskedEmail(email),last_error:safeCodes.has(row.last_error)?row.last_error:row.last_error?'DELIVERY_REQUIRES_ATTENTION':'',can_retry:retryableEmail({...row,expires_at})})),suppressions};
}
export async function testAdminEmail(actorId,input) {
  const data=emailObject(input,['password']),actor=await requireEmailAdmin(actorId,data.password??'');
  return db().begin(async sql=>{
    const current=await lockEmailAdmin(sql,actor),config=await emailConfiguration(sql);
    ensure(config.enabled&&config.configured,409,'Enable and configure the selected email provider before sending a test.');
    ensure(!(await sql`SELECT email FROM email_suppressions WHERE email=${recoveryEmail(current.email)}`).length,409,'Your account email is suppressed. Review suppressions before testing.');
    const job=await enqueueEmail(sql,{eventKey:'admin-test:'+randomUUID(),kind:'test',userId:current.id,expiresHours:1});
    await audit(sql,actorId,'email.test_queued',{job_id:job.id});
    return {queued:true,message:'Test email queued to your account.'};
  });
}
export async function retryAdminEmail(actorId,input) {
  const data=emailObject(input,['password','id']),id=v.uuid(data.id),actor=await requireEmailAdmin(actorId,data.password??'');
  return db().begin(async sql=>{
    await lockEmailAdmin(sql,actor);const config=await emailConfiguration(sql);
    ensure(config.enabled&&config.configured,409,'Enable and configure the selected email provider before retrying a notification.');
    const [row]=await sql`SELECT * FROM email_outbox WHERE id=${id} FOR UPDATE`;
    ensure(row&&retryableEmail({...row,source:'notification'}),409,'Only unaccepted, unexpired failed notifications can be retried. Request a fresh password reset instead.');
    await sql`UPDATE email_outbox SET status='queued',attempts=0,available_at=now(),lease_token=NULL,lease_until=NULL,last_error='',finished_at=NULL,dispatch_started_at=NULL,updated_at=now() WHERE id=${id}`;
    await audit(sql,actorId,'email.notification_retried',{job_id:id});
    return {queued:true,message:'Notification queued for another delivery attempt.'};
  });
}
export async function verifyAdminEmailConnection(actorId,input,{verify=smtpVerify}={}) {
  const data=emailObject(input,['password','revision']),actor=await requireEmailAdmin(actorId,data.password??''),sql=db();
  await rateLimit('email-connection:'+actorId,6);
  const config=await emailConfiguration(sql);
  ensure(config.revision===v.integer(data.revision,'Revision',1,Number.MAX_SAFE_INTEGER),409,'Email settings changed. Reload before checking the connection.');
  ensure(config.provider==='smtp'&&config.exists&&config.configured,409,'Save a complete SMTP connection before checking it.');
  try {await verify(config);}
  catch(error){
    await sql`UPDATE email_settings SET smtp_verified_at=NULL,smtp_verified_revision=NULL WHERE singleton AND revision=${config.revision}`;
    throw error;
  }
  return sql.begin(async tx=>{
    await lockEmailAdmin(tx,actor);
    const [row]=await tx`UPDATE email_settings SET smtp_verified_at=now(),smtp_verified_revision=revision
      WHERE singleton AND revision=${config.revision} AND provider='smtp' RETURNING smtp_verified_at`;
    ensure(row,409,'Email settings changed during the check. Reload and check the saved connection again.');
    await audit(tx,actorId,'email.connection_verified',{provider:'smtp'});
    return {verified:true,checked_at:row.smtp_verified_at,message:'SMTP TLS and login verified. No email was sent. Sender acceptance and inbox delivery still need a test.'};
  });
}
export async function setEmailSuppression(actorId,input) {
  const data=emailObject(input,['password','email','suppressed','reason']),email=recoveryEmail(data.email),suppressed=v.bool(data.suppressed,'Suppress recipient');
  const reason=v.text(data.reason,'Reason',5,100);ensure(!/[\x00-\x1f\x7f]/.test(reason),400,'Reason contains an invalid character.');
  const actor=await requireEmailAdmin(actorId,data.password??'');
  return db().begin(async sql=>{
    await lockEmailAdmin(sql,actor);
    if(suppressed)await sql`INSERT INTO email_suppressions(email,reason,source,updated_by) VALUES(${email},${reason},'manual',${actorId})
      ON CONFLICT(email) DO UPDATE SET reason=excluded.reason,source='manual',updated_by=excluded.updated_by,created_at=now()`;
    else await sql`DELETE FROM email_suppressions WHERE email=${email}`;
    // The recipient's address and reason remain in the dedicated admin table,
    // not in general application audit logs.
    await audit(sql,actorId,'email.suppression_changed',{suppressed});return {saved:true};
  });
}
