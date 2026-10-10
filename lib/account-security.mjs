import { randomUUID } from 'node:crypto';
import { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } from '@simplewebauthn/server';
import { db, audit } from './db.mjs';
import { configuration } from './config.mjs';
import { AppError, ensure } from './errors.mjs';
import { digest, randomToken, verifyPassword } from './security.mjs';
import * as v from './validate.mjs';
import { PENDING_SECONDS, CHALLENGE_SECONDS, STRONG_AUTH_SECONDS, MAX_SECURITY_ATTEMPTS,
  adminMfaRequired, recoveryCodeHash, newRecoveryCodes, newTotp, encryptTotp, decryptTotp,
  verifyTotpSecret, webauthnConfiguration, emailVerified, publicUser, validToken } from './account-security-logic.mjs';

// Every security mutation locks app_users first. This serializes version changes,
// authenticator counters, recovery redemption and session creation per account.
export async function securityRateLimit(bucket, limit = 10) {
  const [record] = await db()`INSERT INTO auth_attempts(bucket,attempts,reset_at)
    VALUES(${digest(bucket)},1,now()+interval '15 minutes') ON CONFLICT(bucket) DO UPDATE SET
    attempts=CASE WHEN auth_attempts.reset_at<now() THEN 1 ELSE auth_attempts.attempts+1 END,
    reset_at=CASE WHEN auth_attempts.reset_at<now() THEN now()+interval '15 minutes' ELSE auth_attempts.reset_at END RETURNING attempts`;
  ensure(record.attempts <= limit, 429, 'Too many security attempts. Try again after 15 minutes.');
}
async function limit(tokens, ip) {
  await securityRateLimit('security-ip:' + ip, 100);
  const pendingHash = validToken(tokens?.pendingToken) ? digest(tokens.pendingToken) : null;
  const sessionHash = validToken(tokens?.sessionToken) ? digest(tokens.sessionToken) : null;
  const hashes = [...new Set([pendingHash,sessionHash].filter(Boolean))];
  for (const hash of hashes.length ? hashes : [digest('missing')]) await securityRateLimit('security-context:' + hash, 30);
  // Session-only actions must not charge an unrelated pending cookie instead of
  // their actual account. Count both presented contexts and deduplicate owners.
  const owners = await db()`SELECT user_id FROM account_pending_auth WHERE token_hash=${pendingHash}
    UNION SELECT user_id FROM sessions WHERE token_hash=${sessionHash}`;
  for (const owner of owners) await securityRateLimit('security-user:' + owner.user_id, 50);
}
export async function accountFactors(sql, userId) {
  const totp = await sql`SELECT id,label,created_at,last_used_at FROM account_totp_credentials WHERE user_id=${userId} ORDER BY created_at`;
  const passkeys = await sql`SELECT id,label,created_at,last_used_at,device_type,backed_up FROM account_passkeys WHERE user_id=${userId} ORDER BY created_at`;
  return { totp, passkeys, enrolled: !!(totp.length + passkeys.length), methods: [...(totp.length ? ['totp'] : []), ...(passkeys.length ? ['passkey'] : [])] };
}
export async function createAccountSession(sql, user, strength = 'password', strongAt = null, provenance = null) {
  const token = randomToken();
  const ancestry = provenance?.pending_auth_hashes || [];
  const ancestryExpiry = ancestry.length ? provenance.pending_auth_expires_at || provenance.expires_at : null;
  await sql`INSERT INTO sessions(token_hash,user_id,expires_at,security_version,auth_strength,strong_authenticated_at,pending_auth_hashes,pending_auth_expires_at)
    VALUES(${digest(token)},${user.id},${new Date(Date.now()+configuration().sessionSeconds*1000)},${user.security_version},${strength},${strongAt},${ancestry},${ancestryExpiry})`;
  return token;
}
export async function createPendingAuth(sql, user, scope, recoveryMode = false, predecessor = null) {
  const token = randomToken(), hash = digest(token);
  const expires = new Date(Math.min(Date.now() + PENDING_SECONDS * 1000,
    predecessor ? new Date(predecessor.expires_at).getTime() : Infinity));
  const ancestry = [...new Set([...(predecessor?.pending_auth_hashes || []), ...(predecessor ? [predecessor.token_hash] : []), hash])];
  ensure(ancestry.length <= 2 && expires.getTime() > Date.now(), 401, 'This sign-in attempt expired. Sign in again.');
  // Keep only a bounded set of live password-verified login attempts.
  await sql`DELETE FROM account_pending_auth WHERE user_id=${user.id} AND (expires_at<=now() OR token_hash IN
    (SELECT token_hash FROM account_pending_auth WHERE user_id=${user.id} ORDER BY created_at DESC OFFSET 4))`;
  await sql`INSERT INTO account_pending_auth(token_hash,user_id,security_version,scope,recovery_mode,expires_at,pending_auth_hashes)
    VALUES(${hash},${user.id},${user.security_version},${scope},${recoveryMode},${expires},${ancestry})`;
  const factors = await accountFactors(sql, user.id);
  return { user: null, pending_token: token, pending: { scope, methods: user.mfa_reset_required && !recoveryMode ? [] : factors.methods,
    expires_at: expires.toISOString(), recovery_mode: recoveryMode } };
}
export async function passwordLoginResult(sql, user) {
  if (!emailVerified(user)) return { user: null, pending: { scope: 'email_verification', methods: [] } };
  const factors = await accountFactors(sql, user.id);
  if (user.mfa_reset_required || factors.enrolled) return createPendingAuth(sql, user, 'mfa');
  if (user.role === 'admin' && adminMfaRequired()) return createPendingAuth(sql, user, 'enrollment');
  return { user: publicUser(user), token: await createAccountSession(sql, user) };
}
export async function readFullSession(token, sql = db()) {
  if (!validToken(token)) return null;
  const [row] = await sql`SELECT u.*,s.auth_strength,s.strong_authenticated_at,s.token_hash AS session_hash,
    s.pending_auth_hashes,s.pending_auth_expires_at
    FROM sessions s JOIN app_users u ON u.id=s.user_id WHERE s.token_hash=${digest(token)} AND s.expires_at>now()
    AND s.security_version=u.security_version AND NOT u.mfa_reset_required
    AND (NOT u.email_verification_required OR u.email_verified_at IS NOT NULL)
    AND ((NOT EXISTS(SELECT 1 FROM account_totp_credentials t WHERE t.user_id=u.id)
      AND NOT EXISTS(SELECT 1 FROM account_passkeys p WHERE p.user_id=u.id)
      AND NOT (u.role='admin' AND ${adminMfaRequired()})) OR s.auth_strength='mfa')`;
  // A strong session must still have an active enrolled factor. No retired or
  // manually edited session can keep admin access after the last factor is lost.
  if (row?.auth_strength === 'mfa') {
    const factors = await accountFactors(sql, row.id);
    if (!factors.enrolled) return null;
  }
  return row || null;
}
async function context(sql, tokens, { pending = true } = {}) {
  const pendingToken = pending && validToken(tokens?.pendingToken) ? tokens.pendingToken : null;
  const sessionToken = validToken(tokens?.sessionToken) ? tokens.sessionToken : null;
  const [candidate] = pendingToken ? await sql`SELECT user_id FROM account_pending_auth WHERE token_hash=${digest(pendingToken)}`
    : sessionToken ? await sql`SELECT user_id FROM sessions WHERE token_hash=${digest(sessionToken)}` : [];
  ensure(candidate, 401, 'Sign in again to continue.');
  const [user] = await sql`SELECT * FROM app_users WHERE id=${candidate.user_id} FOR UPDATE`;
  ensure(user && emailVerified(user), 401, 'Verify your email and sign in again.');
  if (pendingToken) {
    const [row] = await sql`SELECT * FROM account_pending_auth WHERE token_hash=${digest(pendingToken)}
      AND user_id=${user.id} AND security_version=${user.security_version} AND expires_at>now() AND attempts<=${MAX_SECURITY_ATTEMPTS}`;
    ensure(row, 401, 'This sign-in attempt expired. Sign in again.');
    return { user, pending: row, hash: digest(pendingToken) };
  }
  const session = await readFullSession(sessionToken, sql);
  ensure(session && session.id === user.id, 401, 'Sign in again to continue.');
  return { user, session, hash: digest(sessionToken) };
}
export async function securityStatus(tokens = {}) {
  return db().begin(async sql => {
    let ctx;
    try { ctx = await context(sql, tokens); }
    catch (error) { if (!(error instanceof AppError) || error.status !== 401) throw error;
      return { user: null, pending: null, totp: [], passkeys: [], factors: [], recovery_codes_remaining: 0, require_admin_mfa: adminMfaRequired(), recent_strong_auth: false }; }
    const factors = await accountFactors(sql, ctx.user.id);
    const [codes] = await sql`SELECT count(*)::integer AS n FROM account_recovery_codes WHERE user_id=${ctx.user.id} AND used_at IS NULL AND (expires_at IS NULL OR expires_at>now())`;
    return { user: ctx.session ? publicUser(ctx.user) : null,
      pending: ctx.pending ? { scope: ctx.pending.scope, methods: ctx.user.mfa_reset_required && !ctx.pending.recovery_mode ? [] : factors.methods,
        expires_at: ctx.pending.expires_at, recovery_mode: ctx.pending.recovery_mode } : null,
      scope: ctx.pending?.scope || 'session', methods: factors.methods,
      totp: factors.totp, passkeys: factors.passkeys,
      factors: [...factors.totp.map(f => ({ ...f, kind: 'totp' })), ...factors.passkeys.map(f => ({ ...f, kind: 'passkey' }))],
      recovery_codes_remaining: codes.n, require_admin_mfa: adminMfaRequired(),
      recent_strong_auth: !!(ctx.session?.auth_strength === 'mfa' && Date.now()-new Date(ctx.session.strong_authenticated_at).getTime()<STRONG_AUTH_SECONDS*1000) };
  });
}
async function passwordProof(ctx, data) {
  ensure(typeof data.password === 'string' && await verifyPassword(data.password, ctx.user.password_hash), 403, 'Your password is incorrect.');
}
async function checkTotp(sql, user, code) {
  ensure(typeof code === 'string' && /^\d{6}$/.test(code), 403, 'Enter a valid authenticator code.');
  const rows = await sql`SELECT * FROM account_totp_credentials WHERE user_id=${user.id} ORDER BY id FOR UPDATE`;
  for (const factor of rows) {
    const step = await verifyTotpSecret(decryptTotp(factor.secret_ciphertext, user.id, factor.id), code, factor.last_used_step);
    if (step === null) continue;
    const updated = await sql`UPDATE account_totp_credentials SET last_used_step=${step},last_used_at=now()
      WHERE id=${factor.id} AND last_used_step<${step} RETURNING id`;
    if (updated.length) return true;
  }
  throw new AppError(403, 'The authenticator code is incorrect, expired, or already used.');
}
async function managementProof(sql, ctx, data) {
  await passwordProof(ctx, data);
  const factors = await accountFactors(sql, ctx.user.id);
  if (ctx.pending) {
    ensure(ctx.pending.scope === 'enrollment' && (!factors.enrolled || ctx.pending.recovery_mode), 403, 'Complete multi-factor sign-in first.');
    return;
  }
  if (!factors.enrolled) return;
  if (data.proof_token) {
    ensure(validToken(data.proof_token), 403, 'Verify an existing factor again.');
    const used = await sql`DELETE FROM account_security_proofs WHERE token_hash=${digest(data.proof_token)} AND user_id=${ctx.user.id}
      AND session_hash=${ctx.hash} AND security_version=${ctx.user.security_version} AND expires_at>now() RETURNING token_hash`;
    ensure(used.length === 1, 403, 'Verify an existing factor again.');
  } else await checkTotp(sql, ctx.user, data.code);
}
async function challenge(sql, ctx, kind, value, payload = {}) {
  const token = randomToken(), expires = new Date(Date.now()+CHALLENGE_SECONDS*1000);
  await sql`DELETE FROM account_security_challenges WHERE user_id=${ctx.user.id} AND (expires_at<=now() OR (context_hash=${ctx.hash} AND kind=${kind}))`;
  await sql`INSERT INTO account_security_challenges(token_hash,user_id,context_hash,security_version,kind,challenge,payload,expires_at)
    VALUES(${digest(token)},${ctx.user.id},${ctx.hash},${ctx.user.security_version},${kind},${value},${sql.json(payload)},${expires})`;
  return { challenge_token: token, expires_at: expires.toISOString() };
}
// Reserve retries outside the verification transaction: a rejected assertion must
// not roll back its own retry budget. Account/credential checks remain inside it.
async function reserveChallenge(tokens, token, kind) {
  ensure(validToken(token), 400, 'The security challenge is invalid or expired.');
  const hash = digest(tokens?.pendingToken || tokens?.sessionToken || '');
  const [row] = await db()`UPDATE account_security_challenges SET attempts=attempts+1 WHERE token_hash=${digest(token)}
    AND context_hash=${hash} AND kind=${kind} AND expires_at>now() AND attempts<${MAX_SECURITY_ATTEMPTS} RETURNING token_hash`;
  ensure(row, 400, 'The security challenge is invalid, expired, or exhausted.');
}
async function takeChallenge(sql, ctx, token, kind) {
  const [row] = await sql`DELETE FROM account_security_challenges WHERE token_hash=${digest(token)} AND user_id=${ctx.user.id}
    AND context_hash=${ctx.hash} AND security_version=${ctx.user.security_version} AND kind=${kind} AND expires_at>now() RETURNING *`;
  ensure(row, 400, 'The security challenge is invalid or expired.');
  return row;
}
async function replaceCodes(sql, userId) {
  const codes = newRecoveryCodes();
  await sql`DELETE FROM account_recovery_codes WHERE user_id=${userId}`;
  for (const code of codes) await sql`INSERT INTO account_recovery_codes(code_hash,user_id) VALUES(${recoveryCodeHash(userId,code)},${userId})`;
  return codes;
}
export async function revokeAccountAuthentication(sql, userId) {
  await sql`DELETE FROM sessions WHERE user_id=${userId}`;
  await sql`DELETE FROM account_pending_auth WHERE user_id=${userId}`;
  await sql`DELETE FROM account_security_challenges WHERE user_id=${userId}`;
  await sql`DELETE FROM account_security_proofs WHERE user_id=${userId}`;
}
async function completeEnrollment(sql, ctx, action, factorId) {
  if (ctx.pending?.recovery_mode) {
    // A recovery event retires every lost/possibly compromised factor, only after
    // its replacement has proved possession. A reset alone never clears factors.
    await sql`DELETE FROM account_totp_credentials WHERE user_id=${ctx.user.id} AND id<>${factorId}`;
    await sql`DELETE FROM account_passkeys WHERE user_id=${ctx.user.id} AND id<>${factorId}`;
  }
  const [user] = await sql`UPDATE app_users SET security_version=security_version+1,mfa_reset_required=false WHERE id=${ctx.user.id} RETURNING *`;
  await revokeAccountAuthentication(sql, user.id);
  const [codes] = await sql`SELECT count(*)::integer AS n FROM account_recovery_codes WHERE user_id=${user.id} AND used_at IS NULL AND (expires_at IS NULL OR expires_at>now())`;
  const recoveryCodes = ctx.pending?.recovery_mode || codes.n === 0 ? await replaceCodes(sql, user.id) : undefined;
  const token = await createAccountSession(sql, user, 'mfa', new Date(), ctx.pending || ctx.session);
  await audit(sql, user.id, action, { factor_id: factorId });
  return { user: publicUser(user), token, ...(recoveryCodes ? { recovery_codes: recoveryCodes } : {}) };
}
export async function beginTotpEnrollment(tokens, input, ip) {
  await limit(tokens, ip); const data = v.object(input);
  return db().begin(async sql => {
    const ctx = await context(sql, tokens); await managementProof(sql, ctx, data);
    const factors = await accountFactors(sql, ctx.user.id); ensure(ctx.pending?.recovery_mode || factors.totp.length < 5, 400, 'At most five authenticator apps can be enrolled.');
    const id = randomUUID(), setup = newTotp(ctx.user.email), label = v.text(data.label || 'Authenticator app', 'Label', 1, 80);
    const state = await challenge(sql, ctx, 'totp-enroll', null, { id, label, ciphertext: encryptTotp(setup.secret, ctx.user.id, id) });
    return { ...state, ...setup };
  });
}
export async function verifyTotpEnrollment(tokens, input, ip) {
  await limit(tokens, ip); const data = v.object(input); await reserveChallenge(tokens, data.challenge_token, 'totp-enroll');
  return db().begin(async sql => {
    const ctx = await context(sql, tokens), state = await takeChallenge(sql, ctx, data.challenge_token, 'totp-enroll');
    const { id, label, ciphertext } = state.payload;
    const step = await verifyTotpSecret(decryptTotp(ciphertext, ctx.user.id, id), data.code);
    ensure(step !== null, 403, 'The authenticator code is incorrect or expired.');
    const factors = await accountFactors(sql, ctx.user.id); ensure(ctx.pending?.recovery_mode || factors.totp.length < 5, 400, 'At most five authenticator apps can be enrolled.');
    await sql`INSERT INTO account_totp_credentials(id,user_id,label,secret_ciphertext,last_used_step,last_used_at)
      VALUES(${id},${ctx.user.id},${label},${ciphertext},${step},now())`;
    return completeEnrollment(sql, ctx, 'auth.totp_enrolled', id);
  });
}
export async function beginPasskeyRegistration(tokens, input, ip) {
  await limit(tokens, ip); const data = v.object(input), rp = webauthnConfiguration(configuration().origin);
  return db().begin(async sql => {
    const ctx = await context(sql, tokens); await managementProof(sql, ctx, data);
    const rows = await sql`SELECT credential_id,transports FROM account_passkeys WHERE user_id=${ctx.user.id}`;
    ensure(ctx.pending?.recovery_mode || rows.length < 10, 400, 'At most ten passkeys can be enrolled.');
    const options = await generateRegistrationOptions({ rpName: rp.rpName, rpID: rp.rpID,
      userID: new Uint8Array(Buffer.from(ctx.user.id)), userName: ctx.user.email, userDisplayName: ctx.user.name,
      attestationType: 'none', authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
      excludeCredentials: rows.map(row => ({ id: row.credential_id, transports: row.transports })), timeout: CHALLENGE_SECONDS*1000 });
    const state = await challenge(sql, ctx, 'passkey-register', options.challenge,
      { label: v.text(data.label || 'Passkey', 'Label', 1, 80), origin: rp.origin, rp_id: rp.rpID });
    return { ...state, options };
  });
}
export async function verifyPasskeyRegistration(tokens, input, ip) {
  await limit(tokens, ip); const data = v.object(input), rp = webauthnConfiguration(configuration().origin);
  await reserveChallenge(tokens, data.challenge_token, 'passkey-register');
  return db().begin(async sql => {
    const ctx = await context(sql, tokens), state = await takeChallenge(sql, ctx, data.challenge_token, 'passkey-register');
    ensure(state.payload.origin === rp.origin && state.payload.rp_id === rp.rpID, 400, 'The passkey configuration changed. Start again.');
    let result;
    try { result = await verifyRegistrationResponse({ response: data.response, expectedChallenge: state.challenge,
      expectedOrigin: rp.origin, expectedRPID: rp.rpID, requireUserVerification: true }); }
    catch { throw new AppError(403, 'The passkey registration could not be verified.'); }
    ensure(result.verified && result.registrationInfo?.userVerified, 403, 'Passkey user verification is required.');
    const info = result.registrationInfo, credential = info.credential;
    const count = await sql`SELECT id FROM account_passkeys WHERE user_id=${ctx.user.id}`;
    ensure(ctx.pending?.recovery_mode || count.length < 10, 400, 'At most ten passkeys can be enrolled.');
    let rows;
    try { rows = await sql`INSERT INTO account_passkeys(user_id,credential_id,public_key,counter,transports,device_type,backed_up,label)
      VALUES(${ctx.user.id},${credential.id},${Buffer.from(credential.publicKey)},${credential.counter},${credential.transports || []},${info.credentialDeviceType},${info.credentialBackedUp},${state.payload.label}) RETURNING id`; }
    catch (error) { if (error.code === '23505') throw new AppError(409, 'This passkey is already registered.'); throw error; }
    return completeEnrollment(sql, ctx, 'auth.passkey_enrolled', rows[0].id);
  });
}
async function reservePending(token) {
  ensure(validToken(token), 401, 'Sign in again.');
  const [row] = await db()`UPDATE account_pending_auth SET attempts=attempts+1 WHERE token_hash=${digest(token)}
    AND expires_at>now() AND attempts<${MAX_SECURITY_ATTEMPTS} RETURNING token_hash`;
  ensure(row, 401, 'This sign-in attempt expired or is exhausted. Sign in again.');
}
async function finishLogin(sql, ctx) {
  ensure(ctx.pending?.scope === 'mfa' && !ctx.user.mfa_reset_required, 403, 'Account recovery requires a new factor before sign-in.');
  const consumed = await sql`DELETE FROM account_pending_auth WHERE token_hash=${ctx.hash}
    AND user_id=${ctx.user.id} AND security_version=${ctx.user.security_version} AND scope='mfa' AND expires_at>now() RETURNING token_hash`;
  ensure(consumed.length === 1, 401, 'This sign-in attempt expired or was cancelled. Sign in again.');
  const token = await createAccountSession(sql, ctx.user, 'mfa', new Date(), ctx.pending);
  await sql`DELETE FROM account_security_challenges WHERE context_hash=${ctx.hash}`;
  await audit(sql, ctx.user.id, 'auth.mfa_login');
  return { user: publicUser(ctx.user), token };
}
export async function verifyTotpLogin(pendingToken, input, ip) {
  const tokens = { pendingToken }; await limit(tokens, ip); const data = v.object(input); await reservePending(pendingToken);
  return db().begin(async sql => {
    const ctx = await context(sql, tokens);
    ensure(ctx.pending.scope === 'mfa' && !ctx.user.mfa_reset_required, 403, 'Use account recovery to enroll a new factor.');
    await checkTotp(sql, ctx.user, data.code); return finishLogin(sql, ctx);
  });
}
export async function beginPasskeyAuthentication(tokens, input, ip) {
  await limit(tokens, ip); const data = v.object(input), rp = webauthnConfiguration(configuration().origin);
  const purpose = data.purpose || (tokens.pendingToken ? 'login' : 'reauth');
  ensure(['login','reauth'].includes(purpose), 400, 'Invalid passkey purpose.');
  return db().begin(async sql => {
    const ctx = await context(sql, tokens, { pending: purpose === 'login' });
    if (purpose === 'login') ensure(ctx.pending?.scope === 'mfa' && !ctx.user.mfa_reset_required, 403, 'Complete account recovery first.');
    else { ensure(ctx.session, 401, 'Sign in again.'); await passwordProof(ctx, data); }
    const rows = await sql`SELECT credential_id,transports FROM account_passkeys WHERE user_id=${ctx.user.id}`;
    ensure(rows.length, 400, 'No passkey is registered for this account.');
    const options = await generateAuthenticationOptions({ rpID: rp.rpID, userVerification: 'required', timeout: CHALLENGE_SECONDS*1000,
      allowCredentials: rows.map(row => ({ id: row.credential_id, transports: row.transports })) });
    return { ...await challenge(sql, ctx, 'passkey-' + purpose, options.challenge, { origin: rp.origin, rp_id: rp.rpID }), options };
  });
}
async function createProof(sql, ctx) {
  const token = randomToken(), expires = new Date(Date.now()+STRONG_AUTH_SECONDS*1000);
  await sql`DELETE FROM account_security_proofs WHERE session_hash=${ctx.hash}`;
  await sql`INSERT INTO account_security_proofs(token_hash,user_id,session_hash,security_version,expires_at)
    VALUES(${digest(token)},${ctx.user.id},${ctx.hash},${ctx.user.security_version},${expires})`;
  await sql`UPDATE sessions SET strong_authenticated_at=now(),auth_strength='mfa' WHERE token_hash=${ctx.hash}`;
  return { proof_token: token, expires_at: expires.toISOString() };
}
export async function verifyPasskeyAuthentication(tokens, input, ip) {
  await limit(tokens, ip); const data = v.object(input), rp = webauthnConfiguration(configuration().origin);
  const purpose = data.purpose || (tokens.pendingToken ? 'login' : 'reauth');
  ensure(['login','reauth'].includes(purpose), 400, 'Invalid passkey purpose.');
  await reserveChallenge(purpose === 'reauth' ? { sessionToken: tokens.sessionToken } : tokens, data.challenge_token, 'passkey-' + purpose);
  if (purpose === 'login') await reservePending(tokens.pendingToken);
  return db().begin(async sql => {
    const ctx = await context(sql, tokens, { pending: purpose === 'login' });
    const state = await takeChallenge(sql, ctx, data.challenge_token, 'passkey-' + purpose);
    ensure(state.payload.origin === rp.origin && state.payload.rp_id === rp.rpID, 400, 'The passkey configuration changed. Start again.');
    ensure(typeof data.response?.id === 'string' && data.response.id.length <= 2048, 400, 'Invalid passkey response.');
    const [factor] = await sql`SELECT * FROM account_passkeys WHERE credential_id=${data.response.id} AND user_id=${ctx.user.id} FOR UPDATE`;
    ensure(factor, 403, 'The passkey could not be verified.');
    const userHandle = data.response.response?.userHandle;
    ensure(userHandle == null || userHandle === Buffer.from(ctx.user.id).toString('base64url'), 403, 'The passkey account does not match.');
    let result;
    try { result = await verifyAuthenticationResponse({ response: data.response, expectedChallenge: state.challenge,
      expectedOrigin: rp.origin, expectedRPID: rp.rpID, requireUserVerification: true,
      credential: { id: factor.credential_id, publicKey: new Uint8Array(factor.public_key), counter: Number(factor.counter), transports: factor.transports } }); }
    catch { throw new AppError(403, 'The passkey could not be verified.'); }
    ensure(result.verified && result.authenticationInfo?.userVerified, 403, 'Passkey user verification is required.');
    const newCounter = result.authenticationInfo.newCounter;
    ensure(Number.isSafeInteger(newCounter) && newCounter >= 0 && (Number(factor.counter) === 0 && newCounter === 0 || newCounter > Number(factor.counter)), 403, 'The passkey counter is invalid.');
    await sql`UPDATE account_passkeys SET counter=${newCounter},last_used_at=now(),backed_up=${result.authenticationInfo.credentialBackedUp}
      WHERE id=${factor.id}`;
    if (purpose === 'login') return finishLogin(sql, ctx);
    return createProof(sql, ctx);
  });
}
export async function reauthenticate(tokens, input, ip) {
  await limit(tokens, ip); const data = v.object(input);
  return db().begin(async sql => {
    const ctx = await context(sql, tokens, { pending: false }); await passwordProof(ctx, data);
    await checkTotp(sql, ctx.user, data.code); return createProof(sql, ctx);
  });
}
export async function redeemRecoveryCode(pendingToken, input, ip) {
  const tokens = { pendingToken }; await limit(tokens, ip); const data = v.object(input); await reservePending(pendingToken);
  ensure(typeof data.code === 'string' && /^[A-Fa-f0-9\s-]{32,80}$/.test(data.code), 403, 'The recovery code is invalid.');
  return db().begin(async sql => {
    const ctx = await context(sql, tokens); ensure(ctx.pending.scope === 'mfa', 403, 'Recovery is not available for this sign-in.');
    // Password was verified to create this short-lived pending login. Require it
    // again to redeem offline codes, so copied pending cookies alone cannot do so.
    await passwordProof(ctx, data);
    const used = await sql`UPDATE account_recovery_codes SET used_at=now() WHERE code_hash=${recoveryCodeHash(ctx.user.id,data.code)}
      AND user_id=${ctx.user.id} AND used_at IS NULL AND (expires_at IS NULL OR expires_at>now()) RETURNING code_hash`;
    ensure(used.length === 1, 403, 'The recovery code is invalid, expired, or already used.');
    const [user] = await sql`UPDATE app_users SET security_version=security_version+1,mfa_reset_required=true WHERE id=${ctx.user.id} RETURNING *`;
    await revokeAccountAuthentication(sql, user.id);
    await audit(sql, user.id, 'auth.recovery_code_redeemed');
    return createPendingAuth(sql, user, 'enrollment', true, ctx.pending);
  });
}
export async function regenerateRecoveryCodes(tokens, input, ip) {
  await limit(tokens, ip); const data = v.object(input);
  return db().begin(async sql => {
    const ctx = await context(sql, tokens, { pending: false }); await managementProof(sql, ctx, data);
    ensure((await accountFactors(sql,ctx.user.id)).enrolled, 400, 'Enroll a factor before generating recovery codes.');
    const codes = await replaceCodes(sql, ctx.user.id); await audit(sql, ctx.user.id, 'auth.recovery_codes_regenerated');
    return { recovery_codes: codes };
  });
}
export async function removeFactor(tokens, input, ip) {
  await limit(tokens, ip); const data = v.object(input), factorId = v.uuid(data.factor_id);
  return db().begin(async sql => {
    const ctx = await context(sql, tokens, { pending: false }); await managementProof(sql, ctx, data);
    const factors = await accountFactors(sql, ctx.user.id), existing = [...factors.totp,...factors.passkeys].find(row => row.id === factorId);
    ensure(existing, 404, 'Factor not found.');
    ensure(factors.totp.length + factors.passkeys.length > 1, 400, 'Add and verify a replacement factor before removing your last factor.');
    await sql`DELETE FROM account_totp_credentials WHERE id=${factorId} AND user_id=${ctx.user.id}`;
    await sql`DELETE FROM account_passkeys WHERE id=${factorId} AND user_id=${ctx.user.id}`;
    const [user] = await sql`UPDATE app_users SET security_version=security_version+1 WHERE id=${ctx.user.id} RETURNING *`;
    await revokeAccountAuthentication(sql,user.id);
    await audit(sql,ctx.user.id,'auth.factor_removed',{ factor_id: factorId });
    return { user: publicUser(user), token: await createAccountSession(sql,user,'mfa',new Date(),ctx.session) };
  });
}
export async function requireRecentStrongAuth(sessionToken, sql = db()) {
  const user = await readFullSession(sessionToken, sql); ensure(user, 401, 'Sign in again.');
  const factors = await accountFactors(sql,user.id);
  // Staged rollout preserves legacy admins until operators explicitly enable it.
  if (!factors.enrolled && !adminMfaRequired() && !user.mfa_reset_required) return publicUser(user);
  ensure(user.auth_strength === 'mfa' && user.strong_authenticated_at &&
    Date.now()-new Date(user.strong_authenticated_at).getTime()<STRONG_AUTH_SECONDS*1000,
  403, 'Verify your password and an existing factor before this sensitive action.', { code: 'STRONG_AUTH_REQUIRED' });
  return publicUser(user);
}

export async function pruneAccountSecurity(sql = db()) {
  await sql`DELETE FROM account_pending_auth WHERE expires_at<=now()`;
  await sql`DELETE FROM account_security_challenges WHERE expires_at<=now()`;
  await sql`DELETE FROM account_security_proofs WHERE expires_at<=now()`;
  await sql`DELETE FROM account_recovery_codes WHERE expires_at<=now()`;
}
