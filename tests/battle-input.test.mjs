import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { deckInput,envelope,code,hash } from '../lib/battle/input.mjs';
import { battleAdapter } from '../lib/battle/adapters/index.mjs';
import { cardSnapshot,safeArtwork,validateDeck } from '../lib/battle/adapters/pokemon.mjs';
import { syntheticCard,syntheticDeck } from './helpers/battle-fixtures.mjs';
const valid=()=>({title:'Practice deck',game:'pokemon',cards:[{card_id:'en:demo-1',quantity:4}],revision:0,request_id:randomUUID()});
test('draft deck input is strictly bounded and does not accept user or ownership fields',()=>{
  assert.equal(deckInput(valid()).cards[0].quantity,4);assert.deepEqual(deckInput({...valid(),cards:[]}).cards,[]);
  for(const key of ['user_id','quantity','wishlist','price','role','wins','game_state'])assert.throws(()=>deckInput({...valid(),[key]:'injected'}));
});
for(const game of ['mtg','yugioh','__proto__','constructor','Pokemon',null])test('unsupported adapter and client game cannot activate '+game,()=>{assert.throws(()=>battleAdapter(game));assert.throws(()=>deckInput({...valid(),game}));});
for(const quantity of [0,-1,61,1.5,'4',null,true,Infinity])test('invalid saved quantity '+quantity,()=>assert.throws(()=>deckInput({...valid(),cards:[{card_id:'en:demo-1',quantity}]})));
for(const card_id of ['ja:demo-1','mtg:en:x','en:../x','en:a/b','en:a?x','http://evil.test','en:<script>'])test('reject foreign/unsafe card identifier '+card_id,()=>assert.throws(()=>deckInput({...valid(),cards:[{card_id,quantity:1}]})));
test('duplicate card rows and total over 60 are rejected without implicit merging',()=>{
  assert.throws(()=>deckInput({...valid(),cards:[{card_id:'en:demo-1',quantity:1},{card_id:'en:demo-1',quantity:1}]}));
  assert.throws(()=>deckInput({...valid(),cards:[{card_id:'en:demo-1',quantity:40},{card_id:'en:demo-2',quantity:30}]}));
});
for(const value of [{},[],null,'anything',{revision:0,request_id:randomUUID(),action:{type:'draw'}},{revision:1,request_id:'x',action:{type:'draw'}},{revision:1,request_id:randomUUID(),action:'draw'},{revision:1,request_id:randomUUID(),action:{type:'coin'},state:{}}])test('action envelope rejects '+JSON.stringify(value),()=>assert.throws(()=>envelope(value)));
test('only cryptographic private invitation shape is accepted',()=>{assert.equal(code('  '+'b'.repeat(32)+' '),'b'.repeat(32));for(const v of ['',null,'https://site.test/abc','a'.repeat(31),'z'.repeat(32),'a'.repeat(33)])assert.throws(()=>code(v));});
test('game snapshot retains bounded rules text but removes prices, collection notes, raw metadata and IDs belonging to users',()=>{
  const c=cardSnapshot({id:'en:demo',game:'pokemon',language:'en',name:'Synthetic',local_id:'1',category:'Pokemon',notes:'private',quantity:4,user_id:'secret',raw_data:{category:'Pokemon',stage:'Basic',secret_key:'sensitive',pricing:{amount:10},effect:'x'.repeat(3000),attacks:[{name:'a',damage:10,effect:'y'.repeat(3000),cost:['Colorless']}],abilities:null}});
  assert.equal(c.effect.length,1500);assert.equal(c.attacks[0].effect.length,1500);assert.equal(c.attacks[0].damage,'10');for(const word of ['sensitive','private','secret_key','user_id','pricing'])assert.ok(!JSON.stringify(c).includes(word));
});
for(const image of ['javascript:alert(1)','https://assets.tcgdex.net.evil.test/en/x','https://user@assets.tcgdex.net/en/x','http://assets.tcgdex.net/en/x','https://assets.tcgdex.net:8443/en/x','https://assets.tcgdex.net/en/x?token=1','https://evil.test/x','data:image/svg+xml,x','/api/admin/users'])test('artwork cannot become arbitrary network target '+image,()=>assert.equal(safeArtwork(image),null));
test('approved artwork hosts and local cache IDs survive snapshotting',()=>{assert.equal(safeArtwork('https://assets.tcgdex.net/en/base/base1/1/high.webp'),'https://assets.tcgdex.net/en/base/base1/1/high.webp');assert.ok(safeArtwork('/api/public/catalogue/artwork/'+'a'.repeat(64)));});
test('sixty cards and at least one imported Basic are required to enter a match',()=>{
  assert.equal(validateDeck(syntheticDeck()).playable,true);assert.equal(validateDeck(syntheticDeck().slice(0,1)).playable,false);
  assert.equal(validateDeck([{card:syntheticCard('energy',{category:'Energy',raw_data:{category:'Energy',energyType:'Basic'}}),quantity:60}]).playable,false);
});
test('copy warnings combine names across different artwork/set identifiers',()=>{
  const basic=syntheticCard(),rows=[{card:{...basic,id:'en:first',name:'Practice name'},quantity:4},{card:{...basic,id:'en:second',name:'  PRACTICE   NAME '},quantity:4},...syntheticDeck().slice(2)];
  const v=validateDeck(rows);assert.ok(v.warnings.some(w=>w.includes('8 copies')));assert.ok(!v.warnings.some(w=>w.includes('52 copies')));
});
test('special Energy and unverified Energy are not given Basic Energy copy-limit exemptions',()=>{
  for(const energyType of ['Special','',undefined]){const c=syntheticCard('energy',{category:'Energy',raw_data:{category:'Energy',energyType}});assert.ok(validateDeck([{card:c,quantity:20}]).warnings.some(w=>w.includes('20 copies')));}
});
test('special format rules are expressly unverified and do not execute provider card effects',()=>{
  const rows=syntheticDeck();rows[0].card.effect='process.exit(1)';const v=validateDeck(rows);assert.ok(v.warnings.some(w=>w.includes('not validated')));assert.equal(v.playable,true);
});

test('idempotency intent hashes ignore object-key order, but never ordered card changes or action changes',()=>{
  assert.equal(hash({revision:1,action:{type:'draw',count:1}}),hash({action:{count:1,type:'draw'},revision:1}));
  assert.notEqual(hash({action:{type:'draw',count:1}}),hash({action:{type:'draw',count:2}}));
  assert.notEqual(hash([1,2]),hash([2,1]));
});
