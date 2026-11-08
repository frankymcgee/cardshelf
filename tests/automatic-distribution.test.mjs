import test from 'node:test';
import assert from 'node:assert/strict';
import {automaticDistributionRules as rules} from '../lib/automatic-distribution.mjs';
const raw={id:'me06-001',name:'Heracross',localId:'001',set:{name:'Delta Reign'},pricing:{tcgplayer:{unit:'USD',normal:{productId:12,marketPrice:1}}}};
const entry={group:{groupId:34,name:'ME06: Delta Reign'},product:{productId:12,groupId:34,categoryId:3,name:'Heracross',extendedData:[{name:'Number',value:'001/103'}]}};
test('exact English product/collector-number/set matches confirm regular distribution',()=>{
 assert.equal(rules(raw,'en',[entry])[0].distribution,'regular');
 assert.equal(rules(raw,'en',[entry])[0].url,'https://www.tcgplayer.com/product/12');
});
test('exact deck-exclusive and promo group identities distinguish distribution',()=>{
 assert.equal(rules(raw,'en',[{...entry,group:{...entry.group,name:'Deck Exclusives'}}])[0].distribution,'product_exclusive');
 const promo={...raw,set:{name:'MEP Black Star Promos'}};
 assert.equal(rules(promo,'en',[{...entry,group:{...entry.group,name:'MEP Black Star Promos'}}])[0].distribution,'promo');
});
test('unmatched numbers, ambiguous products, wrong languages or sets remain unknown',()=>{
 for(const entries of [[],[entry,entry],[{...entry,product:{...entry.product,productId:13}}],[{...entry,product:{...entry.product,extendedData:[{name:'Number',value:'002/103'}]}}],[{...entry,group:{...entry.group,name:'Other set'}}]])assert.deepEqual(rules(raw,'en',entries),[]);
 assert.deepEqual(rules(raw,'ja',[entry]),[]);
 assert.deepEqual(rules({...raw,thirdParty:{tcgplayer:12},pricing:{}},'en',[entry]),[]);
});
test('stamp, jumbo, special foil and named exclusive products never become regular',()=>{
 for(const extra of [{stamp:['staff']},{size:'jumbo'},{foil:'cosmos'},{languages:['ja']}])assert.deepEqual(rules({...raw,variants_detailed:[{type:'normal',...extra}]},'en',[entry]),[]);
 assert.deepEqual(rules(raw,'en',[{...entry,product:{...entry.product,name:'Heracross (Cosmos Holo)'}}]),[]);
});
