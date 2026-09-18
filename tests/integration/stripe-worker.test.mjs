// Real PostgreSQL worker checks with synthetic Stripe credentials and responses.
// Never contact a financial provider or modify a non-test database.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID, createHmac} from 'node:crypto';
import '../helpers/block-payment-network.mjs';
import {db, closeDatabase} from '../../lib/db.mjs';
import {stripeEncrypt} from '../../lib/stripe-logic.mjs';
import {stripeConfig} from '../../lib/stripe-connection.mjs';
import {receiveStripeWebhook, stripeTick} from '../../lib/stripe-webhooks.mjs';

if (process.env.ALLOW_TEST_DATABASE !== 'yes' || !process.env.TEST_BASE_URL ||
    !new URL(process.env.DATABASE_URL || 'http://invalid').pathname.endsWith('_test')) {
  throw new Error('Use only a disposable _test database.');
}
const sql = db(), originalEnv = {...process.env};
const key = '64'.repeat(32), webhook = 'whsec_' + 'W'.repeat(32);
const suffix = randomUUID().replaceAll('-', ''), events = new Map(), calls = [];
const stateKeys = ['stripe_worker_lease', 'stripe_heartbeat'];
const userId = randomUUID(), offerId = randomUUID(), subscriptionId = randomUUID();
let serial = 0;

async function provider(cfg, path, body = null, method = 'GET') {
  calls.push({environment: cfg.environment, path, method});
  assert.equal(method, 'GET', 'Reconciliation cannot initiate a payment.');
  assert.equal(cfg.account, 'acct_worker_' + suffix);
  if (path.startsWith('/v1/events/')) {
    const event = events.get(path.slice('/v1/events/'.length));
    assert.ok(event, 'Only this test\'s events may be fetched.');
    assert.equal(event.livemode, cfg.environment === 'production');
    return structuredClone(event);
  }
  if (path.startsWith('/v1/invoices/')) {
    const id = path.slice('/v1/invoices/'.length);
    assert.ok([...events.values()].some(event => event.data.object.id === id));
    return {id, parent: null};
  }
  throw new Error('Unexpected worker provider request: ' + path);
}
async function enqueue(environment) {
  const tag = suffix + '_' + ++serial;
  const event = {id: 'evt_worker_' + tag, object: 'event', livemode: environment === 'production',
    type: 'invoice.updated', data: {object: {id: 'in_worker_' + tag}}};
  events.set(event.id, event);
  const raw = Buffer.from(JSON.stringify(event)), stamp = Math.floor(Date.now() / 1000);
  const signature = 't=' + stamp + ',v1=' + createHmac('sha256', webhook).update(stamp + '.').update(raw).digest('hex');
  await receiveStripeWebhook(environment, raw, signature);
  return event.id;
}
async function eventRow(id) {
  return (await sql`SELECT * FROM stripe_webhook_events WHERE event_id=${id}`)[0];
}
async function releaseFixtureLease() {
  // Advance only the disposable fixture lease, never sleep through a real lease.
  await sql`DELETE FROM app_state WHERE key='stripe_worker_lease'`;
}

await test('Stripe workers without usable credentials cannot claim or poison another instance\'s work', async t => {
  let savedState = [], ownsConnections = false;
  try {
    savedState = await sql`SELECT * FROM app_state WHERE key IN ${sql(stateKeys)}`;
    assert.equal((await sql`SELECT environment FROM stripe_connections`).length, 0,
      'Earlier integration fixtures must release their Stripe connections.');
    process.env.CARDSHELF_INTEGRATION_KEY = key;
    process.env.STRIPE_ENVIRONMENT = 'sandbox';
    process.env.STRIPE_BILLING_ENABLED = 'false';
    process.env.MEMBERSHIP_ENFORCEMENT_ENABLED = 'false';
    delete process.env.STRIPE_CHECKOUT_KILL_SWITCH;
    ownsConnections = true;
    for (const environment of ['sandbox', 'production']) {
      const secret = (environment === 'production' ? 'sk_live_' : 'sk_test_') + 'W'.repeat(32);
      await sql`INSERT INTO stripe_connections(environment,account_id,api_secret,webhook_secret,accepting_new)
        VALUES(${environment},${'acct_worker_' + suffix},${stripeEncrypt(secret,environment,'api')},
          ${stripeEncrypt(webhook,environment,'webhook')},false)`;
    }
    const liveEvent = await enqueue('production');

    for (const [label, value] of [['missing', undefined], ['malformed', 'not-an-encryption-key'], ['incorrect', '65'.repeat(32)]]) {
      await t.test(label + ' integration key leaves the lease, queue and retry budget untouched', async () => {
        await releaseFixtureLease();
        const before = await eventRow(liveEvent);
        const heartbeat = await sql`SELECT * FROM app_state WHERE key='stripe_heartbeat'`;
        const start = calls.length;
        if (value === undefined) delete process.env.CARDSHELF_INTEGRATION_KEY;
        else process.env.CARDSHELF_INTEGRATION_KEY = value;
        try {
          assert.equal((await stripeConfig('production')).configured, false);
          await stripeTick(provider);
        } finally { process.env.CARDSHELF_INTEGRATION_KEY = key; }
        assert.equal(calls.length, start, 'An unconfigured instance must not call Stripe.');
        assert.deepEqual(await eventRow(liveEvent), before);
        assert.equal((await sql`SELECT key FROM app_state WHERE key='stripe_worker_lease'`).length, 0);
        assert.deepEqual(await sql`SELECT * FROM app_state WHERE key='stripe_heartbeat'`, heartbeat);
      });
    }

    await t.test('a configured instance still respects another worker\'s active lease', async () => {
      await sql`INSERT INTO app_state(key,value) VALUES('stripe_worker_lease','{}'::jsonb)
        ON CONFLICT(key) DO UPDATE SET updated_at=now()`;
      const before = await eventRow(liveEvent), start = calls.length;
      await stripeTick(provider);
      assert.equal(calls.length, start);
      assert.deepEqual(await eventRow(liveEvent), before);
    });

    await t.test('restored credentials reconcile a signed Live event even with new billing disabled and Test selected', async () => {
      const cfg = await stripeConfig('production');
      assert.equal(cfg.configured, true); assert.equal(cfg.enabled, false); assert.equal(cfg.accepting, false);
      await releaseFixtureLease();
      const start = calls.length;
      await stripeTick(provider);
      const row = await eventRow(liveEvent);
      assert.equal(row.status, 'done'); assert.equal(row.attempts, 0); assert.equal(row.last_error, '');
      assert.deepEqual(calls.slice(start), [
        {environment: 'production', path: '/v1/events/' + liveEvent, method: 'GET'},
        {environment: 'production', path: '/v1/invoices/' + events.get(liveEvent).data.object.id, method: 'GET'}
      ]);
    });

    await t.test('one usable mode cannot consume events or due subscriptions from an unreadable mode', async () => {
      const sandboxEvent = await enqueue('sandbox'), productionEvent = await enqueue('production');
      const beforeEvent = await eventRow(productionEvent);
      await sql`INSERT INTO app_users(id,email,name,password_hash) VALUES(${userId},${'worker-' + suffix + '@example.test'},'Worker fixture','not-a-login-hash')`;
      await sql`INSERT INTO stripe_offers(id,environment,price_id,plan_code,cadence,amount_minor,total_minor,tax_minor,terms,terms_hash)
        VALUES(${offerId},'production',${'price_worker_' + suffix},'plus','MONTHLY',100,100,0,'Synthetic worker fixture','worker-fixture')`;
      await sql`INSERT INTO stripe_subscriptions(id,user_id,environment,request_id,offer_id,offer_snapshot,customer_id,checkout_expires_at)
        VALUES(${subscriptionId},${userId},'production',${randomUUID()},${offerId},'{}'::jsonb,${'cus_worker_' + suffix},now()+interval '1 hour')`;
      const [beforeSubscription] = await sql`SELECT * FROM stripe_subscriptions WHERE id=${subscriptionId}`;
      const [connection] = await sql`SELECT api_secret FROM stripe_connections WHERE environment='production'`;
      await sql`UPDATE stripe_connections SET api_secret='invalid-encrypted-fixture' WHERE environment='production'`;
      try {
        assert.equal((await stripeConfig('sandbox')).configured, true);
        assert.equal((await stripeConfig('production')).configured, false);
        await releaseFixtureLease();
        const start = calls.length;
        await stripeTick(provider);
        assert.equal((await eventRow(sandboxEvent)).status, 'done');
        assert.deepEqual(await eventRow(productionEvent), beforeEvent);
        assert.deepEqual((await sql`SELECT * FROM stripe_subscriptions WHERE id=${subscriptionId}`)[0], beforeSubscription);
        assert.equal(calls.length - start, 2);
        assert.ok(calls.slice(start).every(call => call.environment === 'sandbox'));
      } finally {
        await sql`UPDATE stripe_connections SET api_secret=${connection.api_secret} WHERE environment='production'`;
        await sql`DELETE FROM stripe_subscriptions WHERE id=${subscriptionId}`;
      }
      await releaseFixtureLease();
      await stripeTick(provider);
      assert.equal((await eventRow(productionEvent)).status, 'done');
      assert.equal((await eventRow(productionEvent)).attempts, 0);
    });

    await t.test('authenticated identity mismatches remain queued for retry, never verified', async () => {
      const id = await enqueue('production');
      await releaseFixtureLease();
      const before = await eventRow(id);
      await stripeTick(async (...args) => {
        const response = await provider(...args);
        return args[1] === '/v1/events/' + id ? {...response, livemode: false} : response;
      });
      const after = await eventRow(id);
      assert.equal(after.status, 'queued'); assert.equal(after.attempts, 1);
      assert.ok(after.next_attempt_at > before.next_attempt_at);
      assert.match(after.last_error, /reconciliation failed/);
    });

    await t.test('a real provider failure keeps its retry delay and cannot mark an event done', async () => {
      const id = await enqueue('sandbox');
      await releaseFixtureLease();
      const before = await eventRow(id);
      await stripeTick(async () => { throw new Error('Synthetic provider unavailable'); });
      const after = await eventRow(id);
      assert.equal(after.status, 'queued'); assert.equal(after.attempts, 1);
      assert.ok(after.next_attempt_at > before.next_attempt_at);
      assert.match(after.last_error, /reconciliation failed/);
    });
  } finally {
    if (ownsConnections) {
      if (events.size) await sql`DELETE FROM stripe_webhook_events WHERE event_id IN ${sql([...events.keys()])}`;
      await sql`DELETE FROM stripe_subscriptions WHERE id=${subscriptionId}`;
      await sql`DELETE FROM stripe_offers WHERE id=${offerId}`;
      await sql`DELETE FROM app_users WHERE id=${userId}`;
      await sql`DELETE FROM stripe_connections WHERE account_id=${'acct_worker_' + suffix}`;
      await sql`DELETE FROM app_state WHERE key IN ${sql(stateKeys)}`;
      if (savedState.length) await sql`INSERT INTO app_state ${sql(savedState)}`;
    }
    for (const name of Object.keys(process.env)) if (!(name in originalEnv)) delete process.env[name];
    Object.assign(process.env, originalEnv);
    await closeDatabase();
  }
});
