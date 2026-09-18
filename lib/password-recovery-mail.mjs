import { ensure } from './errors.mjs';
import { smtpConfiguration, recoveryEmail } from './password-recovery-logic.mjs';
export async function sendRecoveryEmail(email, message) {
  const config = smtpConfiguration();
  ensure(config.enabled, 503, 'Recovery email is disabled.');
  const address = recoveryEmail(email);
  const { default: nodemailer } = await import('nodemailer');
  const transport = nodemailer.createTransport(config.transport);
  try {
    const result = await transport.sendMail({ from: { name: 'CardShelf', address: config.from },
      to: { address }, subject: message.subject, text: message.text,
      disableFileAccess: true, disableUrlAccess: true });
    ensure(result.accepted?.some(value => String(value).toLowerCase() === address), 503, 'SMTP did not accept the recipient.');
  } finally { transport.close(); }
}
