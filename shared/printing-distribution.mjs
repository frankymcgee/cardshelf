export const DISTRIBUTIONS = Object.freeze({
  regular: 'Regular set printing', product_exclusive: 'Product exclusive',
  promo: 'Promotional printing', unknown: 'Distribution unconfirmed'
});
export const PRINTING_SCOPES = ['regular', 'all'];
// Unknown distribution is retained for review, never guessed from finish/count/price.
export function printingIncluded(printing, scope = 'all') {
  return scope !== 'regular' || !['product_exclusive', 'promo'].includes(printing.distribution);
}
export function distributionLabel(printing) { return DISTRIBUTIONS[printing?.distribution] || DISTRIBUTIONS.unknown; }
