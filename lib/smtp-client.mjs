import { Resolver } from 'node:dns/promises';
import { connect, isIP } from 'node:net';
import { AppError, ensure } from './errors.mjs';
import { recoveryEmail, recoveryOrigin } from './password-recovery-logic.mjs';
import { smtpSettingsInput, smtpPassword } from './smtp-settings.mjs';
import { emailHeader, senderAddress } from './email-settings.mjs';
import { SMTP_FAILURE_MESSAGES, smtpFailureCode } from './smtp-errors.mjs';

// Do not let an administrator-entered DNS name send credentials to a local
// service or metadata endpoint. Resolve once, validate every answer and pin the
// socket to that address while validating TLS against the original hostname.
export function publicSmtpAddress(address) {
  if (isIP(address) === 4) {
    const n = address.split('.').reduce((value, octet) => value * 256 + Number(octet), 0);
    return ![[0,8],[0x0a000000,8],[0x64400000,10],[0x7f000000,8],[0xa9fe0000,16],[0xac100000,12],
      [0xc0000000,24],[0xc0000200,24],[0xc0586300,24],[0xc0a80000,16],[0xc6120000,15],[0xc6336400,24],[0xcb007100,24],[0xe0000000,3]]
      .some(([base, bits]) => Math.floor(n / 2 ** (32 - bits)) === Math.floor(base / 2 ** (32 - bits)));
  }
  if (isIP(address) !== 6 || address.includes('.')) return false;
  const halves = address.toLowerCase().split('::'), left = halves[0] ? halves[0].split(':') : [], right = halves[1] ? halves[1].split(':') : [];
  const words = halves.length === 1 ? left : [...left, ...Array(8 - left.length - right.length).fill('0'), ...right];
  const n = words.reduce((value, word) => (value << 16n) + BigInt('0x' + word), 0n);
  const prefix = (base, bits) => n >> BigInt(128 - bits) === BigInt('0x' + base.padEnd(32, '0')) >> BigInt(128 - bits);
  return prefix('2000', 3) && !prefix('2001', 23) && !prefix('20010db8', 32) && !prefix('2002', 16) && !prefix('3fff', 20);
}
export async function smtpDestination(host, resolver = new Resolver({ timeout: 2500, tries: 1 })) {
  const results = await Promise.allSettled([resolver.resolve4(host), resolver.resolve6(host)]);
  const addresses = results.flatMap(result => result.status === 'fulfilled' && Array.isArray(result.value) ? result.value : []);
  if (!addresses.length) throw Object.assign(new AppError(503, 'SMTP must resolve only to public addresses. Check the provider hostname and DNS.'), { emailCode: 'SMTP_DNS_FAILED' });
  if (addresses.length > 32 || !addresses.every(publicSmtpAddress)) throw Object.assign(new AppError(503, 'SMTP must resolve only to public addresses. Check the provider hostname and DNS.'), { emailCode: 'SMTP_DESTINATION_BLOCKED' });
  return addresses.find(address => isIP(address) === 4) || addresses[0];
}
export function smtpDeliveryFailure(error) {
  if (error?.emailDelivery === 'not_sent') return 'not_sent';
  if (['EAUTH', 'EDNS', 'ETLS', 'EENVELOPE'].includes(error?.code) || Number.isInteger(error?.responseCode) && error.responseCode >= 400 && error.responseCode <= 599) return 'rejected';
  return 'uncertain';
}
async function withSmtpTransport(config, operation, { resolver, createTransport, connectSocket = connect, env = process.env } = {}) {
  let transport, socket, deadline, stage = 'configuration';
  try {
    ensure(env.NODE_TLS_REJECT_UNAUTHORIZED !== '0', 503, 'SMTP certificate verification must remain enabled.');
    const c = smtpSettingsInput(config), pass = smtpPassword(config.smtp_password);
    const origin = recoveryOrigin(env.APP_ORIGIN || 'https://cardshelf.cloud');
    stage = 'dns';
    const address = await smtpDestination(c.smtp_host, resolver);
    stage = 'initialization';
    const factory = createTransport || (await import('nodemailer')).default.createTransport;
    transport = factory({ host: address, port: c.smtp_port, secure: c.smtp_security === 'tls', requireTLS: true,
      ignoreTLS: false, opportunisticTLS: false, auth: { user: c.smtp_user, pass },
      tls: { servername: c.smtp_host, rejectUnauthorized: true, minVersion: 'TLSv1.2' }, name: new URL(origin).hostname,
      connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000, dnsTimeout: 3000,
      disableFileAccess: true, disableUrlAccess: true, pool: false, logger: false, debug: false, transactionLog: false,
      getSocket(_options, callback) {
        socket = connectSocket({ host: address, port: c.smtp_port });
        let returned = false;
        const finish = (error) => { if (returned) return; returned = true; if(error)error.emailDelivery='not_sent'; callback(error, error ? undefined : { connection: socket }); };
        socket.once('connect', () => finish(null)); socket.once('error', finish);
      }
    });
    stage = 'transport';
    return await Promise.race([operation(transport), new Promise((_, reject) => {
      deadline = setTimeout(() => { socket?.destroy(); reject(Object.assign(new Error('SMTP deadline'), { code: 'ETIMEDOUT' })); }, 30000);
      deadline.unref?.();
    })]);
  } catch (error) {
    const code = smtpFailureCode(error, stage);
    const safe = new AppError(502, '[' + code + '] ' + SMTP_FAILURE_MESSAGES[code]);
    safe.emailCode = code;
    safe.emailProvider = 'smtp'; safe.emailDelivery = transport ? smtpDeliveryFailure(error) : 'not_sent';
    throw safe;
  } finally { clearTimeout(deadline); socket?.destroy(); transport?.close(); }
}
export async function smtpVerify(config, options = {}) {
  ensure(config?.provider === 'smtp' && config.configured, 409, 'Save a complete SMTP connection before checking it.');
  await withSmtpTransport(config, async transport => { ensure(await transport.verify() === true, 502, 'SMTP did not confirm connection verification.'); }, options);
  return { verified: true };
}
export async function smtpSend(config, email, message, options = {}) {
  ensure(config?.provider === 'smtp' && config.enabled && config.configured, 503, 'SMTP email is disabled or not configured.');
  const recipient = recoveryEmail(email), from = senderAddress(config.from_address), name = emailHeader(config.sender_name, 'Sender name', 80);
  const subject = emailHeader(message?.subject, 'Email subject', 200);
  ensure(typeof message?.text === 'string' && message.text.length > 0 && message.text.length <= 60000 && !message.text.includes('\0'), 400, 'Email text is invalid.');
  ensure(typeof options.messageId === 'string' && /^<[a-zA-Z0-9.@_-]{1,253}>$/.test(options.messageId), 400, 'Email message identifier is required.');
  return withSmtpTransport(config, async transport => {
    const result = await transport.sendMail({ from: { name, address: from }, to: { address: recipient },
      ...(config.reply_to ? { replyTo: { address: senderAddress(config.reply_to) } } : {}), subject, text: message.text,
      messageId: options.messageId, disableFileAccess: true, disableUrlAccess: true });
    if (!result.accepted?.some(value => String(value).toLowerCase() === recipient)) throw Object.assign(new Error('Recipient not accepted'), { code: 'EENVELOPE' });
    return { provider: 'smtp', provider_id: null, message_id: options.messageId };
  }, options);
}
