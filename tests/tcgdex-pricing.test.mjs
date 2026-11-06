import test from 'node:test';
import assert from 'node:assert/strict';
import { extractTcgdexMarkets,mergeMarketObservations } from '../lib/tcgdex-pricing.mjs';
import { displayPrice,valueRows } from '../lib/price-logic.mjs';
import { tcgplayerProductUrl } from '../shared/price-display.mjs';
const at='2026-11-06T10:00:00.000Z',earlier='2026-11-05T10:00:00.000Z';
const tcg=(amount,updated=at)=>({unit:'USD',updated,normal:{marketPrice:amount,lowPrice:1,midPrice:2,highPrice:99,directLowPrice:1.5,productId:123}});
const cm={unit:'EUR',updated:at,trend:3};
test('market prices stay separate from asking metrics and numeric product links',()=>{
  const p=extractTcgdexMarkets({tcgplayer:tcg(4),cardmarket:cm});assert.equal(p.quotes[0].amount,4);assert.equal(p.metrics.length,4);assert.equal(p.references[0].amount,3);assert.equal(p.quotes[0].product_id,123);
  assert.equal(tcgplayerProductUrl(123),'https://www.tcgplayer.com/product/123');for(const v of ['123','javascript:alert(1)',-1,Infinity])assert.equal(tcgplayerProductUrl(v),null);
});
test('variant-scoped blocks cannot leak their other finishes into the chosen variant',()=>{
  const detailed=[{type:'reverse',size:'standard',variantId:'reverse-abc',thirdParty:{tcgplayer:123},pricing:{tcgplayer:{...tcg(900),'reverse-holofoil':{marketPrice:5,productId:123}}}}];
  const result=extractTcgdexMarkets(null,detailed);assert.deepEqual(result.quotes.map(q=>[q.variant,q.amount]),[['reverse',5]]);assert.equal(result.quotes[0].provider_variant_id,'reverse-abc');
});
test('unambiguous detailed data wins over card-root pricing; IDs must agree',()=>{
  const detail={type:'normal',thirdParty:{tcgplayer:123},pricing:{tcgplayer:tcg(5)}};
  assert.equal(extractTcgdexMarkets({tcgplayer:tcg(100)},[detail]).quotes[0].amount,5);
  assert.equal(extractTcgdexMarkets({tcgplayer:tcg(100)},[{...detail,thirdParty:{tcgplayer:999}}]).quotes.length,0);
  assert.equal(extractTcgdexMarkets({tcgplayer:tcg(100)},[{...detail,thirdParty:{tcgplayer:'999'}}]).quotes.length,0);
  assert.equal(extractTcgdexMarkets({tcgplayer:tcg(100)},[detail,{...detail,variantId:'another'}]).quotes.length,0);
});
test('jumbo, stamps and named foil patterns never inherit a plain printing price',()=>{
  for(const extra of [{size:'jumbo'},{stamp:['1st edition']},{stamp:'pre-release'},{foil:'pokeball'},{subtype:'special'}])assert.equal(extractTcgdexMarkets({tcgplayer:tcg(100)},[{type:'normal',...extra,pricing:{tcgplayer:tcg(10)}}]).quotes.length,0);
});
test('provider omissions preserve last-received dates and exclude retained matched values',()=>{
  const first=mergeMarketObservations(null,extractTcgdexMarkets({tcgplayer:tcg(4),cardmarket:cm}),earlier);
  const next=mergeMarketObservations({...first,fetched_at:earlier},extractTcgdexMarkets({cardmarket:cm}),at);
  assert.equal(next.quotes[0].amount,4);assert.equal(next.quotes[0].received_at,earlier);assert.equal(next.quotes[0].retained,true);assert.equal(next.references[0].retained,undefined);assert.equal(next.providers.TCGplayer.state,'missing');
  const rates=[{currency:'USD',aud_rate:1.5,rate_date:'2026-11-06'},{currency:'EUR',aud_rate:1.6,rate_date:'2026-11-06'}];
  assert.equal(displayPrice(next.quotes[0],{fetched_at:at},rates,Date.parse(at)).fetch_error,true);
  const v=valueRows([{source:'tcgdex',key:'normal',quantity:1,...next,reference_prices:next.references,fetched_at:at}],rates,Date.parse(at));assert.equal(v.matched_quantity,0);assert.equal(v.approximate_quantity,1);
});
test('older provider snapshots cannot replace a newer observation or refresh its age',()=>{
  const first=mergeMarketObservations(null,extractTcgdexMarkets({tcgplayer:tcg(4)}),at);
  const next=mergeMarketObservations(first,extractTcgdexMarkets({tcgplayer:tcg(99,earlier)}),'2026-11-07T10:00:00Z');
  assert.equal(next.quotes[0].amount,4);assert.equal(next.quotes[0].received_at,at);assert.equal(next.quotes[0].retention_reason,'older');
  const restored=mergeMarketObservations(next,extractTcgdexMarkets({tcgplayer:tcg(5,'2026-11-07T09:00:00Z')}),'2026-11-07T10:00:00Z');assert.equal(restored.quotes[0].amount,5);assert.equal(restored.quotes[0].retained,undefined);
});
test('a future provider timestamp cannot poison the cache or block recovery',()=>{
  const first=mergeMarketObservations(null,extractTcgdexMarkets({tcgplayer:tcg(4)}),at);
  const bad=mergeMarketObservations(first,extractTcgdexMarkets({tcgplayer:tcg(99,'2099-01-01T00:00:00Z')}),at);
  assert.equal(bad.quotes[0].amount,4);assert.equal(bad.quotes[0].retained,true);
  const poisoned=mergeMarketObservations(null,extractTcgdexMarkets({tcgplayer:tcg(99,'2099-01-01T00:00:00Z')}),at);
  const recovered=mergeMarketObservations(poisoned,extractTcgdexMarkets({tcgplayer:tcg(5)}),at);
  assert.equal(recovered.quotes[0].amount,5);assert.equal(recovered.quotes[0].retained,undefined);
});
