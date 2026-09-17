import { db } from './db.mjs';
import { effectiveBillingPolicy } from './billing-control-logic.mjs';

export const BILLING_CONTROL_LOCK = 72491010;

/** Deliberately uncached: UI changes take effect across app processes immediately. */
export async function billingPolicy(sql = db(), env = process.env) {
  const [row] = await sql`SELECT environment,subscriptions_enabled,enforcement_enabled,revision
    FROM stripe_billing_controls WHERE id=1`;
  return effectiveBillingPolicy(row, env);
}
