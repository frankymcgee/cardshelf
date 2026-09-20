import { ensure } from './errors.mjs';
import { db } from './db.mjs';
import { configuration } from './config.mjs';
import { smtpConfiguration, recoveryEmail, recoveryOrigin, mailStatus } from './password-recovery-logic.mjs';
import { emailConfiguration } from './email-settings.mjs';
import { postalSend } from './postal-client.mjs';

export async function recoveryDeliveryStatus(sql = db()) {
  const worker_enabled=process.env.EMAIL_WORKER_ENABLED!=='false';
  try {
    recoveryOrigin(configuration().origin);
    const postal = await emailConfiguration(sql);
    if (postal.exists) return { provider: 'postal', worker_enabled, enabled: postal.enabled, configured: postal.enabled && postal.configured,
      message: postal.enabled && postal.configured ? 'Postal is configured. Accepted messages still require delivery confirmation.' : postal.enabled ? 'Postal configuration is incomplete or invalid.' : 'Email delivery is disabled in Emails settings.' };
    return { ...mailStatus(), provider: 'smtp', worker_enabled };
  } catch { return { provider: 'postal', worker_enabled, enabled: false, configured: false, message: 'Email settings are unavailable or invalid. Delivery is paused.' }; }
}
export async function suppressedEmail(email, sql = db()) {
  const address=recoveryEmail(email);
  return (await sql`SELECT email FROM email_suppressions WHERE email=${address} LIMIT 1`).length>0;
}
export async function sendRecoveryEmail(email, message, options = {}) {
  const address = recoveryEmail(email);
  if(await suppressedEmail(address))throw Object.assign(new Error('Recipient is suppressed.'),{emailCode:'RECIPIENT_SUPPRESSED'});
  const postal = await emailConfiguration();
  if (postal.exists) {
    ensure(postal.enabled && postal.configured, 503, 'Email delivery is disabled or incomplete.');
    try { return {provider:'postal',...await postalSend(postal,address,message,options)}; }
    catch(error) { error.emailProvider='postal';throw error; }
  }
  const config = smtpConfiguration();
  ensure(config.enabled, 503, 'Recovery email is disabled.');
  const { default: nodemailer } = await import('nodemailer');
  const transport = nodemailer.createTransport(config.transport);
  try {
    const result = await transport.sendMail({ from: { name: 'CardShelf', address: config.from },
      to: { address }, subject: message.subject, text: message.text,
      ...(options.messageId ? {messageId:options.messageId} : {}),
      disableFileAccess: true, disableUrlAccess: true });
    ensure(result.accepted?.some(value => String(value).toLowerCase() === address), 503, 'SMTP did not accept the recipient.');
    return {provider:'smtp',provider_id:null,message_id:result.messageId || options.messageId || null};
  } finally { transport.close(); }
}
