import test from 'node:test';
import assert from 'node:assert/strict';
import {normaliseGameSets,normaliseYugiohSet,normaliseMtgSet,mtgPriceData,gameQuoteForPrinting,gameReferenceForPrinting,providerAmount} from '../lib/game-provider-logic.mjs';
import {providerUrl,scryfallImageUrl,validateProviderPayload,boundedBytes} from '../lib/game-transport-logic.mjs';
import {estimateForPrinting,valueRows,quoteForPrinting} from '../lib/price-logic.mjs';
import {ygoFixture,mtgFixture,FRONT,BACK,ART,DAY} from './helpers/game-fixtures.mjs';
const now=Date.parse(DAY+'T12:00:00Z');const rates=[{currency:'USD',aud_rate:1.5,rate_date:DAY},{currency:'EUR',aud_rate:1.7,rate_date:DAY}];
const cache=(pricing)=>({...pricing,reference_prices:pricing.references,fetched_at:DAY,last_error:''});

test('YGO sets with a reused code are distinguished by the complete set name',()=>{
  const sets=normaliseGameSets('yugioh',[{set_name:'A',set_code:'ABC',num_of_cards:1},{set_name:'B',set_code:'ABC',num_of_cards:2}]);
  assert.notEqual(sets[0].code,sets[1].code);assert.equal(sets[0].source_code,'ABC');
});
test('Magic set catalogue excludes online and foreign-only releases',()=>{
  const sets=normaliseGameSets('mtg',{data:[{name:'A',code:'ABC',totalSetSize:1},{name:'B',code:'BCD',isOnlineOnly:true},{name:'C',code:'CDE',isForeignOnly:true}]});
  assert.equal(sets.length,1);assert.equal(sets[0].code,'ABC');
});
for(const value of [null,{},'bad',{data:[]},[{name:'A',set_code:'../bad'}]])test('malformed YGO set catalogue is not accepted '+JSON.stringify(value),()=>assert.throws(()=>normaliseGameSets('yugioh',value)));
test('YGO card identity includes set number and rarity printings stay separate',()=>{
  const {set,payload}=ygoFixture(),cards=normaliseYugiohSet(set,payload),c=cards[0];
  assert.equal(cards.length,1);assert.equal(c.game,'yugioh');assert.match(c.id,/^yugioh:en:/);assert.equal(c.local_id,'DEMO-EN001');assert.equal(c.printings.length,2);
  assert.ok(c.printings.every(p=>p.label.includes('edition unspecified')));assert.equal(c.pricing.quotes.length,0);
  assert.equal(c.pricing.references.length,4);assert.equal(c.raw_data.image_remote_id,'123456');assert.equal(c.image_url,null);
  assert.ok(!JSON.stringify(c).includes('999'));assert.ok(!JSON.stringify(c).includes('untrusted.example'));
});
test('YGO set and general prices are approximate and never invent a source date',()=>{
  const {set,payload}=ygoFixture(),c=normaliseYugiohSet(set,payload)[0];
  assert.ok(c.pricing.references.every(q=>q.approximate&&q.source_updated_at===null));
  assert.equal(c.pricing.references.find(q=>q.source==='Cardmarket').currency,'EUR');
});
test('conflicting set/rarity prices do not select the cheapest arbitrary value',()=>{
  const {set,payload}=ygoFixture();payload.data[0].card_sets.push({...payload.data[0].card_sets[0],set_price:'100'});
  const c=normaliseYugiohSet(set,payload)[0];assert.equal(c.pricing.references.filter(q=>q.metric==='setPrice').length,1);
});
test('YGO incomplete pagination fails instead of declaring a complete set',()=>{
  const {set,payload}=ygoFixture();payload.meta={next_page:'https://evil.example'};assert.throws(()=>normaliseYugiohSet(set,payload));
});
test('YGO no match cannot substitute another set',()=>{
  const {set,payload}=ygoFixture();assert.deepEqual(normaliseYugiohSet({...set,name:'Wrong'},payload),[]);
});
test('Magic double-faced card becomes one owned card with two displayed faces',()=>{
  const {set,payload}=mtgFixture(),cards=normaliseMtgSet(set,payload),c=cards[0];
  assert.equal(cards.length,1);assert.equal(c.id,'mtg:en:mtg-'+FRONT);assert.equal(c.raw_data.faces.length,2);
  assert.equal(c.raw_data.faces[1].text,'Back rules.');assert.equal(c.raw_data.scryfall_id,ART);
  assert.deepEqual(c.printings.map(p=>p.key),['normal','foil','etched']);assert.equal(c.image_url,null);
});
test('Magic skips non-English and digital cards rather than calling them English paper cards',()=>{
  const {set,payload}=mtgFixture();payload.data.cards[0].language='Japanese';assert.equal(normaliseMtgSet(set,payload).length,0);
  payload.data.cards[0].language='English';payload.data.cards[0].availability=['mtgo'];assert.equal(normaliseMtgSet(set,payload).length,0);
});
test('Magic identity and declared finishes are required',()=>{
  const {set,payload}=mtgFixture();assert.throws(()=>normaliseMtgSet({...set,source_code:'OTHER'},payload));
  payload.data.cards[0].finishes=undefined;assert.throws(()=>normaliseMtgSet(set,payload));
});
test('Magic daily prices use printing UUID, finish, actual date and original currency',()=>{
  const {set,payload,feed}=mtgFixture(),c=normaliseMtgSet(set,payload)[0],p=mtgPriceData(c,feed,now);
  assert.deepEqual(p.quotes.map(q=>q.amount),[10,20,30]);assert.deepEqual(p.references.map(q=>q.amount),[8,16,24]);
  assert.ok(p.quotes.every(q=>q.source_updated_at===DAY+'T00:00:00.000Z'&&q.metric==='retail'));
  assert.ok(!JSON.stringify(p).includes('999'));assert.deepEqual(mtgPriceData({...c,raw_data:{mtgjson_uuid:BACK}},feed,now),{quotes:[],references:[]});
});
test('newest explicit zero and missing current quote do not resurrect an older positive price',()=>{
  const {set,payload,feed}=mtgFixture(),c=normaliseMtgSet(set,payload)[0];
  feed.data[FRONT].paper.tcgplayer.retail.normal={'2026-09-17':80,[DAY]:0};
  const p=mtgPriceData(c,feed,now);assert.ok(!p.quotes.some(q=>q.variant==='normal'));
});
test('Magic can use Card Kingdom retail USD without calling it a market sale',()=>{
  const {set,payload,feed}=mtgFixture(),c=normaliseMtgSet(set,payload)[0];
  feed.data[FRONT].paper={cardkingdom:{currency:'USD',retail:{normal:{[DAY]:9}},buylist:{normal:{[DAY]:4}}}};
  const p=mtgPriceData(c,feed,now);assert.equal(p.references[0].source,'Card Kingdom');assert.equal(p.references[0].amount,9);assert.equal(p.quotes.length,0);
});
for(const n of ['-1','1e6',' NaN','',NaN,Infinity,0,-1,10000001])test('provider amount rejects '+String(n),()=>assert.equal(providerAmount(n),null));
test('documented decimal strings are normalised once at the provider boundary',()=>{assert.equal(providerAmount('0.35'),0.35);assert.equal(providerAmount('10'),10);});
test('new-game pricing cannot become a Pokémon printing quote or cross provider identities',()=>{
  const {set,payload,feed}=mtgFixture(),c=normaliseMtgSet(set,payload)[0],p=mtgPriceData(c,feed,now);
  assert.equal(quoteForPrinting({key:'normal',source:'tcgdex'},p.quotes),null);
  assert.equal(gameQuoteForPrinting({key:'foil',source:'mtgjson'},p.quotes).amount,20);
  assert.equal(gameQuoteForPrinting({key:'holo',source:'mtgjson'},p.quotes),null);
  assert.equal(gameReferenceForPrinting({key:'normal',source:'ygoprodeck'},p.references),null);
});
test('a YGO set quote is preferred, with general Cardmarket and TCGplayer fallbacks labelled approximate',()=>{
  const {set,payload}=ygoFixture(),c=normaliseYugiohSet(set,payload)[0],p=c.printings[0];
  assert.equal(estimateForPrinting(p,cache(c.pricing),rates,now).metric,'setPrice');
  let refs=c.pricing.references.filter(q=>q.metric==='lowestAcrossPrintings');
  assert.equal(estimateForPrinting(p,cache({quotes:[],references:refs}),rates,now).source,'Cardmarket');
  refs=refs.filter(q=>q.source==='TCGplayer');const value=estimateForPrinting(p,cache({quotes:[],references:refs}),rates,now);
  assert.equal(value.source,'TCGplayer');assert.equal(value.approximate,true);assert.equal(value.stale,true);
});
test('mixed-game estimates count one source per copy without mixing currencies',()=>{
  const y=ygoFixture(),yc=normaliseYugiohSet(y.set,y.payload)[0],m=mtgFixture(),mc=normaliseMtgSet(m.set,m.payload)[0];
  const rows=[{...yc.printings[0],...cache(yc.pricing),quantity:2},{...mc.printings[0],...cache(mtgPriceData(mc,m.feed,now)),quantity:1}];
  const value=valueRows(rows,rates,now);assert.equal(value.aud_total,22.5);assert.equal(value.priced_quantity,3);
  assert.equal(value.approximate_quantity,2);assert.equal(value.approximate_aud_total,7.5);assert.equal(value.matched_aud_total,15);
});
test('missing FX never becomes a 1:1 conversion of new-game prices',()=>{
  const y=ygoFixture(),c=normaliseYugiohSet(y.set,y.payload)[0];const result=valueRows([{...c.printings[0],...cache(c.pricing),quantity:1}],[],now);
  assert.equal(result.aud_total,null);assert.equal(result.fx_missing_quantity,1);
});
test('reference selectors reject wrong currencies and malformed cached rows',()=>{
  assert.equal(gameReferenceForPrinting({source:'mtgjson',key:'normal'},[null,{provider:'mtgjson',source:'Cardmarket',currency:'USD',amount:12,variant:'normal',metric:'retail'}]),null);
  assert.equal(gameQuoteForPrinting({source:'mtgjson',key:'normal'},null),null);
});
test('request URLs are fixed operations and untrusted set names are query-encoded',()=>{
  assert.equal(new URL(providerUrl('ygo-set','A&redirect=https://evil.test')).hostname,'db.ygoprodeck.com');
  assert.equal(new URL(providerUrl('ygo-set','A&B')).searchParams.get('cardset'),'A&B');
  assert.equal(providerUrl('mtg-set','DEMO'),'https://mtgjson.com/api/v5/DEMO.json');
  for(const [kind,id] of [['unknown',''],['mtg-set','../../x'],['ygo-card','https://evil.test'],['ygo-image','123/../a'],['scryfall-card','x']])assert.throws(()=>providerUrl(kind,id));
});
test('Scryfall artwork permits only its expected HTTPS image host and path',()=>{
  assert.ok(scryfallImageUrl('https://cards.scryfall.io/normal/front/3/3/'+ART+'.jpg?1'));
  for(const url of ['https://evil.test/normal/front/3/3/'+ART+'.jpg','http://cards.scryfall.io/a','https://cards.scryfall.io:8443/a','https://cards.scryfall.io/../../a','javascript:alert(1)'])assert.equal(scryfallImageUrl(url),null);
});
test('provider validation rejects error, wrong identity and incomplete cache candidates',()=>{
  assert.throws(()=>validateProviderPayload('mtg-prices','',{error:'unavailable'}));
  assert.throws(()=>validateProviderPayload('scryfall-card',ART,{id:ART,object:'card',lang:'ja'}));
  assert.throws(()=>validateProviderPayload('ygo-card','123',{data:[{id:124}]}));
  assert.throws(()=>validateProviderPayload('ygo-set','x',{data:[{id:123}],meta:{next_page:'more'}}));
  const f=mtgFixture();assert.equal(validateProviderPayload('mtg-prices','',f.feed),f.feed);
});
test('provider downloads enforce a decoded size cap and never treat HTTP errors as prices',async()=>{
  assert.equal((await boundedBytes(new Response('hello'),5)).toString(),'hello');
  await assert.rejects(()=>boundedBytes(new Response('sixsix'),5));await assert.rejects(()=>boundedBytes(new Response('{}',{status:429}),100));
});
