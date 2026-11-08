import test from 'node:test';
import assert from 'node:assert/strict';
import { providerPrintings, providerPrintingEvidence } from '../lib/variants.mjs';
const flags={normal:true,holo:false,reverse:false};
const market=finishes=>({pricing:{tcgplayer:{unit:'USD',...finishes}}});
const keys=(raw,language='en')=>providerPrintings(flags,raw,language).map(p=>p.key);

test('card-specific market finishes override false flags without losing existing choices',()=>{
  const raw=market({'holofoil':{marketPrice:0.15},'reverse-holofoil':{marketPrice:0.25}});
  assert.deepEqual(keys(raw),['normal','holo','reverse']);
  assert.equal(providerPrintingEvidence(flags,raw).flags.reverse,true);
  assert.equal(providerPrintings(flags,raw)[2].metadata.basis,'tcgplayer_finish');
  assert.ok(providerPrintings(flags,raw).every(p=>!p.verified));
});
test('detailed plain finishes supplement missing or false flags even without prices',()=>{
  assert.deepEqual(keys({variants_detailed:[{type:'holo',size:'standard',variantId:'123'}]}),['normal','holo']);
  assert.deepEqual(keys({variants_detailed:[{type:'holo',variantId:'generated'}]}),['normal']);
});
test('English markets never create Japanese finishes and language-scoped details are respected',()=>{
  assert.deepEqual(keys(market({'reverse-holofoil':{marketPrice:1}}),'ja'),['normal']);
  assert.deepEqual(keys({variants_detailed:[{type:'reverse',languages:['ja']}]}),['normal']);
});
test('stamped, jumbo and special foils are never flattened into plain finishes',()=>{
  for(const extra of [{stamp:['staff']},{size:'jumbo'},{subtype:'pokeball'},{foil:'cosmos'}]) {
    const raw={...market({'reverse-holofoil':{marketPrice:1}}),variants_detailed:[{type:'reverse',...extra}]};
    assert.deepEqual(keys(raw),['normal']);
  }
});
test('aggregate Cardmarket values, empty or invalid market rows do not invent finishes',()=>{
  for(const raw of [{pricing:{cardmarket:{unit:'EUR','avg-holo':1}}},market({holofoil:{}}),
    market({holofoil:{marketPrice:0}}),market({holofoil:{marketPrice:'1'}}),
    market({holofoil:{marketPrice:1,productId:-1}})]) assert.deepEqual(keys(raw),['normal']);
});
test('scoped product conflicts do not generate a finish and asking-price evidence can supply one',()=>{
  const raw={...market({holofoil:{productId:12,marketPrice:1}}),variants_detailed:[{type:'holo',variantId:'generated',thirdParty:{tcgplayer:13}}]};
  assert.deepEqual(keys(raw),['normal']);
  assert.deepEqual(keys(market({'reverse-holofoil':{lowPrice:0.1}})),['normal','reverse']);
});
test('a missing price is not evidence to remove a known normal or product-exclusive finish',()=>{
  assert.deepEqual(keys(market({holofoil:{marketPrice:1}})),['normal','holo']);
  assert.deepEqual(providerPrintings({normal:true,holo:true,reverse:true},{}).map(p=>p.key),['normal','holo','reverse']);
});
