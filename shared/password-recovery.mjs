export const RECOVERY_MESSAGE = 'If an account matches that email address, a recovery link will be sent when email delivery is available. Check your inbox and spam folder, or contact your administrator.';
export const RECOVERY_PATHS = Object.freeze(['/forgot-password', '/reset-password']);
export function recoveryPage(path) {
  return typeof path === 'string' && RECOVERY_PATHS.includes(path.replace(/\/+$/, ''));
}
