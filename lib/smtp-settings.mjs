import { isIP } from 'node:net';
import { ensure } from './errors.mjs';
import * as v from './validate.mjs';
import { encryptMailCredential, decryptMailCredential } from './email-secrets.mjs';

export const WPMU_SMTP = Object.freeze({ host: 'mailu.wpmudev.host', port: 587, security: 'starttls', rate: 10 });
export function smtpHost(value) {
  const host = v.text(value, 'SMTP hostname', 1, 253).toLowerCase();
  ensure(!isIP(host) && host.includes('.') && host.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) &&
    !['localhost', 'local', 'internal', 'test', 'invalid'].some(suffix => host.endsWith('.' + suffix)), 400, 'Use a public SMTP hostname without a URL, port or IP address.');
  return host;
}
export function smtpPassword(value) {
  ensure(typeof value === 'string' && value.length >= 1 && value.length <= 4096 && !/[\x00-\x1f\x7f]/.test(value), 400, 'Enter a valid SMTP password or provider app password.');
  return value;
}
export function smtpSettingsInput(o, required = true) {
  const smtp_preset = v.oneOf(o.smtp_preset ?? 'custom', 'SMTP service', ['custom', 'wpmu']);
  const host = o.smtp_host ?? '', user = o.smtp_user ?? '';
  const smtp_host = host ? smtpHost(host) : '';
  const smtp_user = user ? v.text(user, 'SMTP username', 1, 320) : '';
  ensure(!/[\x00-\x1f\x7f]/.test(smtp_user), 400, 'SMTP username contains an invalid character.');
  const smtp_security = v.oneOf(o.smtp_security ?? 'starttls', 'SMTP encryption', ['starttls', 'tls']);
  const smtp_port = v.integer(o.smtp_port ?? 587, 'SMTP port', 1, 65535);
  ensure(smtp_port === (smtp_security === 'tls' ? 465 : 587), 400, 'Use port 587 with required STARTTLS or port 465 with TLS.');
  const smtp_rate_limit = v.integer(o.smtp_rate_limit ?? 10, 'Emails per minute', 1, 60);
  if (required) ensure(smtp_host && smtp_user, 400, 'Enter the SMTP hostname and username.');
  if (smtp_preset === 'wpmu' || smtp_host === WPMU_SMTP.host) ensure(smtp_host === WPMU_SMTP.host && smtp_port === WPMU_SMTP.port && smtp_security === WPMU_SMTP.security && smtp_rate_limit <= WPMU_SMTP.rate, 400, 'WPMU DEV Basic Email uses mailu.wpmudev.host, port 587, required STARTTLS and at most 10 emails per minute.');
  return { smtp_preset, smtp_host, smtp_port, smtp_security, smtp_user, smtp_rate_limit };
}
export function smtpCredentialContext(config) {
  const c = smtpSettingsInput(config);
  return 'cardshelf:smtp:v1:password:' + JSON.stringify([c.smtp_host, c.smtp_port, c.smtp_security, c.smtp_user]);
}
export const encryptSmtpSecret = (value, config, env = process.env) => encryptMailCredential(smtpPassword(value), smtpCredentialContext(config), env);
export const decryptSmtpSecret = (value, config, env = process.env) => smtpPassword(decryptMailCredential(value, smtpCredentialContext(config), env));
