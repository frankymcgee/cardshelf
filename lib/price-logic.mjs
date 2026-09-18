// TCGdex market schema: https://tcgdex.dev/markets-prices
// Marketplace mappings are provider-supplied, not a condition appraisal.
import { CARDMARKET_REFERENCE_METRICS, cardmarketHighlights } from '../shared/price-display.mjs';
const DAY = 86400000;
// The card reference documents holofoil/reverse-holofoil; older examples use
// holo/reverse. Edition-specific categories are deliberately NOT aliases.
/** @type {Array<[string, string[]]>} */
const TCGPLAYER_VARIANTS = [
  ['normal', ['normal']], ['holo', ['holo', 'holofoil']],
  ['reverse', ['reverse', 'reverse-holofoil']]
];
export function positiveAmount(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 10000000 ? value : null;
}
function timestamp(value) {
  if(typeof value!=='string'||!Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
}
export function extractPricing(pricing) {
  const quotes=[], references=[];
  const tcg=pricing?.tcgplayer;
  if(tcg?.unit==='USD') for(const [variant,keys] of TCGPLAYER_VARIANTS) {
    const amounts=keys.filter(key=>Object.hasOwn(tcg,key))
      .map(key=>positiveAmount(tcg[key]?.marketPrice)).filter(amount=>amount!==null);
    // Duplicate aliases with conflicting amounts do not prove a unique quote.
    if(!amounts.length||new Set(amounts).size!==1) continue;
    const amount=amounts[0];
    if(amount!==null) quotes.push({source:'TCGplayer',variant,currency:'USD',metric:'marketPrice',amount,source_updated_at:timestamp(tcg.updated)});
  }
  // Cardmarket's aggregate/holo fields do not prove a match to our printing key.
  // Keep them distinct from exact quotes; estimates may explicitly use a labelled fallback.
  const cm=pricing?.cardmarket;
  if(cm?.unit==='EUR') for(const metric of CARDMARKET_REFERENCE_METRICS) {
    const amount=positiveAmount(cm[metric]);
    if(amount!==null) references.push({source:'Cardmarket',variant:metric.endsWith('-holo')?'holo-reference':'card-reference',currency:'EUR',metric,amount,source_updated_at:timestamp(cm.updated)});
  }
  return {quotes,references};
}
export function quoteForPrinting(printing,quotes=[]) {
  if(printing.source!=='tcgdex'||!['normal','holo','reverse'].includes(printing.key)) return null;
  return quotes.find(q=>q.source==='TCGplayer'&&q.variant===printing.key&&q.currency==='USD'&&q.metric==='marketPrice'&&positiveAmount(q.amount)!==null)??null;
}
export function isStaleQuote(quote,fetchedAt,now=Date.now()) {
  const source=Date.parse(quote?.source_updated_at??''), fetched=Date.parse(fetchedAt??'');
  return !Number.isFinite(source)||!Number.isFinite(fetched)||source>now+DAY||fetched>now+DAY||now-source>3*DAY||now-fetched>2*DAY;
}
export function audConversion(quote,rates,now=Date.now()) {
  if(!quote||positiveAmount(quote.amount)===null) return null;
  const fx=rates.find(r=>r.currency===quote.currency);
  if(!fx) return null;
  const date=fx.rate_date instanceof Date?fx.rate_date.toISOString().slice(0,10):String(fx.rate_date).slice(0,10);
  const time=Date.parse(date+'T00:00:00Z'),rate=Number(fx.aud_rate);
  if(!Number.isFinite(time)||time>now+DAY||now-time>7*DAY||!Number.isFinite(rate)||rate<=0) return null;
  return {amount:quote.amount*rate,currency:'AUD',rate,rate_date:date};
}
export function displayPrice(quote,cache,rates,now=Date.now()) {
  if(!quote) return null;
  const converted=audConversion(quote,rates,now);
  return {...quote,aud:converted?Math.round(converted.amount*100)/100:null,fx_date:converted?.rate_date??null,
    fx_rate:converted?.rate??null,stale:isStaleQuote(quote,cache?.fetched_at,now),fetch_error:!!cache?.last_error};
}
/**
 * A display/estimate selection, deliberately separate from quoteForPrinting().
 * Exact matching remains exact. Cardmarket can fill a missing/unusable quote,
 * but is always labelled approximate, even for a provider holo-category value.
 */
export function estimateForPrinting(printing, cache, rates, now=Date.now()) {
  const quotes=Array.isArray(cache?.quotes)?cache.quotes:[];
  const matched=displayPrice(quoteForPrinting(printing,quotes),cache,rates,now);
  if(matched && !matched.stale && !matched.fetch_error && matched.aud!==null) return {...matched,approximate:false};
  const raw=Array.isArray(cache?.reference_prices)?cache.reference_prices:[];
  const highlights=cardmarketHighlights(raw.map(q=>displayPrice(q,cache,rates,now)).filter(Boolean));
  const preferred=printing.key==='holo'?'holo-reference':'card-reference';
  const usable=highlights.filter(q=>!q.stale&&!q.fetch_error&&q.aud!==null);
  const pool=usable.length?usable:highlights;
  const reference=pool.find(q=>q.variant===preferred)||pool[0];
  if(reference) return {...reference,approximate:true,mapping_confirmed:false,
    estimate_note:'Cardmarket approximation; exact printing, sale language and condition are not verified.'};
  return matched?{...matched,approximate:false}:null;
}
export function valueRows(rows,rates,now=Date.now()) {
  let total=0,priced=0,unpriced=0,stale=0,fxMissing=0,qty=0;
  let approximate=0,approximateTotal=0,matchedTotal=0,staleReferences=0,failedReferences=0;
  const sources={};
  for(const row of rows) {
    const quantity=Number(row.quantity);
    if(!Number.isSafeInteger(quantity)||quantity<=0) continue;
    qty+=quantity;
    const quote=estimateForPrinting(row,row,rates,now);
    if(!quote) {unpriced+=quantity;continue;}
    // A stale/failed EXACT quote remains excluded. A last-known Cardmarket
    // approximation stays in the estimate, visibly itemised as requested.
    if(!quote.approximate && (quote.stale||quote.fetch_error)) {stale+=quantity;continue;}
    const converted=audConversion(quote,rates,now);
    if(!converted) {fxMissing+=quantity;continue;}
    const amount=converted.amount*quantity;
    total+=amount;priced+=quantity;
    if(quote.approximate) {
      approximate+=quantity;approximateTotal+=amount;
      if(quote.stale) staleReferences+=quantity;
      if(quote.fetch_error) failedReferences+=quantity;
    } else matchedTotal+=amount;
    sources[quote.currency]=(sources[quote.currency]??0)+quote.amount*quantity;
  }
  return {aud_total:priced?Math.round(total*100)/100:null,quantity:qty,priced_quantity:priced,
    unpriced_quantity:unpriced,stale_quantity:stale,fx_missing_quantity:fxMissing,
    matched_quantity:priced-approximate,approximate_quantity:approximate,
    matched_aud_total:Math.round(matchedTotal*100)/100,approximate_aud_total:Math.round(approximateTotal*100)/100,
    stale_reference_quantity:staleReferences,failed_reference_quantity:failedReferences,
    source_totals:Object.fromEntries(Object.entries(sources).map(([k,v])=>[k,Math.round(v*100)/100]))};
}
