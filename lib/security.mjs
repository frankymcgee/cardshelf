import { randomBytes, createHash, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(scryptCallback);
const PARAMETERS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
export function randomToken() { return randomBytes(32).toString('hex'); }
export function digest(value) { return createHash('sha256').update(String(value)).digest('hex'); }
export function safeEqual(a, b) {
  return timingSafeEqual(Buffer.from(digest(a)), Buffer.from(digest(b)));
}
export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const key = await scrypt(password, salt, 64, PARAMETERS);
  return `scrypt-v1$${salt}$${key.toString('hex')}`;
}
export async function verifyPassword(password, encoded) {
  if (typeof password !== 'string' || password.length > 128 || typeof encoded !== 'string') return false;
  const [version, salt, hex, extra] = encoded.split('$');
  if (version !== 'scrypt-v1' || extra || !/^[0-9a-f]{32}$/.test(salt ?? '') || !/^[0-9a-f]{128}$/.test(hex ?? '')) return false;
  const key = await scrypt(password, salt, 64, PARAMETERS);
  return timingSafeEqual(key, Buffer.from(hex, 'hex'));
}
export function isAllowedMutation({ origin, expectedOrigin, requestedWith, fetchSite }) {
  return origin === expectedOrigin && requestedWith === 'cardshelf' && fetchSite !== 'cross-site';
}
