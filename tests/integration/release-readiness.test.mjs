import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import release from '../../package.json' with { type: 'json' };
import { hashPassword, randomToken, digest } from '../../lib/security.mjs';
const base = process.env.TEST_BASE_URL, database = process.env.DATABASE_URL;
const local = value => ['localhost', '127.0.0.1'].includes(new URL(value).hostname);
if (process.env.ALLOW_TEST_DATABASE !== 'yes' || !base || !database || !local(base) || !local(database) || !new URL(database).pathname.endsWith('_test')) throw Error('Use only a disposable localhost _test installation.');
const sql = postgres(database, { max: 2 });
async function get(path, cookie) {
  return fetch(base + path, { redirect: 'manual', headers: cookie ? { Cookie: cookie } : {} });
}
await test('release readiness authorization, privacy and read-only operation', async t => {
  const ids = [], password = 'Disposable release inspection password 123';
  try {
    const hash = await hashPassword(password);
    async function account(role) {
      const id = randomUUID(), token = randomToken(); ids.push(id);
      await sql`INSERT INTO app_users(id,name,email,password_hash,role) VALUES(${id},'Release inspection',${id + '@example.test'},${hash},${role})`;
      await sql`INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(${digest(token)},${id},now()+interval '1 hour')`;
      return 'cardshelf_session=' + token;
    }
    const admin = await account('admin'), member = await account('user');
    await t.test('anonymous and ordinary members cannot read the operation report', async () => {
      for (const [cookie, expected] of [[null, 401], [member, 403]]) {
        const response = await get('/api/admin/readiness', cookie);
        assert.equal(response.status, expected);
        assert.match(response.headers.get('content-type'), /json/);
        assert.match(response.headers.get('cache-control'), /no-store/);
      }
    });
    await t.test('administrator reads derived checks without credentials or mutations', async () => {
      async function counts() { return (await sql`SELECT (SELECT count(*)::integer FROM audit_log) AS audit, (SELECT count(*)::integer FROM app_users) AS users, (SELECT count(*)::integer FROM email_outbox) AS email, (SELECT count(*)::integer FROM push_identity) AS push_identity, (SELECT count(*)::integer FROM push_outbox) AS push`)[0]; }
      const before = await counts(), response = await get('/api/admin/readiness', admin), data = await response.json();
      assert.equal(response.status, 200, JSON.stringify(data));
      assert.equal(data.version, release.version);
      assert.match(response.headers.get('cache-control'), /private, no-store/);
      assert.match(response.headers.get('vary'), /Cookie/);
      assert.deepEqual(Object.keys(data).sort(), ['acceptance', 'checked_at', 'checks', 'status', 'version']);
      assert.equal(data.checks.length, 17); assert.equal(data.acceptance.length, 6);
      assert.ok(data.checks.every(check => ['pass', 'review', 'blocked'].includes(check.status)));
      assert.ok(data.checks.every(check => check.to.startsWith('/') && !check.to.startsWith('//')));
      assert.equal(data.checks.find(check => check.id === 'schema').status, 'pass');
      const text = JSON.stringify(data);
      for (const secret of [password, hash, 'password_hash', 'api_secret', 'private_key', 'example.test', admin.split('=')[1]]) assert.ok(!text.includes(secret), secret.slice(0, 15));
      assert.deepEqual(await counts(), before, 'readiness must not write settings, create keys, send email or enqueue push');
    });
    await t.test('server operation status reports the installed release version', async () => {
      const response = await get('/api/admin/status', admin); assert.equal(response.status, 200);
      assert.equal((await response.json()).version, release.version);
    });
    await t.test('contact is public, canonical and does not expose a session identity', async () => {
      const response = await get('/contact', admin), html = await response.text();
      assert.equal(response.status, 200); assert.match(response.headers.get('x-robots-tag'), /index, follow/);
      assert.match(html, /Let’s make an introduction/); assert.match(html, /canonical[^>]*\/contact/);
      assert.ok(!html.includes('Release inspection'));
      for (const path of ['/', '/features', '/pricing', '/privacy']) {
        const result = await get(path); assert.equal(result.status, 200);
        assert.doesNotMatch(await result.text(), /IN PRIVATE BETA|Request early access|Request testing access|how this beta|implemented beta/);
      }
    });
    await t.test('legacy access links retain safe purposes without carrying arbitrary parameters', async () => {
      for (const purpose of ['early_access', 'support', 'privacy']) {
        const response = await get('/early-access?purpose=' + purpose + '&next=https://evil.test');
        assert.equal(response.status, 301);
        const destination = new URL(response.headers.get('location'), base);
        assert.equal(destination.origin, new URL(base).origin); assert.equal(destination.pathname, '/contact');
        assert.equal(destination.searchParams.get('purpose'), purpose); assert.equal(destination.searchParams.get('next'), null);
      }
      const response = await get('/early-access?purpose=unexpected'); assert.equal(response.status, 301);
      assert.equal(new URL(response.headers.get('location'), base).search, '');
      const sitemap = await get('/sitemap.xml'); const xml = await sitemap.text();
      assert.match(xml, /\/contact<\/loc>/); assert.doesNotMatch(xml, /\/early-access<\/loc>/);
    });
  } finally { if (ids.length) await sql`DELETE FROM app_users WHERE id IN ${sql(ids)}`; await sql.end(); }
});
