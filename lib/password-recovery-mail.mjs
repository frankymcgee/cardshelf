import { ensure } from './errors.mjs';
import { db } from './db.mjs';
import { configuration } from './config.mjs';
import { smtpConfiguration, recoveryEmail, recoveryOrigin, mailStatus } from './password-recovery-logic.mjs';
import { emailConfiguration } from './email-settings.mjs';
import { smtpSend } from './smtp-client.mjs';

export async function deliveryConfiguration(sql = db()) {
  recoveryOrigin(configuration().origin);
  const config = await emailConfiguration(sql);
  if (config.exists) return config;
  const legacy = smtpConfiguration();
  return { exists:false,provider:'smtp',enabled:legacy.enabled,configured:legacy.enabled,legacy };
}

export async function recoveryDeliveryStatus(sql = db()) {
  const worker_enabled=process.env.EMAIL_WORKER_ENABLED!=='false';
  try {
    recoveryOrigin(configuration().origin);
    const config = await emailConfiguration(sql),name='SMTP';
    if (config.exists) return { provider: config.provider, worker_enabled, enabled: config.enabled, configured: config.enabled && config.configured,
      message: config.enabled && config.configured ? name+' is configured. Accepted messages still require delivery confirmation.' : config.enabled ? name+' configuration is incomplete or invalid.' : 'Email delivery is disabled in Emails settings.' };
    return { ...mailStatus(), provider: 'smtp', worker_enabled };
  } catch { return { provider: 'smtp', worker_enabled, enabled: false, configured: false, message: 'Email settings are unavailable or invalid. Delivery is paused.' }; }
}
export async function suppressedEmail(email, sql = db()) {
  const address=recoveryEmail(email);
  return (await sql`SELECT email FROM email_suppressions WHERE email=${address} LIMIT 1`).length>0;
}
export async function sendRecoveryEmail(email, message, options = {}) {
  const address = recoveryEmail(email);
  if(await suppressedEmail(address))throw Object.assign(new Error('Recipient is suppressed.'),{emailCode:'RECIPIENT_SUPPRESSED'});
  const config = options.configuration || await deliveryConfiguration();
  if (config.exists) {
    ensure(config.enabled && config.configured, 503, 'Email delivery is disabled or incomplete.');
    ensure(config.provider==='smtp',503,'Unsupported email provider.');
    return smtpSend(config,address,message,options);
  }
  const legacy = config.legacy || smtpConfiguration();
  ensure(legacy.enabled, 503, 'Recovery email is disabled.');
  const { default: nodemailer } = await import('nodemailer');
  const transport = nodemailer.createTransport(legacy.transport);
  try {
    const result = await transport.sendMail({ from: { name: 'CardShelf', address: legacy.from },
      to: { address }, subject: message.subject, text: message.text,
      ...(options.messageId ? {messageId:options.messageId} : {}),
      disableFileAccess: true, disableUrlAccess: true });
    ensure(result.accepted?.some(value => String(value).toLowerCase() === address), 503, 'SMTP did not accept the recipient.');
    return {provider:'smtp',provider_id:null,message_id:result.messageId || options.messageId || null};
  } catch(error) {const {smtpDeliveryFailure}=await import('./smtp-client.mjs');error.emailProvider='smtp';error.emailDelivery=smtpDeliveryFailure(error);throw error;}
  finally { transport.close(); }
}
