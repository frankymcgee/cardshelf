// Read-only saved-catalogue preview. This module has no Stripe client or billing-policy dependency.
import { ensure } from './errors.mjs';
import { productPresentation } from '../shared/stripe-products.mjs';
/**
 * Execute inside a read-only, repeatable-read transaction supplied by the API route.
 * Recheck the real account role, rather than trusting a plan name or tester grant.
 * @param {import('postgres').TransactionSql} sql
 * @param {string} userId
 * @returns {Promise<{preview: true, environment: 'sandbox', checkout_enabled: false,
 *   last_synced_at: string|null, sync_failed: boolean, offers: import('../shared/pricing-table.mjs').PricingOffer[]}>}
 */
export async function stripePricingPreview(sql, userId) {
  const [user] = await sql`SELECT role FROM app_users WHERE id=${userId}`;
  ensure(user, 401, 'Sign in to continue.');
  ensure(user.role === 'admin', 403, 'Administrator access is required.');
  // No environment argument: a query parameter or active Live policy cannot select Live data.
  const rows = await sql`SELECT plan_code,cadence,total_minor,tax_minor,product_snapshot,tax_mode,tax_behavior
    FROM stripe_offers WHERE environment='sandbox' AND published ORDER BY plan_code,cadence`;
  const [sync] = await sql`SELECT last_success_at,last_error FROM stripe_product_sync WHERE environment='sandbox'`;
  return {
    preview: true, environment: 'sandbox', checkout_enabled: false,
    last_synced_at: sync?.last_success_at ? new Date(sync.last_success_at).toISOString() : null,
    sync_failed: Boolean(sync?.last_error),
    // Deliberately exclude price/offer IDs, terms hashes, credentials, customer and checkout data.
    offers: rows.map(row => ({ plan_code: row.plan_code, cadence: row.cadence,
      total_minor: row.total_minor, tax_minor: row.tax_minor, tax_mode: row.tax_mode, tax_behavior: row.tax_behavior,
      product_snapshot: productPresentation(row.product_snapshot) }))
  };
}
