import { isIP } from 'node:net';
import { ensure } from './errors.mjs';
import * as v from './validate.mjs';
import { digest } from './security.mjs';
export const RESET_MINUTES = 30;
export const RESET_ERROR = 'This reset link is invalid or has expired. Request a new link.';
function fields(input, allowed) {
  const o = v.object(input);
  ensure(Object.keys(o).every(k => allowed.includes(k)), 400, 'Unsupported password recovery field.');
  return o;
}
export function recoveryEmail(value) {
  const email = v.email(value);
  // A single mailbox, not an RFC address-list, header or display name.
  ensure(!/[<>,;:"\\\x00-\x20\x7f]/.test(email), 400, 'Enter a single valid email address.');
  return email;
}
export function recoveryRequestInput(input) {
  const o = fields(input, ['email']);
  return { email: recoveryEmail(o.email) };
}
export function recoveryCompleteInput(input) {
  const o = fields(input, ['token', 'password', 'confirm_password']);
  ensure(typeof o.token === 'string' && /^[a-f0-9]{64}$/.test(o.token), 400, RESET_ERROR);
  const password = v.password(o.password);
  ensure(password === o.confirm_password, 400, 'The new passwords do not match.');
  return { token: o.token, password };
}
export function administratorRecoveryInput(input) {
  const o = fields(input, ['user_id', 'delivery', 'password', 'reason', 'confirm_identity']);
  const delivery = v.oneOf(o.delivery, 'Delivery', ['email', 'link']);
  ensure(typeof o.password === 'string' && o.password.length >= 1 && o.password.length <= 128, 400, 'Confirm your current administrator password.');
  if (delivery === 'link') ensure(o.confirm_identity === true, 400, 'Confirm the recipient identity and secure delivery of this one-time link.');
  return { user_id: v.uuid(o.user_id), delivery, password: o.password, reason: v.text(o.reason, 'Reason', 5, 500) };
}
export function recoveryOrigin(value) {
  let url;
  try { url = new URL(value); } catch { ensure(false, 503, 'Configure a valid APP_ORIGIN before password recovery.'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  ensure((url.protocol === 'https:' || (url.protocol === 'http:' && local)) && !url.username && !url.password &&
    url.pathname === '/' && !url.search && !url.hash, 503, 'Password recovery requires an HTTPS APP_ORIGIN (HTTP is allowed only for local testing).');
  return url.origin;
}
export function resetLink(origin, token) {
  ensure(typeof token === 'string' && /^[a-f0-9]{64}$/.test(token), 400, RESET_ERROR);
  // The fragment is never sent in the initial HTTP request or Referer header.
  return recoveryOrigin(origin) + '/reset-password#token=' + token;
}
export function credentialFingerprint(passwordHash) { return digest(passwordHash); }
export function tokenIsCurrent(token, user, now = Date.now()) {
  return !!token && !!user && token.user_id === user.id && !token.consumed_at &&
    Number.isFinite(Date.parse(token.expires_at)) && Date.parse(token.expires_at) > now &&
    token.password_fingerprint === credentialFingerprint(user.password_hash);
}
export function smtpConfiguration(env = process.env) {
  const enabled = env.RECOVERY_EMAIL_ENABLED === 'true';
  if (!enabled) return { enabled: false };
  const origin = recoveryOrigin(env.APP_ORIGIN || 'http://localhost:3000');
  const host = String(env.SMTP_HOST || '').trim();
  ensure(host.length > 0 && host.length <= 253 && (isIP(host) || /^[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(host)), 503, 'Configure SMTP_HOST.');
  const security = env.SMTP_SECURITY || 'starttls';
  ensure(['starttls', 'tls'].includes(security), 503, 'SMTP_SECURITY must be starttls or tls.');
  const portText = String(env.SMTP_PORT || (security === 'tls' ? '465' : '587'));
  ensure(/^\d{1,5}$/.test(portText) && Number(portText) > 0 && Number(portText) <= 65535, 503, 'Configure a valid SMTP_PORT.');
  const user = String(env.SMTP_USER || ''), pass = String(env.SMTP_PASSWORD || '');
  ensure((user.length > 0) === (pass.length > 0) && user.length <= 320 && pass.length <= 4096 && !/[\r\n\0]/.test(user + pass), 503, 'Configure both SMTP_USER and SMTP_PASSWORD, or neither for a trusted TLS relay.');
  const from = recoveryEmail(env.SMTP_FROM || '');
  return { enabled: true, origin, from, transport: { host, port: Number(portText), secure: security === 'tls',
    requireTLS: true, ignoreTLS: false, opportunisticTLS: false, tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' },
    ...(user ? { auth: { user, pass } } : {}), name: new URL(origin).hostname,
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000,
    disableFileAccess: true, disableUrlAccess: true, logger: false, debug: false } };
}
export function mailStatus(env = process.env) {
  try { const config = smtpConfiguration(env); return { enabled: config.enabled, configured: config.enabled, message: config.enabled ? 'SMTP is configured. Send a test email to check delivery.' : 'Recovery email is disabled. Administrators can still generate secure reset links.' }; }
  catch { return { enabled: env.RECOVERY_EMAIL_ENABLED === 'true', configured: false, message: 'Recovery email configuration is incomplete or invalid. Review the server SMTP settings.' }; }
}
export function recoveryMail(kind, origin, link = '') {
  const site = recoveryOrigin(origin);
  if (kind === 'reset') {
    ensure(link.startsWith(site + '/reset-password#token=') && /^[a-f0-9]{64}$/.test(link.split('#token=')[1] || ''), 400, 'Invalid reset email link.');
    return { subject: 'Reset your CardShelf password', text: `A password reset was requested for your CardShelf account.\n\nOpen this one-time link and choose a new password:\n${link}\n\nThe link expires in ${RESET_MINUTES} minutes. Your password is unchanged until you submit the form. If you did not request this, ignore this email. Never send your password to anyone.\n\nCardShelf: ${site}` };
  }
  ensure(['changed', 'test'].includes(kind), 400, 'Unsupported recovery email.');
  return kind === 'changed' ? { subject: 'Your CardShelf password was changed', text: `Your CardShelf password has been reset. All existing sessions and reset links were invalidated.\n\nIf this was not you, contact your administrator immediately and recover the account at ${site}/forgot-password.\n\nNo password is included in this email.` } :
    { subject: 'CardShelf recovery email test', text: `This is the administrator-requested delivery test for ${site}. No password or account access has changed.` };
}
