import { estimateForPrinting, audConversion, valueRows } from './price-logic.mjs';

const round = value => Math.round((value + Number.EPSILON) * 100) / 100;

// Store the unrounded per-copy AUD basis actually used on this observation.
// Historical totals must not be recalculated with today's holdings or FX rates.
export function snapshotValuation(rows, rates, now = Date.now()) {
  const holdings = rows.filter(row => Number(row.quantity) > 0).map(row => {
    const quote = estimateForPrinting(row, row, rates, now);
    const included = quote && (quote.approximate || (!quote.stale && !quote.fetch_error));
    const conversion = included ? audConversion(quote, rates, now) : null;
    return {
      printing_id: row.printing_id, quantity: Number(row.quantity),
      unit_aud: conversion?.amount ?? null,
      basis: quote ? JSON.stringify([quote.source, quote.variant, quote.currency, quote.metric, !!quote.approximate]) : null,
      source_updated_at: quote?.source_updated_at ?? null,
      fx_rate: conversion?.rate ?? null, fx_date: conversion?.rate_date ?? null
    };
  });
  const valuation = valueRows(rows, rates, now);
  return { valuation, holdings };
}

export function valueHistoryChange(before, after) {
  if (!before || !after || before.snapshot_date === after.snapshot_date) return null;
  const previous = new Map(before.holdings.map(row => [row.printing_id, row]));
  const current = new Map(after.holdings.map(row => [row.printing_id, row]));
  let prices = 0, quantities = 0, coverage = 0, added = 0, removed = 0;
  for (const id of new Set([...previous.keys(), ...current.keys()])) {
    const a = previous.get(id), b = current.get(id);
    const aq = a?.quantity ?? 0, bq = b?.quantity ?? 0, retained = Math.min(aq, bq);
    const ap = a?.unit_aud ?? 0, bp = b?.unit_aud ?? 0;
    added += Math.max(0, bq - aq); removed += Math.max(0, aq - bq);
    quantities += bq >= aq ? (bq - aq) * bp : (bq - aq) * ap;
    // A change of metric/provider or lost/new price coverage is not a gain.
    if (a?.unit_aud != null && b?.unit_aud != null && a.basis === b.basis) prices += retained * (bp - ap);
    else coverage += retained * (bp - ap);
  }
  const start = before.valuation.aud_total, end = after.valuation.aud_total;
  const total = start == null || end == null ? null : round(end - start);
  const priceDelta = round(prices), quantityDelta = round(quantities);
  return {
    from: before.snapshot_date, to: after.snapshot_date, total_aud: total,
    percent: total == null || !start ? null : round(total / start * 100),
    price_fx_aud: priceDelta, quantity_aud: quantityDelta,
    // Allocate any sub-cent rounding residual here so displayed parts reconcile.
    coverage_aud: total == null ? round(coverage) : round(total - priceDelta - quantityDelta),
    added_quantity: added, removed_quantity: removed
  };
}
