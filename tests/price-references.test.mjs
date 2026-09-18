import test from 'node:test';
import assert from 'node:assert/strict';
import { extractPricing, quoteForPrinting, displayPrice, valueRows } from '../lib/price-logic.mjs';
import { CARDMARKET_REFERENCE_METRICS, cardmarketHighlights, cardmarketMetricLabel,
  cardmarketGroupLabel, priceAvailabilityMessage, missingPrintingMessage } from '../shared/price-display.mjs';

const date = '2026-09-18T00:00:00.000Z', now = Date.parse('2026-09-18T08:00:00Z');
const rates = [{currency:'EUR',aud_rate:1.7,rate_date:'2026-09-18'}, {currency:'USD',aud_rate:1.5,rate_date:'2026-09-18'}];
const cache = {fetched_at:date,last_error:''};
const printing = {source:'tcgdex',key:'holo'};
const reference = (metric='trend',amount=5) => ({source:'Cardmarket',currency:'EUR',metric,amount,
  variant:metric.endsWith('-holo')?'holo-reference':'card-reference',source_updated_at:date});
const tcg = data => extractPricing({tcgplayer:{unit:'USD',updated:date,...data}}).quotes;

test('screenshot-shaped Cardmarket-only Holo has a labelled approximation, not an invented exact match', () => {
  // Synthetic amounts, not a quote or captured response for Mega Delphox ex.
  const parsed = extractPricing({cardmarket:{unit:'EUR',updated:date,trend:5}});
  const references = parsed.references.map(q=>displayPrice(q,cache,rates,now));
  assert.equal(quoteForPrinting(printing,parsed.quotes),null);
  assert.equal(cardmarketHighlights(references)[0].aud,8.5);
  assert.match(priceAvailabilityMessage({...cache,references,printings:[{price:null}]}),/Cardmarket reference prices are available/);
  assert.match(missingPrintingMessage(printing,cache),/TCGplayer Holo/);
  const estimate=valueRows([{...printing,quotes:parsed.quotes,reference_prices:parsed.references,quantity:2,...cache}],rates,now);
  assert.equal(estimate.aud_total,17);assert.equal(estimate.approximate_aud_total,17);assert.equal(estimate.matched_quantity,0);
});

for (const metric of CARDMARKET_REFERENCE_METRICS) test(`extracts and labels Cardmarket ${metric} without turning it into a matched price`,()=>{
  const parsed = extractPricing({cardmarket:{unit:'EUR',updated:date,[metric]:5}});
  assert.deepEqual(parsed,{quotes:[],references:[reference(metric)]});
  assert.notEqual(cardmarketMetricLabel(metric),'Provider reference');
  assert.equal(quoteForPrinting(printing,parsed.references),null);
  assert.equal(cardmarketHighlights(parsed.references)[0].metric,metric);
});
for (const value of [null,undefined,0,-1,NaN,Infinity,'9.99',true,10000001]) test(`invalid reference amount remains absent: ${String(value)}`,()=>{
  assert.deepEqual(extractPricing({cardmarket:{unit:'EUR',updated:date,trend:value,avg30:value}}).references,[]);
  assert.deepEqual(cardmarketHighlights([{...reference(),amount:value}]),[]);
});
test('averages do not substitute lowest asking prices or unsupported currencies',()=>{
  assert.deepEqual(extractPricing({cardmarket:{unit:'EUR',low:1,'low-holo':2}}).references,[]);
  assert.deepEqual(extractPricing({cardmarket:{unit:'USD',trend:1,avg30:2}}).references,[]);
});
test('both metric families stay separate and trend wins over the numerically highest average',()=>{
  const refs = [reference('avg30',100),reference('trend-holo',8),reference('trend',5),reference('avg30-holo',90)];
  assert.deepEqual(cardmarketHighlights(refs).map(q=>q.metric),['trend','trend-holo']);
  assert.equal(cardmarketGroupLabel('holo-reference'),'Holo-category reference');
  assert.equal(cardmarketGroupLabel('card-reference'),'Card-level reference');
});
test('fallback preference is 30-day, 7-day, average, then 1-day, independently per family',()=>{
  for(const suffix of ['','-holo']) {
    const order = ['avg30','avg7','avg','avg1'].map(metric=>metric+suffix);
    for(let i=0;i<order.length;i++) {
      assert.equal(cardmarketHighlights(order.slice(i).reverse().map(metric=>reference(metric)))[0].metric,order[i]);
    }
  }
});
test('an available fresh average is preferred to a stale trend, preserving both raw observations',()=>{
  const stale = {...reference(),stale:true}, fresh = reference('avg30',4), refs=Object.freeze([stale,fresh]);
  assert.equal(cardmarketHighlights(refs)[0],fresh);assert.equal(refs[0],stale);assert.equal(refs.length,2);
});
test('all-stale references remain visible with their original age and failed-fetch flags',()=>{
  const refs=[{...reference(),stale:true,fetch_error:true},{...reference('avg30'),stale:true,fetch_error:true}];
  assert.equal(cardmarketHighlights(refs)[0],refs[0]);
  const shown=displayPrice({...reference(),source_updated_at:'2026-08-01T00:00:00Z'},{...cache,last_error:'offline'},rates,now);
  assert.equal(shown.stale,true);assert.equal(shown.fetch_error,true);assert.equal(shown.source_updated_at,'2026-08-01T00:00:00Z');
});
test('missing FX leaves the original EUR reference rather than pretending a 1:1 AUD price',()=>{
  const shown=displayPrice(reference(),cache,[],now);
  assert.equal(shown.aud,null);assert.equal(shown.currency,'EUR');assert.equal(shown.amount,5);
});
test('missing source timestamps are never fabricated from a fresh fetch',()=>{
  const parsed=extractPricing({cardmarket:{unit:'EUR',avg30:5}});
  assert.equal(parsed.references[0].source_updated_at,null);
  assert.equal(displayPrice(parsed.references[0],cache,rates,now).stale,true);
});
for(const change of [{source:'TCGplayer'},{currency:'USD'},{metric:'low'},{metric:'constructor'},
  {variant:'holo'},{variant:'holo-reference',metric:'trend'}]) test(`reference selection rejects incompatible metadata ${JSON.stringify(change)}`,()=>{
  assert.deepEqual(cardmarketHighlights([{...reference(),...change}]),[]);
});
test('unknown and inherited label keys cannot return JavaScript object properties',()=>{
  for(const metric of ['constructor','__proto__','toString','marketPrice'])assert.equal(cardmarketMetricLabel(metric),'Provider reference');
});
test('legacy trend-only caches can be highlighted immediately, without a migration or provider request',()=>{
  const legacy=[reference('trend'),reference('trend-holo')];
  assert.equal(cardmarketHighlights(legacy).length,2);
});
test('a successful empty provider response clears all old quote and reference values',()=>{
  assert.deepEqual(extractPricing({}),{quotes:[],references:[]});
  assert.match(priceAvailabilityMessage({...cache,printings:[],references:[]}),/current feed returned no supported price/);
});
test('not checked, refresh failed, references only, and matched prices have different messages',()=>{
  assert.match(priceAvailabilityMessage({fetched_at:null}),/not been checked yet/);
  assert.equal(priceAvailabilityMessage({...cache,last_error:'offline'}),'');
  assert.equal(priceAvailabilityMessage({...cache,printings:[{price:reference()}]}),'');
  assert.match(missingPrintingMessage(printing,{fetched_at:null} ),/Not checked yet/);
  assert.match(missingPrintingMessage(printing,{fetched_at:null,last_error:'offline'}),/first price check failed/);
  assert.match(missingPrintingMessage({source:'manual',key:'holo'},cache),/supported exact market-price mapping/);
});
for(const [key,variant] of [['holofoil','holo'],['reverse-holofoil','reverse'],['holo','holo'],['reverse','reverse'],['normal','normal']]) {
  test(`TCGdex ${key} is normalized only to ${variant}`,()=>{
    const quotes=tcg({[key]:{marketPrice:10}});
    assert.equal(quotes.length,1);assert.equal(quotes[0].variant,variant);
    assert.equal(quoteForPrinting({source:'tcgdex',key:variant},quotes).amount,10);
    const other=variant==='holo'?'reverse':'holo';
    assert.equal(quoteForPrinting({source:'tcgdex',key:other},quotes),null);
  });
}
test('matching duplicate aliases make one quote, while conflicting aliases fail closed',()=>{
  assert.equal(tcg({holo:{marketPrice:10},holofoil:{marketPrice:10}}).length,1);
  assert.equal(tcg({holo:{marketPrice:10},holofoil:{marketPrice:11}}).length,0);
  assert.equal(tcg({reverse:{marketPrice:10},'reverse-holofoil':{marketPrice:11}}).length,0);
});
test('null primary aliases can use a documented alias but low/mid/high do not become a market price',()=>{
  assert.equal(tcg({holo:{marketPrice:null},holofoil:{marketPrice:10}})[0].amount,10);
  assert.equal(tcg({holofoil:{lowPrice:1,midPrice:2,highPrice:3}}).length,0);
});
test('edition-specific prices cannot be collapsed into generic holo/normal/reverse quotes',()=>{
  const quotes=tcg({'1st-edition':{marketPrice:20},'1st-edition-holofoil':{marketPrice:40},unlimited:{marketPrice:15},'unlimited-holofoil':{marketPrice:30}});
  assert.deepEqual(quotes,[]);
  assert.equal(quoteForPrinting({source:'tcgdex',key:'firstEdition'},tcg({holofoil:{marketPrice:10}})),null);
});
test('inherited TCGplayer variant keys cannot create provider quotes',()=>{
  assert.deepEqual(extractPricing({tcgplayer:Object.assign(Object.create({holofoil:{marketPrice:10}}),{unit:'USD',updated:date})}).quotes,[]);
});
test('genuinely matched aliases use existing valuation safeguards without counting Cardmarket twice',()=>{
  const quotes=tcg({holofoil:{marketPrice:10}}), refs=[reference('trend',1000)];
  const row={...printing,quotes,reference_prices:refs,quantity:2,...cache};
  assert.equal(valueRows([row],rates,now).aud_total,30);
  assert.equal(valueRows([{...row,last_error:'offline'}],rates,now).aud_total,3400);
  assert.equal(valueRows([{...row,last_error:'offline'}],rates,now).failed_reference_quantity,2);
  assert.equal(valueRows([{...row,source:'manual'}],rates,now).approximate_quantity,2);
  assert.equal(valueRows([{...row,key:'reverse'}],rates,now).approximate_aud_total,3400);
});
