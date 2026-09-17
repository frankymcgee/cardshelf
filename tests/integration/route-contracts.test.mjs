// Check concrete route/method pairs against the built server, not a router mock.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const base = process.env.TEST_BASE_URL;
if (process.env.ALLOW_TEST_DATABASE !== 'yes' || !base ||
    !new URL(process.env.DATABASE_URL || 'http://invalid').pathname.endsWith('_test')) {
  throw new Error('Use only a disposable _test database.');
}
const origin = process.env.APP_ORIGIN || base;
const listing = '/api/marketplace/listings/' + randomUUID();
for (const [method, path] of [['GET', '/api/binders'], ['GET', listing], ['DELETE', listing]]) {
  await test(`${method} ${path} is a protected JSON API, not a rendered page`, async () => {
    const response = await fetch(base + path, {
      method, redirect: 'manual',
      headers: { Origin: origin, 'X-Requested-With': 'cardshelf',
        ...(method === 'DELETE' ? { 'Content-Type': 'application/json' } : {}) },
      ...(method === 'DELETE' ? { body: JSON.stringify({ revision: 1 }) } : {})
    });
    const text = await response.text();
    assert.equal(response.status, 401, text.slice(0, 500));
    assert.match(response.headers.get('content-type') || '', /application\/json/i);
    assert.equal(JSON.parse(text).statusCode, 401);
    assert.match(response.headers.get('cache-control') || '', /no-store/i);
  });
}
