// Only fixed, application-authored diagnostics may reach history or clients.
// Never persist a provider response, credential, address or exception message.
export const SMTP_FAILURE_MESSAGES = Object.freeze({
  SMTP_CONFIG_FAILED: 'SMTP configuration is incomplete or invalid. Check the saved hostname, encryption and account.',
  SMTP_DNS_FAILED: 'The application could not resolve the SMTP hostname. Check the hostname and the application container DNS.',
  SMTP_DESTINATION_BLOCKED: 'The SMTP hostname did not resolve exclusively to allowed public addresses. Check the provider hostname and DNS.',
  SMTP_CONNECT_FAILED: 'The SMTP connection failed or was interrupted. Check the outgoing port, host firewall and provider availability.',
  SMTP_TLS_FAILED: 'SMTP encryption or certificate verification failed. Check the hostname and TLS/port pair; do not disable certificate verification.',
  SMTP_AUTH_FAILED: 'The SMTP service rejected authentication. Check the full mailbox username, mailbox/app password and account status.',
  SMTP_TIMEOUT: 'The SMTP connection timed out. Check outbound connectivity and provider availability.',
  SMTP_REJECTED: 'The SMTP service rejected the request. Check the authorized sender, recipient and provider sending quota.',
  SMTP_TRANSPORT_FAILED: 'The SMTP transport could not start. Check the installed image and its mail dependency.',
  SMTP_DELIVERY_FAILED: 'SMTP could not confirm the request. Check the connection settings and provider status.'
});
export function smtpFailureCode(error, stage = 'transport') {
  if (typeof error?.emailCode === 'string' && Object.hasOwn(SMTP_FAILURE_MESSAGES, error.emailCode)) return error.emailCode;
  const codes = [error?.code, error?.cause?.code];
  if (codes.includes('EAUTH')) return 'SMTP_AUTH_FAILED';
  // Nodemailer can replace a native certificate error's code with ESOCKET.
  // Recognize only fixed TLS phrases; never copy the message into the result.
  if (codes.includes('ESOCKET') && typeof error?.message === 'string' && /self[- ]signed certificate|certificate (?:has expired|is not yet valid)|unable to verify (?:the first certificate|leaf signature)|unable to get local issuer certificate|hostname\/ip does not match certificate|wrong version number/i.test(error.message.slice(0,4096))) return 'SMTP_TLS_FAILED';
  if (codes.some(code => ['ETLS','ERR_TLS_CERT_ALTNAME_INVALID','CERT_HAS_EXPIRED','CERT_NOT_YET_VALID','DEPTH_ZERO_SELF_SIGNED_CERT','SELF_SIGNED_CERT_IN_CHAIN','UNABLE_TO_VERIFY_LEAF_SIGNATURE','UNABLE_TO_GET_ISSUER_CERT_LOCALLY','ERR_SSL_WRONG_VERSION_NUMBER'].includes(code))) return 'SMTP_TLS_FAILED';
  if (codes.some(code => ['EDNS','ENOTFOUND','EAI_AGAIN'].includes(code))) return 'SMTP_DNS_FAILED';
  if (codes.some(code => ['ECONNECTION','ECONNREFUSED','EHOSTUNREACH','ENETUNREACH'].includes(code))) return 'SMTP_CONNECT_FAILED';
  if (codes.includes('ETIMEDOUT')) return 'SMTP_TIMEOUT';
  if (codes.includes('EENVELOPE') || Number.isInteger(error?.responseCode) && error.responseCode >= 400 && error.responseCode <= 599) return 'SMTP_REJECTED';
  return stage === 'configuration' ? 'SMTP_CONFIG_FAILED' : stage === 'dns' ? 'SMTP_DNS_FAILED' : stage === 'initialization' ? 'SMTP_TRANSPORT_FAILED' : 'SMTP_DELIVERY_FAILED';
}
export function smtpHistoryCode(error) {
  return error?.emailProvider === 'smtp' ? typeof error.emailCode === 'string' && Object.hasOwn(SMTP_FAILURE_MESSAGES, error.emailCode) ? error.emailCode : 'SMTP_DELIVERY_FAILED' : null;
}
