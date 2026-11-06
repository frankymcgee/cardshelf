import { estimateForPrinting, valueRows } from './price-logic.mjs';

// Completion groups repeated pockets by printing. An unchecked Tracking target
// already in inventory needs a checklist update, not another purchase.
export function completionPrices(items, rows, rates, now = Date.now()) {
  const byId = new Map(rows.map(row => [row.printing_id, row]));
  const needed = items.filter(item => item.owned_quantity === 0);
  const estimates = items.map(item => {
    if (item.owned_quantity > 0) return { printing_id: item.printing_id, estimate: null };
    const row = byId.get(item.printing_id), quote = row && estimateForPrinting(row, row, rates, now);
    const included = quote && quote.aud != null && (quote.approximate || (!quote.stale && !quote.fetch_error));
    return { printing_id: item.printing_id, estimate: included ? {
      aud: quote.aud, source: quote.source, source_updated_at: quote.source_updated_at,
      fx_date: quote.fx_date, approximate: quote.approximate, stale: quote.stale, fetch_error: quote.fetch_error
    } : null };
  });
  const valuation = valueRows(needed.map(item => ({ ...byId.get(item.printing_id), quantity: 1 })), rates, now);
  return { estimates, summary: { ...valuation, aud_total: needed.length ? valuation.aud_total : 0,
    needed_printings: needed.length, already_owned_printings: items.length - needed.length,
    generated_at: new Date(now).toISOString() } };
}
