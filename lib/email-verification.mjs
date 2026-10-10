import { db, audit } from './db.mjs';
import { AppError, ensure } from './errors.mjs';
import { rateLimit } from './auth.mjs';
import { digest, randomToken, verifyPassword } from './security.mjs';
import { configuration } from './config.mjs';
import { recoveryEmail } from './password-recovery-logic.mjs';
import { sendRecoveryEmail, deliveryConfiguration, suppressedEmail } from './password-recovery-mail.mjs';
import { reserveEmailDispatch, knownEmailRejection } from './email-dispatch.mjs';
import { deliveryMessageId } from './email-outbox.mjs';
import { smtpHistoryCode } from './smtp-errors.mjs';
import { VERIFICATION_HOURS, VERIFICATION_MESSAGE, VERIFICATION_ERROR, verificationRequestInput,
  verificationCompleteInput, verificationLink, verificationTokenIsCurrent, verificationMail } from './email-verification-logic.mjs';

// Transactional application registration hook. It stores only the intended
// account and mailbox, never a bearer link. The mail worker validates them again.
export async function queueEmailVerification(sql, userId, email) {
  await sql`INSERT INTO email_verification_mail(user_id,email) VALUES(${userId},${recoveryEmail(email)})`;
}
export async function requestEmailVerification(input, ip) {
  const {email} = verificationRequestInput(input);
  await rateLimit('email-verification-ip:' + ip, 10);
  try {
    await rateLimit('email-verification-email:' + email, 3);
    await rateLimit('email-verification-global', 300);
  } catch (error) {
    if (!(error instanceof AppError) || error.status !== 429) throw error;
    return {message: VERIFICATION_MESSAGE};
  }
  // The same cooldown and enqueue operation runs for every syntactically valid
  // mailbox. Account lookup happens asynchronously, avoiding account discovery.
  await db().begin(async sql => {
    const rows = await sql`INSERT INTO auth_attempts(bucket,attempts,reset_at)
      VALUES(${digest('email-verification-cooldown:' + email)},1,now()+interval '60 seconds')
      ON CONFLICT(bucket) DO UPDATE SET attempts=1,reset_at=excluded.reset_at
      WHERE auth_attempts.reset_at<=now() RETURNING bucket`;
    if (rows.length) await queueEmailVerification(sql, null, email);
  });
  return {message: VERIFICATION_MESSAGE};
}
export async function completeEmailVerification(input, ip) {
  await rateLimit('email-verify-ip:' + ip, 30);
  const data = verificationCompleteInput(input), tokenHash = digest(data.token);
  const [candidate] = await db()`SELECT u.id,u.password_hash FROM email_verification_tokens t
    JOIN app_users u ON u.id=t.user_id WHERE t.token_hash=${tokenHash}`;
  ensure(candidate, 400, VERIFICATION_ERROR);
  // Per-account limits persist across new links and IP addresses.
  await rateLimit('email-verify-account:' + candidate.id, 10);
  ensure(await verifyPassword(data.password, candidate.password_hash), 400, VERIFICATION_ERROR);
  return db().begin(async sql => {
    // Account then token is the global lock order used by issuance, password
    // changes and concurrent verification. Only one completion can commit.
    const [user] = await sql`SELECT id,email,password_hash,security_version,email_verified_at
      FROM app_users WHERE id=${candidate.id} FOR UPDATE`;
    const [token] = await sql`SELECT * FROM email_verification_tokens WHERE token_hash=${tokenHash} FOR UPDATE`;
    ensure(user?.password_hash === candidate.password_hash && verificationTokenIsCurrent(token, user), 400, VERIFICATION_ERROR);
    await sql`UPDATE email_verification_tokens SET consumed_at=now() WHERE token_hash=${tokenHash}`;
    await sql`UPDATE app_users SET email_verified_at=now(),email_verification_required=false,
      security_version=security_version+1 WHERE id=${user.id}`;
    await sql`DELETE FROM sessions WHERE user_id=${user.id}`;
    await sql`DELETE FROM account_pending_auth WHERE user_id=${user.id}`;
    await sql`DELETE FROM account_security_challenges WHERE user_id=${user.id}`;
    await sql`DELETE FROM account_security_proofs WHERE user_id=${user.id}`;
    await sql`DELETE FROM email_verification_tokens WHERE user_id=${user.id}`;
    await sql`DELETE FROM email_verification_mail WHERE user_id=${user.id} OR lower(email)=${user.email.toLowerCase()}`;
    await audit(sql, user.id, 'auth.email_verified');
    return {verified:true, message:'Your email address is verified. Sign in to continue.'};
  });
}
async function issueVerificationToken(sql, user, origin) {
  const token = randomToken(), tokenHash = digest(token), expires = new Date(Date.now() + VERIFICATION_HOURS * 3600000);
  const url = verificationLink(origin, token);
  await sql`INSERT INTO email_verification_tokens(token_hash,user_id,email,password_fingerprint,security_version,expires_at)
    VALUES(${tokenHash},${user.id},${recoveryEmail(user.email)},${digest(user.password_hash)},${user.security_version},${expires})`;
  return {tokenHash, url};
}
// Injectable transport is internal test infrastructure; never supplied by an API.
export async function processVerificationMail({sql=db(),send=sendRecoveryEmail,origin=configuration().origin}={}) {
  const config = await deliveryConfiguration(sql);
  if (send === sendRecoveryEmail && (!config.enabled || !config.configured)) return false;
  const lease = randomToken(); let ignored = false;
  const job = await sql.begin(async tx => {
    await tx`UPDATE email_verification_mail SET status=CASE WHEN dispatch_started_at IS NOT NULL THEN 'uncertain' WHEN attempts<3 THEN 'queued' ELSE 'failed' END,
      lease_token=NULL,lease_until=NULL,last_error=CASE WHEN dispatch_started_at IS NOT NULL THEN 'DELIVERY_UNCERTAIN' ELSE 'DELIVERY_INTERRUPTED' END,
      finished_at=CASE WHEN dispatch_started_at IS NOT NULL OR attempts>=3 THEN now() ELSE NULL END
      WHERE status='sending' AND lease_until<now()`;
    const discarded = await tx`WITH candidates AS (
      SELECT r.id FROM email_verification_mail r WHERE r.status='queued' AND r.attempts<3 AND r.available_at<=now() AND r.expires_at>now()
        AND NOT EXISTS (SELECT 1 FROM app_users u WHERE lower(u.email)=r.email AND u.email_verified_at IS NULL
          AND (r.user_id IS NULL OR r.user_id=u.id))
      ORDER BY r.created_at,r.id FOR UPDATE OF r SKIP LOCKED LIMIT 100
    ) UPDATE email_verification_mail SET status='ignored',finished_at=now(),lease_token=NULL,lease_until=NULL,last_error=''
      WHERE id IN (SELECT id FROM candidates) RETURNING id`;
    ignored = discarded.length > 0;
    const [row] = await tx`SELECT r.* FROM email_verification_mail r WHERE r.status='queued' AND r.attempts<3
      AND r.available_at<=now() AND r.expires_at>now()
      AND EXISTS (SELECT 1 FROM app_users u WHERE lower(u.email)=r.email AND u.email_verified_at IS NULL
        AND (r.user_id IS NULL OR r.user_id=u.id))
      ORDER BY r.created_at,r.id FOR UPDATE SKIP LOCKED LIMIT 1`;
    if (!row || !await reserveEmailDispatch(tx, config, 'verification')) return null;
    const [claimed] = await tx`UPDATE email_verification_mail SET status='sending',attempts=attempts+1,
      lease_token=${lease},lease_until=now()+interval '2 minutes' WHERE id=${row.id} RETURNING *`;
    return claimed;
  });
  if (!job) return ignored;
  let issuedHash = null;
  try {
    const prepared = await sql.begin(async tx => {
      const [user] = await tx`SELECT id,email,password_hash,security_version,email_verified_at FROM app_users
        WHERE lower(email)=${job.email} AND (${job.user_id}::uuid IS NULL OR id=${job.user_id}) FOR UPDATE`;
      if (!user || user.email_verified_at) return null;
      const [current] = await tx`SELECT id FROM email_verification_mail WHERE id=${job.id} AND lease_token=${lease}
        AND status='sending' AND lease_until>now() AND expires_at>now()`;
      if (!current) return null;
      const address = recoveryEmail(user.email);
      if (await suppressedEmail(address, tx)) return {suppressed:true};
      const issued = await issueVerificationToken(tx, user, origin); issuedHash = issued.tokenHash;
      return {address, message:verificationMail(origin, issued.url)};
    });
    if (prepared?.suppressed) {
      await sql`UPDATE email_verification_mail SET status='suppressed',finished_at=now(),lease_token=NULL,lease_until=NULL,
        last_error='RECIPIENT_SUPPRESSED' WHERE id=${job.id} AND lease_token=${lease}`;
      return true;
    }
    let result = null;
    const messageId = deliveryMessageId('verification', job.id, origin);
    if (prepared) {
      const reserved = await sql`UPDATE email_verification_mail SET message_id=${messageId},recipient_hash=${digest(prepared.address)},
        provider=${config.provider},dispatch_started_at=now(),lease_until=now()+interval '2 minutes'
        WHERE id=${job.id} AND lease_token=${lease} AND status='sending' AND lease_until>now() AND expires_at>now() RETURNING id`;
      if (!reserved.length) {
        if (issuedHash) await sql`DELETE FROM email_verification_tokens WHERE token_hash=${issuedHash}`;
        return true;
      }
      result = await send(prepared.address, prepared.message, {messageId,tag:'cardshelf-verification',configuration:config});
    }
    const status = !prepared ? 'ignored' : result ? 'accepted' : 'sent';
    await sql`UPDATE email_verification_mail SET status=CASE WHEN status='sending' THEN ${status} ELSE status END,
      provider=${result?.provider||config.provider},provider_id=${result?.provider_id?String(result.provider_id):null},message_id=${result?.message_id||messageId},
      accepted_at=CASE WHEN ${!!prepared} THEN coalesce(accepted_at,now()) ELSE accepted_at END,
      finished_at=CASE WHEN ${status}='accepted' THEN finished_at ELSE now() END,
      lease_token=NULL,lease_until=NULL,last_error=CASE WHEN status='sending' THEN '' ELSE last_error END WHERE id=${job.id} AND lease_token=${lease}`;
  } catch (error) {
    const suppressed = error?.emailCode === 'RECIPIENT_SUPPRESSED', rejected = knownEmailRejection(error);
    const [state] = await sql`SELECT dispatch_started_at FROM email_verification_mail WHERE id=${job.id} AND lease_token=${lease}`;
    const uncertain = !!state?.dispatch_started_at && !suppressed && !rejected;
    // A possibly delivered link stays valid until expiry, but is never resent.
    if (issuedHash && !uncertain) await sql`DELETE FROM email_verification_tokens WHERE token_hash=${issuedHash}`;
    await sql`UPDATE email_verification_mail SET status=CASE WHEN ${suppressed} THEN 'suppressed' WHEN ${uncertain} THEN 'uncertain' WHEN attempts<3 THEN 'queued' ELSE 'failed' END,
      available_at=now()+interval '2 minutes',lease_token=NULL,lease_until=NULL,
      dispatch_started_at=CASE WHEN ${suppressed||rejected} THEN NULL ELSE dispatch_started_at END,
      last_error=${suppressed?'RECIPIENT_SUPPRESSED':uncertain?'DELIVERY_UNCERTAIN':smtpHistoryCode(error)||'EMAIL_DELIVERY_FAILED'},
      finished_at=CASE WHEN ${suppressed||uncertain} OR attempts>=3 THEN now() ELSE NULL END
      WHERE id=${job.id} AND lease_token=${lease} AND status='sending'`;
  }
  return true;
}
export async function verificationMailTick() {
  await db()`DELETE FROM email_verification_tokens WHERE expires_at<=now()`;
  await db()`UPDATE email_verification_mail SET status='expired',finished_at=now(),lease_token=NULL,lease_until=NULL
    WHERE expires_at<=now() AND (status='queued' OR status='sending' AND lease_until<now())`;
  await db()`DELETE FROM email_verification_mail WHERE coalesce(finished_at,accepted_at,created_at)<now()-interval '30 days' AND status<>'sending'`;
  await processVerificationMail();
}
