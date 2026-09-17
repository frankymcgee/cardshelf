import { ensure } from './errors.mjs';
import { stripeId, stripePrice } from './stripe-logic.mjs';
import { productOffer, productPlan } from './stripe-product-logic.mjs';
/** Re-read product/tax state before new checkout or activation; no provider writes. */
export async function verifyStripeOffer(cfg, offer, api) {
  const price = await api(cfg, '/v1/prices/' + stripeId(offer.price_id, 'price'));
  let checked;
  if (offer.sync_managed) {
    const product = await api(cfg, '/v1/products/' + stripeId(offer.product_id, 'prod'));
    ensure(product.id === offer.product_id && productPlan(product, offer.plan_code) === offer.plan_code, 409,
      'Stripe product mapping changed or was disabled. Sync products and review the offer.');
    const mode = product.metadata?.cardshelf_tax_mode || 'automatic';
    const settings = mode === 'automatic' ? await api(cfg, '/v1/tax/settings') : null;
    const tax = mode === 'fixed' && product.metadata?.cardshelf_tax_rate
      ? await api(cfg, '/v1/tax_rates/' + stripeId(product.metadata.cardshelf_tax_rate, 'txr')) : null;
    checked = productOffer(product, price, cfg.environment, offer.plan_code, settings, tax);
    ensure(checked.sync_hash === offer.sync_hash, 409, 'Stripe product or terms changed. Sync products before accepting a new subscription.');
  } else {
    const tax = offer.tax_rate_id ? await api(cfg, '/v1/tax_rates/' + stripeId(offer.tax_rate_id, 'txr')) : null;
    checked = stripePrice(price, cfg.environment, tax);
  }
  for (const key of ['price_id', 'cadence', 'amount_minor', 'total_minor', 'tax_minor', 'tax_bps', 'tax_inclusive', 'tax_rate_id']) {
    ensure(checked[key] === offer[key], 409, 'Stripe price or tax changed. Sync or review the current offer.');
  }
  return checked;
}
