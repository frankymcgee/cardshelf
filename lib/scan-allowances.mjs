import { db } from './db.mjs';
// Display-only values, without credentials, budget, prompt or private tier limits.
export async function publicScanAllowances(sql=db()) {
  const [row]=await sql`SELECT free_monthly_limit,collector_monthly_limit,plus_monthly_limit FROM card_scan_settings WHERE singleton`;
  return {free:row.free_monthly_limit,collector:row.collector_monthly_limit,plus:row.plus_monthly_limit};
}
