// Automatic tax changes the tax, never the authorised base price or payment identity.
const cash = n => Number.isSafeInteger(n) && n >= 0 && n <= 20000000;
const self = value => !value || value.type === 'self';
export function invoiceTaxMatches(invoice, sub, offer) {
  if (offer.tax_mode !== 'automatic') return invoice.total === offer.total_minor &&
    Math.abs(invoice.total - invoice.total_excluding_tax - offer.tax_minor) <= 1;
  const line = invoice.lines?.data?.[0], taxes = invoice.total_taxes;
  if (!invoice.automatic_tax?.enabled || invoice.automatic_tax.status !== 'complete' ||
      sub.automatic_tax?.enabled !== true || !self(invoice.automatic_tax.liability) || !self(sub.automatic_tax.liability) ||
      !self(invoice.issuer) || !Array.isArray(taxes) ||
      !['inclusive', 'exclusive'].includes(offer.tax_behavior) || !cash(offer.amount_minor) ||
      !cash(invoice.total) || !cash(invoice.total_excluding_tax) ||
      line?.amount !== offer.amount_minor || invoice.subtotal !== offer.amount_minor ||
      (invoice.default_tax_rates || []).length || (sub.default_tax_rates || []).length ||
      (line?.tax_rates || []).length || invoice.shipping_cost || invoice.amount_shipping ||
      (invoice.total_discount_amounts || []).some(x => x.amount) || (line?.discount_amounts || []).some(x => x.amount)) return false;
  if (taxes.some(t => !t || !cash(t.amount) || t.tax_behavior !== offer.tax_behavior || t.type !== 'tax_rate_details')) return false;
  const sum = taxes.reduce((n, t) => n + t.amount, 0);
  if (!cash(sum) || invoice.total - invoice.total_excluding_tax !== sum) return false;
  return offer.tax_behavior === 'inclusive'
    ? invoice.total === offer.amount_minor && sum <= offer.amount_minor
    : invoice.total_excluding_tax === offer.amount_minor && invoice.total === offer.amount_minor + sum;
}
export function checkoutTax(offer) {
  return offer.tax_mode === 'automatic'
    ? { automatic_tax: { enabled: true }, billing_address_collection: 'required', customer_update: { address: 'auto' } }
    : { automatic_tax: { enabled: false } };
}
