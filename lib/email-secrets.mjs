import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { AppError, ensure } from './errors.mjs';

function encryptionKey(env) {
  ensure(/^[a-f0-9]{64}$/i.test(env.CARDSHELF_INTEGRATION_KEY || ''), 503, 'Prepare CARDSHELF_INTEGRATION_KEY on the server before saving an email credential.');
  return Buffer.from(env.CARDSHELF_INTEGRATION_KEY, 'hex');
}
export function encryptMailCredential(value, context, env = process.env) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', encryptionKey(env), iv);
  cipher.setAAD(Buffer.from(context));
  const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join('.');
}
export function decryptMailCredential(value, context, env = process.env) {
  try {
    const [version, iv, tag, data, extra] = String(value).split('.');
    ensure(version === 'v1' && !extra && Buffer.from(iv, 'base64').length === 12 && Buffer.from(tag, 'base64').length === 16, 503, 'Invalid encrypted credential.');
    const cipher = createDecipheriv('aes-256-gcm', encryptionKey(env), Buffer.from(iv, 'base64'));
    cipher.setAAD(Buffer.from(context)); cipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([cipher.update(Buffer.from(data, 'base64')), cipher.final()]).toString('utf8');
  } catch { throw new AppError(503, 'Email credentials cannot be unlocked. Check the server encryption key and saved connection.'); }
}
