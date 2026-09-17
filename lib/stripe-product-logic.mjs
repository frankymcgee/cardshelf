import { ensure } from './errors.mjs';
import { stripeId, objectId, stripePrice } from './stripe-logic.mjs';
import { productPresentation } from '../shared/stripe-products.mjs';
import { hashValue } from './subscription-logic.mjs';
export const PRODUCT_INTERVAL_MS = 24 * 60 * 60 * 1000;
export function productPlan(product, linkedPlan = null) {
  const explicit = product.metadata?.cardshelf_plan;
  if (explicit !== undefined && explicit !== '') {
    ensure(['collector', 'plus', 'ignore'].includes(explicit), 409,
      'cardshelf_plan must be collector, plus or ignore.');
    if (explicit === 'ignore') return null;
    ensure(!linkedPlan || explicit === linkedPlan, 409, 'A linked Stripe product cannot change its access tier. Create a new product.');
    return explicit;
  }
  if (linkedPlan) return linkedPlan;
  return new Map([['collector', 'collector'], ['collector plus', 'plus']]).get(String(product.name || '').trim().toLowerCase()) || null;
}
export function selectProductPrices(product, allPrices, environment) {
  const prices = allPrices.filter(p => p.active === true && objectId(p.product) === product.id);
  const selected = [];
  for (const [interval, key] of [['month', 'cardshelf_monthly_price'], ['year', 'cardshelf_annual_price']]) {
    const eligible = prices.filter(p => {
      try { stripePrice(p, environment); return p.recurring.interval === interval; } catch { return false; }
    });
    const id = product.metadata?.[key];
    if (id) {
      stripeId(id, 'price'); const selectedPrice = eligible.find(p => p.id === id);
      ensure(selectedPrice, 409, `${key} must identify an active, supported price on this product.`);
      selected.push(selectedPrice); continue;
    }
    if (eligible.length === 1) selected.push(eligible[0]);
    else if (eligible.length > 1) {
      const preferred = eligible.find(p => p.id === objectId(product.default_price));
      ensure(preferred, 409, `Multiple ${interval} prices: archive older prices, set the default price, or set ${key} in Stripe metadata.`);
      selected.push(preferred);
    }
  }
  return selected;
}
export function automaticTaxBehavior(price, settings) {
  let behavior = price.tax_behavior;
  if (!behavior || behavior === 'unspecified') behavior = settings?.defaults?.tax_behavior;
  // Stripe's currency-inferred default uses inclusive pricing for AUD.
  if (behavior === 'inferred_by_currency') behavior = 'inclusive';
  ensure(['inclusive', 'exclusive'].includes(behavior), 409,
    'Specify inclusive/exclusive tax behavior on the price or in Stripe Tax settings.');
  return behavior;
}
export function productOffer(product, price, environment, plan, taxSettings = null, fixedTax = null) {
  ensure(product?.object === 'product' && product.active === true && product.livemode === (environment === 'production'), 409, 'Stripe product is archived or belongs to a different mode.');
  stripeId(product.id, 'prod');
  ensure(objectId(price.product) === product.id, 409, 'Price does not belong to the selected Stripe product.');
  ensure(['collector', 'plus'].includes(plan), 409, 'Unsupported CardShelf plan.');
  const mode = product.metadata?.cardshelf_tax_mode || 'automatic';
  ensure(['automatic', 'fixed', 'none'].includes(mode), 409, 'cardshelf_tax_mode must be automatic, fixed or none.');
  let data = stripePrice(price, environment), behavior = 'unspecified';
  if (mode === 'automatic') {
    ensure(taxSettings?.object === 'tax.settings' && taxSettings.status === 'active' && taxSettings.livemode === (environment === 'production'), 409, 'Complete Stripe Tax setup, or explicitly set cardshelf_tax_mode to fixed or none in Stripe.');
    ensure(!product.metadata?.cardshelf_tax_rate, 409, 'Remove cardshelf_tax_rate when using automatic tax.');
    ensure(/^txcd_\d+$/.test(objectId(product.tax_code) || taxSettings.defaults?.tax_code || ''), 409, 'Choose a Stripe product tax code or default tax code.');
    behavior = automaticTaxBehavior(price, taxSettings);
    data = { ...data, tax_inclusive: behavior === 'inclusive' };
  } else if (mode === 'fixed') {
    ensure(product.metadata?.cardshelf_tax_rate && fixedTax?.id === product.metadata.cardshelf_tax_rate, 409, 'Set cardshelf_tax_rate to an active txr_ identifier in Stripe product metadata.');
    data = stripePrice(price, environment, fixedTax);
    behavior = fixedTax.inclusive ? 'inclusive' : 'exclusive';
    ensure(!['inclusive', 'exclusive'].includes(price.tax_behavior) || price.tax_behavior === behavior, 409, 'Price tax behavior and fixed tax rate disagree.');
  } else ensure(!product.metadata?.cardshelf_tax_rate, 409, 'Remove cardshelf_tax_rate when choosing no tax collection.');
  const display = productPresentation(product);
  ensure(display.name.trim(), 409, 'Give the Stripe product a name.');
  const amount = (data.total_minor / 100).toFixed(2), cadence = data.cadence === 'MONTHLY' ? 'month' : 'year';
  const supplied = product.metadata?.cardshelf_terms || '';
  ensure(typeof supplied === 'string' && supplied.length <= 2000, 409, 'Subscription terms are too long.');
  const terms = `${display.name}: AUD ${amount} per ${cadence}${display.unit_label ? ' per ' + display.unit_label : ''}. ` +
    (mode === 'automatic' ? (behavior === 'inclusive' ? 'Includes applicable tax; Stripe confirms tax at checkout. ' : 'Plus applicable tax calculated by Stripe at checkout. ') : 'This amount is the configured total. ') +
    'Recurring subscription until cancelled. Manage payment methods and cancel future renewals in Membership. Cancellation takes effect at the end of the paid billing period; it does not automatically issue a refund. ' + supplied;
  const values = { ...data, plan_code: plan, product_id: product.id, product_snapshot: display,
    tax_mode: mode, tax_behavior: behavior, terms, sync_managed: true };
  return { ...values, terms_hash: hashValue(values), sync_hash: hashValue(values) };
}
// All pages must be read before publication. A truncated response is never an empty catalogue.
export async function readStripePages(cfg, path, prefix, api, maxPages = 20) {
  let cursor = '', rows = []; const seen = new Set();
  for (let n = 0; n < maxPages; n++) {
    const page = await api(cfg, path + (cursor ? '&starting_after=' + encodeURIComponent(cursor) : ''), null, 'GET');
    ensure(Array.isArray(page?.data) && page.data.length <= 100 && typeof page.has_more === 'boolean', 502, 'Stripe returned an incomplete catalogue page.');
    for (const row of page.data) {
      stripeId(row.id, prefix); ensure(!seen.has(row.id), 502, 'Stripe catalogue pagination repeated an item.');
      seen.add(row.id); rows.push(row);
    }
    if (!page.has_more) return rows;
    ensure(page.data.length > 0, 502, 'Stripe catalogue pagination did not advance.');
    cursor = page.data.at(-1).id;
  }
  ensure(false, 409, 'Stripe catalogue exceeds the sync page limit. No partial catalogue was published.');
}
export function syncDue(settings, now = Date.now()) {
  return Boolean(settings?.managed && settings.daily && (!settings.next_sync_at || Date.parse(settings.next_sync_at) <= now));
}
