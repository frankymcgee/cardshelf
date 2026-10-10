import { randomBytes } from 'node:crypto';
import { verify, generateSecret, generateURI } from 'otplib';
import { encryptMailCredential, decryptMailCredential } from './email-secrets.mjs';
import { digest } from './security.mjs';
import { AppError, ensure } from './errors.mjs';

export const PENDING_SECONDS = 600;
export const CHALLENGE_SECONDS = 300;
export const STRONG_AUTH_SECONDS = 300;
export const MAX_SECURITY_ATTEMPTS = 5;
export function adminMfaRequired(env = process.env) { return env.CARDSHELF_REQUIRE_ADMIN_MFA === 'true'; }
export function recoveryCodeHash(userId, code) {
  return digest('cardshelf-recovery:' + userId + ':' + String(code).toUpperCase().replace(/[\s-]/g, ''));
}
export function newRecoveryCodes() {
  return Array.from({ length: 10 }, () => randomBytes(16).toString('hex').toUpperCase().match(/.{4}/g).join('-'));
}
export function totpContext(userId, credentialId) { return `cardshelf:totp:v1:${userId}:${credentialId}`; }
export function encryptTotp(secret, userId, credentialId, env = process.env) {
  try { return encryptMailCredential(secret, totpContext(userId, credentialId), env); }
  catch { throw new AppError(503, 'Configure the server integration encryption key before adding an authenticator.'); }
}
export function decryptTotp(ciphertext, userId, credentialId, env = process.env) {
  try { return decryptMailCredential(ciphertext, totpContext(userId, credentialId), env); }
  catch { throw new AppError(503, 'The authenticator secret cannot be unlocked. Check the server integration encryption key.'); }
}
export function newTotp(email) {
  const secret = generateSecret();
  return { secret, uri: generateURI({ issuer: 'CardShelf', label: email, secret, algorithm: 'sha1', digits: 6, period: 30 }) };
}
export async function verifyTotpSecret(secret, code, lastStep = -1, epoch = Math.floor(Date.now() / 1000)) {
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) return null;
  const result = await verify({ secret, token: code, epoch, epochTolerance: 30,
    ...(Number(lastStep) >= 0 ? { afterTimeStep: Number(lastStep) } : {}) });
  return result.valid && Number.isSafeInteger(result.timeStep) && result.timeStep > Number(lastStep) ? result.timeStep : null;
}
export function webauthnConfiguration(origin, env = process.env) {
  const parsed = new URL(origin), rpID = env.CARDSHELF_WEBAUTHN_RP_ID || parsed.hostname;
  ensure(parsed.protocol === 'https:' || (parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)),
    503, 'Passkeys require HTTPS, except on localhost.');
  ensure(rpID === parsed.hostname, 503, 'The passkey RP ID must exactly match the APP_ORIGIN hostname.');
  return { origin: parsed.origin, rpID, rpName: 'CardShelf' };
}
export function emailVerified(user) { return !user.email_verification_required || !!user.email_verified_at; }
export function publicUser(user) { return { id: user.id, email: user.email, name: user.name, role: user.role, email_verified_at: user.email_verified_at || null, email_verification_required: !!user.email_verification_required, email_verification_grandfathered_at: user.email_verification_grandfathered_at || null }; }
export function validToken(token) { return typeof token === 'string' && /^[a-f0-9]{64}$/.test(token); }
