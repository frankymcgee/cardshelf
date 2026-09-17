import { stripeFixture } from './stripe-fixtures.mjs';
export function productFixture(environment = 'sandbox') {
  const fixture = stripeFixture(environment), live = environment === 'production';
  const product = { id: 'prod_collector', object: 'product', active: true, livemode: live,
    name: 'Collector', description: 'Track every card in your collection.', unit_label: 'collector',
    images: ['https://files.stripe.com/links/test-product-image'],
    marketing_features: [{ name: 'Quick tracking binders' }, { name: 'Set completion progress' }],
    metadata: {}, tax_code: 'txcd_10103001', default_price: 'price_month' };
  const month = { ...fixture.price, id: 'price_month', product: product.id, unit_amount: 2000, tax_behavior: 'inclusive' };
  const year = { ...month, id: 'price_year', unit_amount: 22500, recurring: { ...month.recurring, interval: 'year' } };
  const archived = { ...month, id: 'price_archived', active: false, type: 'one_time', recurring: null };
  const settings = { object: 'tax.settings', livemode: live, status: 'active', defaults: { tax_behavior: 'inclusive', tax_code: 'txcd_10103001' } };
  const tax = { id: 'txr_products', active: true, livemode: live, percentage: 10, inclusive: true };
  return { ...fixture, product, month, year, archived, settings, tax };
}
