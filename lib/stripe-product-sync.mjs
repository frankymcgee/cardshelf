import { db, audit } from './db.mjs';
import { ensure } from './errors.mjs';
import * as v from './validate.mjs';
import { strictObject } from './subscription-logic.mjs';
import { stripeConfig, stripeAdmin } from './stripe-connection.mjs';
import { stripeEnvironment, stripeId } from './stripe-logic.mjs';
import { stripeRequest } from './stripe-client.mjs';
import { productPlan, productOffer, selectProductPrices, readStripePages, syncDue } from './stripe-product-logic.mjs';
import { productPresentation } from '../shared/stripe-products.mjs';
const defaults = environment => ({ environment, managed: false, daily: false, mirror_plans: false,
  revision: 0, last_attempt_at: null, last_success_at: null, next_sync_at: null, last_error: '', summary: {} });
export async function stripeProductStatus(userId, environment) {
  await stripeAdmin(userId); const env = stripeEnvironment(environment), sql = db();
  const [row] = await sql`SELECT * FROM stripe_product_sync WHERE environment=${env}`;
  const products = await sql`SELECT plan_code,product_id,presentation,active,synced_at FROM stripe_products WHERE environment=${env} ORDER BY plan_code`;
  const offers = await sql`SELECT id,price_id,plan_code,cadence,amount_minor,total_minor,tax_minor,tax_mode,tax_behavior,product_snapshot,published FROM stripe_offers WHERE environment=${env} AND sync_managed ORDER BY plan_code,cadence,created_at DESC LIMIT 100`;
  return { settings: row || defaults(env), products, offers, configured: (await stripeConfig(env)).configured };
}
export async function saveStripeProductSettings(userId, environment, input) {
  const env = stripeEnvironment(environment), o = strictObject(input, ['revision','managed','daily','mirror_plans','password','confirm']);
  await stripeAdmin(userId, o.password ?? '');
  const revision = v.integer(o.revision, 'Revision', 0), managed = v.bool(o.managed, 'Manage products in Stripe'),
    daily = v.bool(o.daily, 'Daily sync'), mirror = v.bool(o.mirror_plans, 'Mirror platform plans');
  ensure(o.confirm === true, 400, 'Confirm that Stripe controls new subscription offers, not existing subscriptions or user grants.');
  ensure(!mirror || env === 'production', 400, 'Only Live products can populate platform plan records.');
  ensure((await stripeConfig(env)).configured, 409, 'Connect Stripe for this environment first.');
  return db().begin(async sql => {
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${'stripe-product-settings:' + env},0))`;
    const [old] = await sql`SELECT * FROM stripe_product_sync WHERE environment=${env} FOR UPDATE`;
    ensure((old?.revision ?? 0) === revision, 409, 'Product sync settings changed. Reload.');
    await sql`INSERT INTO stripe_product_sync(environment,managed,daily,mirror_plans,next_sync_at)
      VALUES(${env},${managed},${daily},${mirror},now())
      ON CONFLICT(environment) DO UPDATE SET managed=excluded.managed,daily=excluded.daily,mirror_plans=excluded.mirror_plans,
        next_sync_at=now(),revision=stripe_product_sync.revision+1,updated_at=now()`;
    if (env === 'production' && (!managed || !mirror)) {
      await sql`UPDATE membership_plans SET stripe_managed=false,revision=revision+1,updated_at=now() WHERE stripe_managed AND code IN ('collector','plus')`;
    }
    await audit(sql, userId, 'stripe.product_sync_settings', { environment: env, managed, daily, mirror_plans: mirror });
    return { saved: true, payments_created: false, access_unchanged: true };
  });
}
/** A complete provider read is staged before any local offer publication. */
export async function syncStripeProducts(userId, environment, api = stripeRequest, scheduled = false) {
  if (!scheduled) await stripeAdmin(userId);
  const env = stripeEnvironment(environment), cfg = await stripeConfig(env);
  ensure(cfg.configured, 409, 'Stripe connection is unavailable. No products were changed.');
  let changedRevision = null;
  try {
    return await db().begin(async sql => {
      const [lock] = await sql`SELECT pg_try_advisory_xact_lock(hashtextextended(${'stripe-products:' + env},0)) AS acquired`;
      if (!lock.acquired) return { busy: true, synced: false };
      const [settingsLock] = await sql`SELECT pg_try_advisory_xact_lock(hashtextextended(${'stripe-product-settings:' + env},0)) AS acquired`;
      if (!settingsLock.acquired) return { busy: true, synced: false };
      const [settings] = await sql`SELECT * FROM stripe_product_sync WHERE environment=${env} FOR UPDATE`;
      ensure(settings?.managed, 409, 'Enable Stripe-managed products before syncing.');
      if (scheduled && !syncDue(settings)) return { skipped: true, synced: false };
      changedRevision = settings.revision;
      const [connection] = await sql`SELECT revision FROM stripe_connections WHERE environment=${env} FOR SHARE`;
      ensure(connection?.revision === cfg.connection_revision, 409, 'Stripe connection changed. Retry sync.');
      const start = Date.now(); let count = 0;
      const get = async (config, path) => {
        ensure(++count <= 55 && Date.now() - start < 60000, 409, 'Product sync exceeded its read limit. No partial catalogue was published.');
        return api(config, path, null, 'GET');
      };
      const account = await get(cfg, '/v1/account'), balance = await get(cfg, '/v1/balance');
      ensure(account.id === cfg.account && balance.livemode === (env === 'production'), 409, 'Stripe account or mode changed.');
      const products = await readStripePages(cfg, '/v1/products?active=true&limit=100', 'prod', get);
      const prices = await readStripePages(cfg, '/v1/prices?active=true&type=recurring&limit=100', 'price', get);
      ensure(prices.every(p => p.object === 'price' && p.livemode === (env === 'production')), 409,
        'Stripe catalogue returned a price in the wrong mode or format. No products were changed.');
      const linked = await sql`SELECT product_id,plan_code FROM stripe_products WHERE environment=${env}
        UNION SELECT product_id,plan_code FROM stripe_offers WHERE environment=${env} AND product_id IS NOT NULL`;
      const selected = new Map();
      for (const p of products) {
        ensure(p.livemode === (env === 'production'), 409, 'Stripe catalogue returned a product in the wrong mode.');
        const plan = productPlan(p, linked.find(x => x.product_id === p.id)?.plan_code);
        if (!plan) continue;
        ensure(!selected.has(plan), 409, 'More than one Stripe product maps to ' + plan + '. Use cardshelf_plan=ignore for unrelated products.');
        selected.set(plan, p);
      }
      let taxSettings = null; const fixedRates = new Map(), staged = [], warnings = [], chosenPrices = new Map();
      for (const [plan, p] of selected) chosenPrices.set(plan, selectProductPrices(p, prices, env));
      if ([...selected].some(([plan,p]) => chosenPrices.get(plan).length && (p.metadata?.cardshelf_tax_mode || 'automatic') === 'automatic')) {
        taxSettings = await get(cfg, '/v1/tax/settings');
      }
      for (const [plan, p] of selected) {
        const chosen = chosenPrices.get(plan);
        if (!chosen.length) { warnings.push(`${p.name}: no active supported monthly or annual AUD price; not offered for sale.`); continue; }
        let fixed = null;
        if (p.metadata?.cardshelf_tax_mode === 'fixed') {
          const id = stripeId(p.metadata.cardshelf_tax_rate, 'txr');
          if (!fixedRates.has(id)) fixedRates.set(id, await get(cfg, '/v1/tax_rates/' + id));
          fixed = fixedRates.get(id);
        }
        for (const price of chosen) staged.push(productOffer(p, price, env, plan, taxSettings, fixed));
      }
      // Serialize with legacy offer publication. Subscription snapshots are never rewritten.
      await sql`SELECT pg_advisory_xact_lock(72490901)`;
      const current = await sql`SELECT * FROM stripe_offers WHERE environment=${env} FOR UPDATE`;
      for (const o of staged) {
        const previous = current.find(x => x.price_id === o.price_id);
        ensure(!previous || previous.plan_code === o.plan_code, 409, 'A Stripe price already belongs to another CardShelf tier. In Stripe integration, delete its unused manual draft and sync again. Used or Stripe-managed offers require a new price.');
      }
      const ids = staged.map(o => o.price_id);
      await sql`UPDATE stripe_offers SET published=false,revision=revision+1 WHERE environment=${env} AND published AND price_id NOT IN ${sql(ids.length ? ids : ['__none__'])}`;
      let updated = 0;
      for (const o of staged) {
        const previous = current.find(x => x.price_id === o.price_id);
        if (previous?.sync_hash === o.sync_hash && previous.published) continue;
        const values = { ...o, environment: env, product_snapshot: sql.json(o.product_snapshot), published: true };
        if (previous) await sql`UPDATE stripe_offers SET ${sql(values)},revision=revision+1 WHERE id=${previous.id}`;
        else await sql`INSERT INTO stripe_offers ${sql(values)}`;
        updated++;
      }
      await sql`UPDATE stripe_products SET active=false WHERE environment=${env}`;
      for (const [plan, p] of selected) {
        const display = productPresentation(p);
        await sql`INSERT INTO stripe_products(environment,plan_code,product_id,presentation,active)
          VALUES(${env},${plan},${p.id},${sql.json(display)},true)
          ON CONFLICT(environment,plan_code) DO UPDATE SET product_id=excluded.product_id,presentation=excluded.presentation,active=true,synced_at=now()`;
      }
      if (env === 'production' && settings.mirror_plans) {
        for (const plan of ['collector','plus']) {
          const product = selected.get(plan), display = product ? productPresentation(product) : {};
          const monthly = staged.find(o => o.plan_code === plan && o.cadence === 'MONTHLY');
          const annual = staged.find(o => o.plan_code === plan && o.cadence === 'ANNUAL');
          // These are display/base prices, not a new payment or a change to a member's tier.
          await sql`UPDATE membership_plans SET name=${display.name || (plan === 'plus' ? 'Collector Plus' : 'Collector')},
            description=${display.description || ''},monthly_price_minor=${monthly?.total_minor ?? null},
            annual_price_minor=${annual?.total_minor ?? null},stripe_managed=true,stripe_product=${sql.json(display)},
            stripe_synced_at=now(),revision=revision+1,updated_at=now() WHERE code=${plan}`;
        }
      }
      const summary = { products: selected.size, published_offers: staged.length, updated_offers: updated, warnings };
      await sql`UPDATE stripe_product_sync SET last_attempt_at=now(),last_success_at=now(),next_sync_at=now()+interval '24 hours',last_error='',summary=${sql.json(summary)} WHERE environment=${env}`;
      await audit(sql, userId, 'stripe.products_synced', { environment: env, ...summary, scheduled });
      return { synced: true, ...summary, payments_created: false, existing_subscriptions_unchanged: true };
    });
  } catch (error) {
    if (changedRevision !== null) {
      const message = error?.status && typeof error.message === 'string' ? error.message.slice(0, 400) : 'Product sync failed. Check the Stripe connection and server logs. Last successful catalogue was retained.';
      await db()`UPDATE stripe_product_sync SET last_attempt_at=now(),last_error=${message},next_sync_at=now()+interval '1 hour' WHERE environment=${env} AND revision=${changedRevision}`;
    }
    throw error;
  }
}
export async function stripeProductTick() {
  const rows = await db()`SELECT environment FROM stripe_product_sync WHERE managed AND daily AND (next_sync_at IS NULL OR next_sync_at<=now()) ORDER BY environment`;
  for (const row of rows) {
    try { await syncStripeProducts(null, row.environment, stripeRequest, true); }
    catch {
      await db()`UPDATE stripe_product_sync SET next_sync_at=now()+interval '1 hour',last_error=CASE WHEN last_error='' THEN 'Product sync needs a working Stripe connection. Last successful catalogue retained.' ELSE last_error END WHERE environment=${row.environment} AND managed AND daily`;
      console.error('Stripe product sync needs administrator attention (' + row.environment + ').');
    }
  }
}
