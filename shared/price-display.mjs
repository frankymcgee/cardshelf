// Presentation helpers. Exact quotes remain separate from labelled approximate estimates.
/**
 * @typedef {Object} DisplayQuote
 * @property {string} source
 * @property {string} variant
 * @property {string} currency
 * @property {string} metric
 * @property {number} amount
 * @property {string|null} [source_updated_at]
 * @property {number|null} [aud]
 * @property {string|null} [fx_date]
 * @property {number|null} [fx_rate]
 * @property {boolean} [stale]
 * @property {boolean} [fetch_error]
 * @property {boolean} [approximate]
 * @property {string} [estimate_note]
 */
export const CARDMARKET_REFERENCE_METRICS = Object.freeze([
  'trend', 'avg30', 'avg7', 'avg', 'avg1',
  'trend-holo', 'avg30-holo', 'avg7-holo', 'avg-holo', 'avg1-holo'
]);
const METRIC_LABELS = Object.freeze({
  trend: 'Trend price', avg: 'Average selling price', avg1: '1-day average',
  avg7: '7-day average', avg30: '30-day average',
  'trend-holo': 'Trend price', 'avg-holo': 'Average selling price',
  'avg1-holo': '1-day average', 'avg7-holo': '7-day average', 'avg30-holo': '30-day average'
});
/** @param {string} metric @returns {string} */
export function cardmarketMetricLabel(metric) {
  return Object.hasOwn(METRIC_LABELS, metric)
    ? METRIC_LABELS[/** @type {keyof typeof METRIC_LABELS} */ (metric)] : 'Provider reference';
}
/** @param {string} variant @returns {string} */
export function cardmarketGroupLabel(variant) {
  return variant === 'holo-reference' ? 'Holo-category reference' : 'Card-level reference';
}
/** @param {DisplayQuote} quote @returns {boolean} */
function validReference(quote) {
  return !!quote && quote.source === 'Cardmarket' && quote.currency === 'EUR'
    && CARDMARKET_REFERENCE_METRICS.includes(quote.metric)
    && quote.variant === (quote.metric.endsWith('-holo') ? 'holo-reference' : 'card-reference')
    && typeof quote.amount === 'number' && Number.isFinite(quote.amount)
    && quote.amount > 0 && quote.amount <= 10000000;
}
/**
 * Pick one representative metric per provider category, not per card printing.
 * Prefer a usable observation, then trend / 30-day / 7-day / average / 1-day.
 * Keep the original metric, currency, age and failure flags. Never average them.
 * @param {readonly DisplayQuote[]} [references]
 * @returns {DisplayQuote[]}
 */
export function cardmarketHighlights(references = []) {
  const valid = references.filter(validReference), result = [];
  for (const variant of ['card-reference', 'holo-reference']) {
    const candidates = valid.filter(quote => quote.variant === variant);
    const usable = candidates.filter(quote => !quote.stale && !quote.fetch_error);
    const pool = usable.length ? usable : candidates;
    for (const metric of CARDMARKET_REFERENCE_METRICS) {
      const quote = pool.find(value => value.metric === metric);
      if (quote) { result.push(quote); break; }
    }
  }
  return result;
}
/**
 * @typedef {Object} PricePanelState
 * @property {string|null} fetched_at
 * @property {string} [last_error]
 * @property {readonly DisplayQuote[]} [references]
 * @property {readonly {price: DisplayQuote|null}[]} [printings]
 */
/** @param {PricePanelState} state @returns {string} */
export function priceAvailabilityMessage(state) {
  if (state.last_error) return ''; // The panel shows the separate refresh-error alert.
  if (!state.fetched_at) return 'Prices have not been checked yet. Use Check prices to request the existing free feed.';
  if (state.printings?.some(printing => printing.price)) return '';
  if (cardmarketHighlights(state.references).length) {
    return 'Cardmarket reference prices are available below. An exact printing match is not confirmed; these can contribute labelled approximations to collection estimates.';
  }
  return 'The current feed returned no supported price for this card. This does not mean that the marketplaces have no listings.';
}
/**
 * @param {{key: string, source: string}} printing
 * @param {{fetched_at: string|null, last_error?: string}} state
 * @returns {string}
 */
export function missingPrintingMessage(printing, state) {
  if (!state.fetched_at) return state.last_error ? 'The first price check failed.' : 'Not checked yet.';
  const labels = { normal: 'Normal', holo: 'Holo', reverse: 'Reverse holo' };
  if (printing.source !== 'tcgdex' || !Object.hasOwn(labels, printing.key)) {
    return 'This printing does not have a supported exact market-price mapping.';
  }
  const label = labels[/** @type {keyof typeof labels} */ (printing.key)];
  return `No matched TCGplayer ${label} market price in the last successful feed response.`;
}
