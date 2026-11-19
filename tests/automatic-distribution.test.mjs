import test from 'node:test';
import assert from 'node:assert/strict';
import {automaticDistributionRules as rules,distributionProducts,tcgcsvPrintingFinishes} from '../lib/automatic-distribution.mjs';
import {providerPrintings} from '../lib/variants.mjs';
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

test('exact set and collector-number match recovers finishes sharing one product ID',()=>{
 const card={...raw,pricing:{},variants:{normal:true,reverse:false}};
 const listing={...entry,finishes:new Set(['normal','reverse'])};
 const finishes=tcgcsvPrintingFinishes(card,'en',[listing]);
 assert.deepEqual(providerPrintings(card.variants,card,'en',finishes).map(p=>p.key),['normal','reverse']);
 assert.deepEqual(providerPrintings(card.variants,card,'en',finishes)[1].metadata,{basis:'tcgcsv_finish',flag:'reverse'});
 assert.deepEqual(tcgcsvPrintingFinishes(card,'ja',[listing]),[]);
 assert.deepEqual(tcgcsvPrintingFinishes(card,'en',[listing,listing]),[]);
 assert.deepEqual(tcgcsvPrintingFinishes({...card,localId:'002'},'en',[listing]),[]);
 assert.deepEqual(tcgcsvPrintingFinishes(card,'en',[{...listing,group:{...listing.group,name:'Deck Exclusives'}}]),[]);
 assert.deepEqual(tcgcsvPrintingFinishes(card,'en',[{...listing,product:{...listing.product,name:'Heracross - Cosmos Holo'}}]),[]);
 const stamped={...card,variants_detailed:[{type:'reverse',stamp:['staff']}]};
 assert.deepEqual(providerPrintings(card.variants,stamped,'en',finishes).map(p=>p.key),['normal']);
});

test('market finish evidence preserves genuine Normal without inventing extra ex finishes',()=>{
 const card={variants_detailed:[{type:'normal',variantId:'generated'}]};
 assert.deepEqual(providerPrintings({normal:true},card,'en',['holo']).map(p=>p.key),['holo']);
 assert.deepEqual(providerPrintings({normal:true},card,'en',['normal','reverse']).map(p=>p.key),['normal','reverse']);
});

test('set feed joins only recognised finish rows to their product IDs',async t=>{
 const fixtures={
  groups:[{...entry.group,categoryId:3}],
  '34/products':[entry.product],
  '34/prices':[
   {productId:12,subTypeName:'Normal'},
   {productId:12,subTypeName:'Reverse Holofoil'},
   {productId:12,subTypeName:'Reverse Holofoil'},
   {productId:12,subTypeName:'Cosmos Holofoil'},
   {productId:13,subTypeName:'Holofoil'},
  ],
 };
 t.mock.method(globalThis,'fetch',async url=>{
  const path=url.split('/tcgplayer/3/')[1];
  assert.ok(Object.hasOwn(fixtures,path));
  return Response.json({success:true,results:fixtures[path]});
 });
 const listings=await distributionProducts('Delta Reign');
 assert.deepEqual(tcgcsvPrintingFinishes(raw,'en',listings),['normal','reverse']);
});

test('Delta Reign Nidoran♀ matches Nidoran F without matching Nidoran M',()=>{
 const card={...raw,id:'me06-055',name:'Nidoran♀',localId:'055',variants:{normal:true,reverse:false}};
 const listing={...entry,product:{...entry.product,name:'Nidoran F',extendedData:[{name:'Number',value:'055/103'}]},
  finishes:new Set(['normal','reverse'])};
 const finishes=tcgcsvPrintingFinishes(card,'en',[listing]);
 assert.deepEqual(providerPrintings(card.variants,card,'en',finishes).map(p=>p.key),['normal','reverse']);
 assert.equal(rules(card,'en',[listing])[0].distribution,'regular');
 assert.deepEqual(tcgcsvPrintingFinishes({...card,name:'Nidoran♂'},'en',[listing]),[]);
 assert.deepEqual(tcgcsvPrintingFinishes({...card,name:'Nidoran'},'en',[listing]),[]);
});
