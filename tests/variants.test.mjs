import test from 'node:test';
import assert from 'node:assert/strict';
import {providerPrintings,safeImageUrl} from '../lib/variants.mjs';
test('imports only explicit true provider flags',()=>{
  const result=providerPrintings({normal:true,holo:false,reverse:true,firstEdition:0,shadowless:'true'});
  assert.deepEqual(result.map(p=>p.key),['normal','reverse']);
});
test('edition flags do not invent finish combinations',()=>{
  const result=providerPrintings({holo:true,firstEdition:true});
  assert.equal(result.length,2);assert.equal(result[1].label,'First Edition — finish unspecified');
  assert.ok(result.every(p=>p.verified===false));
});
test('absent data has an explicit unspecified printing',()=>{
  for(const flags of [null,undefined,{},false]) assert.equal(providerPrintings(flags)[0].key,'unspecified');
});
test('canonical artwork links are constrained to the provider host',()=>{
  assert.equal(safeImageUrl('https://assets.tcgdex.net/en/base/base1/4'),'https://assets.tcgdex.net/en/base/base1/4/high.webp');
  for(const url of ['http://assets.tcgdex.net/x','https://assets.tcgdex.net.evil.test/x','https://user:pass@assets.tcgdex.net/x','javascript:alert(1)','https://127.0.0.1/x','https://assets.tcgdex.net/x?redirect=evil','https://assets.tcgdex.net:8443/x']) assert.equal(safeImageUrl(url),null);
});
