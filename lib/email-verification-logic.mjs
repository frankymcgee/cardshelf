import { ensure } from './errors.mjs';
import { object } from './validate.mjs';
import { digest } from './security.mjs';
import { recoveryEmail, recoveryOrigin } from './password-recovery-logic.mjs';

export const VERIFICATION_HOURS = 24;
export const VERIFICATION_MESSAGE = 'If an unverified account matches that email, a verification link will be sent when email delivery is available.';
export const VERIFICATION_ERROR = 'This verification link or password is invalid, or the link has expired. Request a new link if needed.';
function fields(input, allowed) {
  const data = object(input);
  ensure(Object.keys(data).every(key => allowed.includes(key)), 400, 'Unsupported email verification field.');
  return data;
}
export function verificationRequestInput(input) {
  const data = fields(input, ['email']);
  return {email: recoveryEmail(data.email)};
}
export function verificationCompleteInput(input) {
  const data = fields(input, ['token', 'password']);
  ensure(typeof data.token === 'string' && /^[a-f0-9]{64}$/.test(data.token), 400, VERIFICATION_ERROR);
  ensure(typeof data.password === 'string' && data.password.length >= 1 && data.password.length <= 128, 400, VERIFICATION_ERROR);
  return {token: data.token, password: data.password};
}
export function verificationLink(origin, token) {
  ensure(typeof token === 'string' && /^[a-f0-9]{64}$/.test(token), 400, VERIFICATION_ERROR);
  // Browser fragments are not sent to the server or in Referer headers.
  return recoveryOrigin(origin) + '/verify-email#token=' + token;
}
export function verificationTokenIsCurrent(token, user, now = Date.now()) {
  return !!token && !!user && token.user_id === user.id && !token.consumed_at && !user.email_verified_at &&
    Number.isFinite(Date.parse(token.expires_at)) && Date.parse(token.expires_at) > now &&
    token.email === String(user.email).toLowerCase() && token.password_fingerprint === digest(user.password_hash) &&
    String(token.security_version) === String(user.security_version);
}
export function verificationMail(origin, link) {
  const site = recoveryOrigin(origin);
  ensure(typeof link === 'string' && link.startsWith(site + '/verify-email#token=') &&
    /^[a-f0-9]{64}$/.test(link.slice((site + '/verify-email#token=').length)), 400, 'Invalid verification email link.');
  return {subject: 'Verify your CardShelf email address',
    text: `Confirm the email address for your CardShelf account:\n${link}\n\nThis one-time link expires in ${VERIFICATION_HOURS} hours. Open it and enter your current CardShelf password to confirm. Opening this email or link alone does not verify the account.\n\nIf you did not create this account or request verification, ignore this email. Never send your password to anyone.\n\nCardShelf: ${site}`};
}
