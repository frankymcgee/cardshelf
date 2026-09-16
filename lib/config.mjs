export function configuration() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required.');
  const origin = new URL(process.env.APP_ORIGIN || 'http://localhost:3000');
  if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash)
    throw new Error('APP_ORIGIN must be an HTTP(S) origin without a path.');
  return { databaseUrl, origin: origin.origin, secureCookies: origin.protocol === 'https:',
    bootstrapToken: process.env.BOOTSTRAP_TOKEN || '', trustProxy: process.env.TRUST_PROXY === 'true',
    requestInterval: Math.max(100, Math.min(10000, Number(process.env.CATALOGUE_REQUEST_INTERVAL_MS) || 300)),
    sessionSeconds: 30 * 24 * 60 * 60 };
}
