// Presentation data is never an access-control or billing authority.
export const PRODUCT_IMAGE_HOSTS = ['files.stripe.com', 'stripe-camo.global.ssl.fastly.net'];
export function productImage(value) {
  if (typeof value !== 'string' || value.length > 2048) return '';
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password && !u.port &&
      PRODUCT_IMAGE_HOSTS.includes(u.hostname) ? u.href : '';
  } catch { return ''; }
}
const text = (value, length) => typeof value === 'string' ? value.replace(/\0/g, '').slice(0, length) : '';
export function productPresentation(product = {}) {
  product = product && typeof product === 'object' ? product : {};
  return {
    id: text(product.id, 255), name: text(product.name, 250),
    description: text(product.description, 2000), unit_label: text(product.unit_label, 80),
    images: (Array.isArray(product.images) ? product.images : []).slice(0, 8).map(productImage).filter(Boolean),
    marketing_features: (Array.isArray(product.marketing_features) ? product.marketing_features : [])
      .slice(0, 15).map(f => ({ name: text(f?.name, 160) })).filter(f => f.name.trim())
  };
}
export function offerTaxLabel(offer) {
  if (offer.tax_mode === 'automatic') return offer.tax_behavior === 'inclusive'
    ? 'Includes applicable tax. Stripe confirms tax at checkout.'
    : 'Plus applicable tax calculated by Stripe at checkout.';
  if (offer.tax_mode === 'none') return 'No tax collected on this offer.';
  return offer.tax_minor > 0 ? 'Includes configured tax.' : 'No configured tax added.';
}
export function productGroups(offers = []) {
  const groups = new Map();
  for (const o of offers) {
    if (!['collector', 'plus'].includes(o.plan_code)) continue;
    const key = o.plan_code;
    if (!groups.has(key)) groups.set(key, { code: key, product: productPresentation(o.product_snapshot), offers: [] });
    groups.get(key).offers.push(o);
  }
  return [...groups.values()].sort((a, b) => a.code === b.code ? 0 : a.code === 'collector' ? -1 : 1);
}
