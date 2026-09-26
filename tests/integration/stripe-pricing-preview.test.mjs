// Disposable PostgreSQL + actual HTTP routes. Synthetic saved products only; no Stripe calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import '../helpers/block-payment-network.mjs';
import { hashPassword, randomToken, digest } from '../../lib/security.mjs';
import { stripePricingPreview } from '../../lib/stripe-pricing-preview.mjs';
const base = process.env.TEST_BASE_URL;
if (process.env.ALLOW_TEST_DATABASE !== 'yes' || !base || !new URL(process.env.DATABASE_URL || 'http://invalid').pathname.endsWith('_test')) throw new Error('Use a disposable _test database only.');
const sql = postgres(process.env.DATABASE_URL, { max: 4 }), path = '/api/admin/integrations/stripe/products/preview';
const suffix = randomUUID().replaceAll('-', ''), ids = [], offerIds = [], accounts = [];
async function request(url, cookie, method = 'GET') {
  const response = await fetch(base + url, { method, redirect: 'manual', headers: { ...(cookie ? { Cookie: cookie } : {}), Origin: process.env.APP_ORIGIN || base, 'X-Requested-With': 'cardshelf' } });
  const text = await response.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: response.status, headers: response.headers, data };
}
async function snapshot() {
  return { controls: await sql`SELECT * FROM stripe_billing_controls ORDER BY id`,
    connections: await sql`SELECT * FROM stripe_connections ORDER BY environment`,
    offers: await sql`SELECT * FROM stripe_offers ORDER BY id`, sync: await sql`SELECT * FROM stripe_product_sync ORDER BY environment`,
    subscriptions: await sql`SELECT * FROM stripe_subscriptions ORDER BY id`,
    plans: await sql`SELECT * FROM membership_plans ORDER BY code`,
    grants: await sql`SELECT * FROM account_access_grants WHERE user_id IN ${sql(ids)} ORDER BY user_id`,
    overrides: await sql`SELECT * FROM account_tier_overrides WHERE user_id IN ${sql(ids)} ORDER BY user_id` };
}
await test('administrator-only Test pricing preview with untouched Live policy and private access', async t => {
  let oldControls = null, ownsConnections = false;
  try {
    // Other files use the same disposable installation, so never overwrite their fixtures.
    assert.equal((await sql`SELECT environment FROM stripe_connections`).length, 0, 'Previous integration fixture must clean up Stripe connections.');
    oldControls = await sql`SELECT * FROM stripe_billing_controls`;
    const hash = await hashPassword('Preview fixture password 123');
    for (const kind of ['admin', 'free', 'collector', 'plus', 'tester', 'complimentary']) {
      const id = randomUUID(), token = randomToken(); ids.push(id);
      await sql`INSERT INTO app_users(id,name,email,password_hash,role) VALUES(${id},${kind},${'preview-' + kind + '-' + suffix + '@example.test'},${hash},${kind === 'admin' ? 'admin' : 'user'})`;
      await sql`INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(${digest(token)},${id},now()+interval '1 hour')`;
      if (['free', 'collector', 'plus', 'complimentary'].includes(kind)) await sql`DELETE FROM account_access_grants WHERE user_id=${id}`;
      if (['collector','plus','complimentary'].includes(kind)) await sql`INSERT INTO account_tier_overrides(user_id,tier,reason) VALUES(${id},${kind},'Preview fixture')`;
      if (kind === 'free') { await sql`INSERT INTO free_accounts(user_id) VALUES(${id})`; await sql`UPDATE account_memberships SET plan_code='free' WHERE user_id=${id}`; }
      accounts.push({ id, kind, cookie: 'cardshelf_session=' + token });
    }
    for (const environment of ['sandbox', 'production']) {
      await sql`INSERT INTO stripe_connections(environment,account_id,api_secret,webhook_secret,accepting_new)
        VALUES(${environment},${'acct_preview_' + suffix},'non-decryptable preview fixture','non-decryptable preview fixture',false)`;
      ownsConnections = true;
    }
    await sql`DELETE FROM stripe_billing_controls`;
    await sql`INSERT INTO stripe_billing_controls(environment,subscriptions_enabled,enforcement_enabled) VALUES('production',false,true)`;
    await sql`INSERT INTO stripe_product_sync(environment,managed,daily,last_success_at) VALUES('sandbox',false,false,'2026-09-18T00:00:00Z')`;
    for (const [environment, cadence, published, name] of [
      ['sandbox', 'MONTHLY', true, 'PREVIEW_TEST_' + suffix], ['sandbox', 'ANNUAL', true, 'PREVIEW_TEST_' + suffix],
      ['sandbox', 'MONTHLY', false, 'ARCHIVED_' + suffix], ['production', 'MONTHLY', true, 'LIVE_PRIVATE_' + suffix]
    ]) {
      const id = randomUUID(); offerIds.push(id);
      const product = { id: 'prod_' + suffix, name, description: 'Synthetic product description', unit_label: 'collector',
        images: ['https://files.stripe.com/links/preview-fixture'], marketing_features: [{ name: 'Multiple card games' }], metadata: { secret: 'DO_NOT_EXPOSE' } };
      const total = cadence === 'ANNUAL' ? 22500 : 2000;
      await sql`INSERT INTO stripe_offers(id,environment,price_id,plan_code,cadence,amount_minor,total_minor,tax_minor,terms,terms_hash,published,product_snapshot,tax_mode,tax_behavior)
        VALUES(${id},${environment},${'price_' + id.replaceAll('-', '')},'plus',${cadence},${total},${total},0,'Synthetic non-purchasable terms','PRIVATE_TERMS_HASH',${published},${sql.json(product)},'none','inclusive')`;
    }
    const admin = accounts[0];
    await t.test('visitors and every non-administrator tier receive protected non-cacheable JSON', async () => {
      for (const account of [null, ...accounts.slice(1)]) {
        const r = await request(path, account?.cookie);
        assert.equal(r.status, account ? 403 : 401); assert.match(r.headers.get('content-type'), /json/);
        assert.match(r.headers.get('cache-control'), /no-store/); assert.match(r.headers.get('x-robots-tag'), /noindex/);
        assert.ok(!JSON.stringify(r.data).includes('PREVIEW_TEST_'));
      }
    });
    await t.test('admin sees Test monthly/yearly offers despite Live enforcement, paused checkout and unavailable credentials', async () => {
      const before = await snapshot(), r = await request(path, admin.cookie);
      assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(r.data.environment, 'sandbox'); assert.equal(r.data.preview, true); assert.equal(r.data.checkout_enabled, false);
      assert.deepEqual(Object.keys(r.data.scan_allowances).sort(),['collector','free','plus']);
      assert.equal(r.data.offers.length, 2); assert.deepEqual(r.data.offers.map(o => o.cadence).sort(), ['ANNUAL', 'MONTHLY']);
      assert.equal(r.data.offers[0].product_snapshot.name, 'PREVIEW_TEST_' + suffix);
      assert.equal(r.data.offers[0].product_snapshot.unit_label, 'collector'); assert.equal(r.data.offers[0].product_snapshot.marketing_features.length, 1);
      assert.doesNotMatch(JSON.stringify(r.data), /DO_NOT_EXPOSE|PRIVATE_TERMS_HASH|LIVE_PRIVATE_|ARCHIVED_|price_id|checkout_url/);
      assert.match(r.headers.get('cache-control'), /private/); assert.match(r.headers.get('vary'), /Cookie/);
      assert.deepEqual(await snapshot(), before);
    });
    await t.test('query parameters cannot expose Live or select another account', async () => {
      for (const q of ['environment=production', 'environment=sandbox', 'user_id=' + admin.id, 'preview=true']) assert.equal((await request(path + '?' + q, admin.cookie)).status, 400);
    });
    await t.test('direct library calls also recheck roles inside a database-enforced read-only transaction', async () => {
      const r = await sql.begin('isolation level repeatable read, read only', tx => stripePricingPreview(tx, admin.id)); assert.equal(r.offers.length, 2);
      await assert.rejects(() => sql.begin('isolation level repeatable read, read only', tx => stripePricingPreview(tx, accounts[1].id)), e => e.status === 403);
    });
    await t.test('public pricing ignores preview flags and no server-rendered preview page leaks Test content', async () => {
      for (const url of ['/api/public/subscription-offers', '/api/public/subscription-offers?preview=true&environment=sandbox']) {
        const r = await request(url, admin.cookie); assert.equal(r.status, 200); assert.equal(r.data.enabled,false);assert.deepEqual(r.data.offers,[]);assert.deepEqual(Object.keys(r.data.scan_allowances).sort(),['collector','free','plus']);
      }
      for (const cookie of [undefined, admin.cookie]) for (const url of ['/pricing?preview=true', '/admin/integrations/stripe-preview', '/admin']) {
        const r = await request(url, cookie); assert.equal(r.status, 200); assert.equal(typeof r.data, 'string');
        assert.ok(!r.data.includes('PREVIEW_TEST_')); assert.ok(!r.data.includes('LIVE_PRIVATE_'));
        if (url.startsWith('/pricing')) assert.match(r.data,/data-testid="free-plan"/);
        if (url.startsWith('/admin')) { assert.match(r.headers.get('cache-control'), /no-store/); assert.match(r.headers.get('x-robots-tag'), /noindex/); }
      }
    });
    await t.test('failed sync reports a warning without its raw exception and preserves last saved products', async () => {
      await sql`UPDATE stripe_product_sync SET last_error='Sensitive provider failure' WHERE environment='sandbox'`;
      const r = await request(path, admin.cookie); assert.equal(r.status, 200); assert.equal(r.data.sync_failed, true); assert.equal(r.data.offers.length, 2); assert.ok(!JSON.stringify(r.data).includes('Sensitive'));
      await sql`UPDATE stripe_product_sync SET last_error='' WHERE environment='sandbox'`;
    });
    await t.test('pausing all Test offers gives a true empty preview, and never falls back to Live offers', async () => {
      await sql`UPDATE stripe_offers SET published=false WHERE environment='sandbox'`;
      const r = await request(path, admin.cookie); assert.equal(r.status, 200); assert.deepEqual(r.data.offers, []);
      assert.equal(r.data.environment, 'sandbox'); assert.equal(r.data.checkout_enabled, false);
    });
    await t.test('losing the administrator role blocks the next preview request', async () => {
      await sql`UPDATE app_users SET role='user' WHERE id=${admin.id}`;
      const r = await request(path, admin.cookie); assert.equal(r.status, 403); assert.ok(!JSON.stringify(r.data).includes('PREVIEW_TEST_'));
    });
  } finally {
    if (oldControls !== null) { await sql`DELETE FROM stripe_billing_controls`; if (oldControls.length) await sql`INSERT INTO stripe_billing_controls ${sql(oldControls)}`; }
    if (offerIds.length) await sql`DELETE FROM stripe_offers WHERE id IN ${sql(offerIds)}`;
    if (ownsConnections) { await sql`DELETE FROM stripe_product_sync WHERE environment='sandbox'`; await sql`DELETE FROM stripe_connections WHERE account_id=${'acct_preview_' + suffix}`; }
    if (ids.length) await sql`DELETE FROM app_users WHERE id IN ${sql(ids)}`;
    await sql.end();
  }
});
