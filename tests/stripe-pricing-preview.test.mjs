import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripePricingPreview } from '../lib/stripe-pricing-preview.mjs';
import { pricingPlans, pricingCadence, annualSaving } from '../shared/pricing-table.mjs';
import { productPresentation, offerTaxLabel } from '../shared/stripe-products.mjs';
import { publicPage, safeReturnTo } from '../shared/platform.mjs';
const product = () => ({ id: 'prod_preview', name: 'Collector Pro preview', description: 'Test description\nSecond line', unit_label: 'collector', images: ['https://files.stripe.com/links/preview'], marketing_features: [{ name: 'All supported games' }] });
const offer = (cadence = 'MONTHLY', changes = {}) => ({ plan_code: 'plus', cadence, total_minor: cadence === 'MONTHLY' ? 2000 : 22500, tax_minor: 0, tax_mode: 'none', tax_behavior: 'inclusive', product_snapshot: product(), ...changes });
function fixture({ role = 'admin', rows = [offer(), offer('ANNUAL')], sync = { last_success_at: new Date('2026-09-18T00:00:00Z'), last_error: '' } } = {}) {
  const calls = [];
  const sql = async (parts, ...params) => {
    const text = parts.join('?').replace(/\s+/g, ' ').trim(); calls.push({ text, params });
    assert.match(text, /^SELECT /); assert.doesNotMatch(text, /\b(?:INSERT|UPDATE|DELETE|ALTER|DROP)\b/i);
    if (text.includes('FROM app_users')) return role === null ? [] : [{ role }];
    if(text.includes('FROM card_scan_settings')) return [{free_monthly_limit:5,collector_monthly_limit:25,plus_monthly_limit:0}];
    assert.match(text, /WHERE environment='sandbox'/);
    if (text.includes('FROM stripe_offers')) { assert.match(text, /AND published/); return rows; }
    if (text.includes('FROM stripe_product_sync')) return sync ? [sync] : [];
    throw new Error('Unexpected SQL: ' + text);
  };
  return { sql, calls };
}
test('preview reads only saved Sandbox offers without credentials, activation or Stripe network access', async () => {
  const f = fixture(), original = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('Preview must not call a provider'); };
  try {
    const r = await stripePricingPreview(f.sql, 'admin-fixture');
    assert.equal(r.environment, 'sandbox'); assert.equal(r.preview, true); assert.equal(r.checkout_enabled, false);
    assert.equal(r.offers.length, 2); assert.equal(r.last_synced_at, '2026-09-18T00:00:00.000Z'); assert.equal(r.sync_failed, false);
    assert.equal(f.calls.length, 4); assert.deepEqual(r.scan_allowances,{free:5,collector:25,plus:0}); assert.deepEqual(f.calls[0].params, ['admin-fixture']);
    assert.ok(f.calls.every(c => !/billing_controls|stripe_connections|stripe_subscriptions/.test(c.text)));
  } finally { globalThis.fetch = original; }
});
for (const role of ['user', 'plus', 'complimentary', undefined, null]) test('account role ' + String(role) + ' cannot read preview products', async () => {
  const f = fixture({ role: role === undefined ? '' : role });
  await assert.rejects(() => stripePricingPreview(f.sql, 'not-admin'), e => e.status === (role === null ? 401 : 403));
  assert.equal(f.calls.length, 1);
});
test('preview returns an explicit display-only allowlist, not offer IDs or raw product metadata', async () => {
  const raw = offer('MONTHLY', { id: 'secret-offer-id', price_id: 'price_private', terms: 'secret terms', terms_hash: 'secret hash', revision: 8, customer_id: 'cus_private', checkout_url: 'https://checkout.stripe.com/private' });
  raw.product_snapshot.metadata = { secret_key: 'sk_test_DO_NOT_EXPOSE' };
  raw.product_snapshot.images.push('https://evil.invalid/image');
  const r = await stripePricingPreview(fixture({ rows: [raw] }).sql, 'admin');
  assert.deepEqual(Object.keys(r.offers[0]).sort(), ['cadence','plan_code','product_snapshot','tax_behavior','tax_minor','tax_mode','total_minor']);
  assert.deepEqual(r.offers[0].product_snapshot, product());
  assert.doesNotMatch(JSON.stringify(r), /private|secret|sk_test|revision|terms_hash/);
});
test('no saved catalogue is an empty preview, not fabricated plans or an attempt to sync', async () => {
  const r = await stripePricingPreview(fixture({ rows: [], sync: null }).sql, 'admin');
  assert.deepEqual(r.offers, []); assert.equal(r.last_synced_at, null); assert.equal(r.sync_failed, false);
  assert.deepEqual(pricingPlans(r.offers, false), []);
});
test('failed sync retains saved content and exposes only a warning flag, never raw errors', async () => {
  const r = await stripePricingPreview(fixture({ sync: { last_success_at: '2026-09-17T00:00:00Z', last_error: 'Sensitive provider exception' } }).sql, 'admin');
  assert.equal(r.sync_failed, true); assert.equal(r.offers.length, 2); assert.doesNotMatch(JSON.stringify(r), /Sensitive/);
});
test('both displays group monthly/yearly prices and share all requested product fields', () => {
  const rows = [offer(), offer('ANNUAL')];
  const [plan] = pricingPlans(rows, false);
  assert.deepEqual(pricingPlans(rows, true), pricingPlans(rows, false));
  assert.equal(plan.name, product().name); assert.equal(plan.description, product().description);
  assert.deepEqual(plan.product.images, product().images); assert.equal(plan.product.unit_label, 'collector');
  assert.deepEqual(plan.features, product().marketing_features); assert.equal(plan.offers.length, 2);
  assert.equal(annualSaving(plan), 1500);
});
test('clearing synced descriptions, features and images clears the preview instead of adding stale defaults', () => {
  const [plan] = pricingPlans([offer('MONTHLY', { product_snapshot: { id: 'prod_preview', name: 'Renamed' } })], false);
  assert.equal(plan.name, 'Renamed'); assert.equal(plan.description, ''); assert.deepEqual(plan.features, []); assert.deepEqual(plan.product.images, []);
});
test('legacy manually published offers retain default names without inventing unsupported preview tiers', () => {
  const [plan] = pricingPlans([offer('MONTHLY', { product_snapshot: null })], false);
  assert.equal(plan.name, 'Collector Plus'); assert.ok(plan.features.length); assert.equal(plan.offers.length, 1);
  assert.equal(pricingPlans([], true).length, 2); assert.deepEqual(pricingPlans(undefined, false), []);
});
test('unsafe images and remote HTML cannot acquire renderer privileges', () => {
  const p = product(); p.name = '<script>alert(1)</script>'; p.images = ['javascript:alert(1)', 'https://files.stripe.com.evil.test/x'];
  const [plan] = pricingPlans([offer('MONTHLY', { product_snapshot: p })], false);
  assert.equal(plan.name, p.name); assert.deepEqual(plan.product.images, []);
});
test('cadence selects an available option and recovers when a refresh removes the selected option', () => {
  assert.equal(pricingCadence([offer(), offer('ANNUAL')], 'ANNUAL'), 'ANNUAL');
  assert.equal(pricingCadence([offer('ANNUAL')], 'MONTHLY'), 'ANNUAL');
  assert.equal(pricingCadence([offer()], 'ANNUAL'), 'MONTHLY');
  assert.equal(pricingCadence([], 'ANNUAL'), 'MONTHLY');
  assert.equal(pricingCadence([offer('ANNUAL')], 'invalid'), 'ANNUAL');
});
for (const changes of [{ tax_mode: 'automatic' }, { tax_behavior: 'exclusive' }, { tax_inclusive: true }, { total_minor: 25000 }]) test('annual saving does not invent a saving for ' + JSON.stringify(changes), () => {
  const [plan] = pricingPlans([offer(), offer('ANNUAL', changes)], false); assert.equal(annualSaving(plan), 0);
});
test('tax wording remains shared and visible for automatic inclusive/exclusive and no-tax offers', () => {
  assert.match(offerTaxLabel(offer()), /No tax/);
  assert.match(offerTaxLabel(offer('MONTHLY', { tax_mode: 'automatic' })), /Includes applicable tax/);
  assert.match(offerTaxLabel(offer('MONTHLY', { tax_mode: 'automatic', tax_behavior: 'exclusive' })), /Plus applicable tax/);
});
test('preview is a protected internal route with a supported return after sign-in, not a public page', () => {
  const path = '/admin/integrations/stripe-preview'; assert.equal(publicPage(path), false); assert.equal(safeReturnTo(path), path);
});
test('preview HTTP handler enforces private reads and cannot select a user-supplied environment', async () => {
  const source = await readFile(new URL('../server/api/admin/integrations/stripe/products/preview.get.ts', import.meta.url), 'utf8');
  assert.match(source, /platformUser\(event, true\)/); assert.match(source, /private, no-store/); assert.match(source, /'Vary', 'Cookie'/);
  assert.match(source, /Object.keys\(getQuery\(event\)\).length === 0/); assert.match(source, /isolation level repeatable read, read only/);
  assert.doesNotMatch(source, /stripeProductTick|syncStripeProducts|stripeRequest|saveStripe|publishStripe/);
});
test('public pricing keeps its original Live endpoint and gate; preview is a separate render mode', async () => {
  const page = await readFile(new URL('../app/pages/pricing.vue', import.meta.url), 'utf8');
  assert.match(page, /\/api\/public\/subscription-offers/); assert.match(page, /environment === 'production'/);
  assert.match(page, /SubscriptionPricingTable/); assert.doesNotMatch(page, /sandbox|route\.query|products\/preview/);
  const renderer = await readFile(new URL('../app/components/SubscriptionPricingTable.vue', import.meta.url), 'utf8');
  assert.match(renderer, /TEST PREVIEW · NOT ON SALE/); assert.match(renderer, /v-if="mode === 'preview'"/);
  assert.doesNotMatch(renderer, /v-html|innerHTML|stripe\/checkout|stripeRequest|window.location/);
});
