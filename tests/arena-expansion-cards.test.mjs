import test from 'node:test';
import assert from 'node:assert/strict';
import { compileArenaCard, attackProgram, deckValidation, cardFingerprint } from '../lib/arena/cards.mjs';
import { ARENA_VERSION, LEGACY_ARENA_VERSION } from '../shared/arena.mjs';
import { trainingDeck } from '../lib/arena/training.mjs';
import { row } from './helpers/arena-fixtures.mjs';
const pokemon=(name,raw={})=>({...row(raw),name});
const trainer=(name,effect,trainerType='Item',extra={})=>({...row(),name,raw_data:{category:'Trainer',trainerType,effect,...extra}});
const compiled=input=>{const result=compileArenaCard(input);assert.equal(result.supported,true,result.reason);return result.card;};
const rejected=input=>assert.equal(compileArenaCard(input).supported,false);
// Small exact-text fixtures, not imported card datasets. Primary schema and
// reviewed source links are recorded beside the families they exercise.
// https://github.com/tcgdex/cards-database/blob/master/interfaces.d.ts

test('v2 dispatcher preserves frozen v1 compiler and rejects unknown versions',()=>{
  const cape=trainer('Synthetic Cape','The Pokemon this card is attached to gets +20 HP.','Tool');
  assert.equal(compileArenaCard(cape,LEGACY_ARENA_VERSION).supported,false);
  assert.equal(compiled(cape).compiler,ARENA_VERSION);
  assert.equal(compileArenaCard(row(),LEGACY_ARENA_VERSION).card.compiler,LEGACY_ARENA_VERSION);
  assert.throws(()=>compileArenaCard(row(),'unknown'));
  assert.equal(cardFingerprint({a:1}),cardFingerprint({a:1}));
  assert.notEqual(cardFingerprint({a:1}),cardFingerprint({a:2}));
});
test('EX and ex use distinct verified suffixes and both award two prizes',()=>{
  for(const suffix of ['EX','ex'])assert.equal(compiled(pokemon('Synthetic '+suffix,{suffix})).prizes,2);
  const evolved=compiled(pokemon('Synthetic ex',{suffix:'ex',stage:'Stage2',evolveFrom:'Parent'}));
  assert.equal(evolved.stage,'Stage2');assert.equal(evolved.rule_box,'ex');
  rejected(pokemon('Synthetic EX',{suffix:'EX',stage:'Stage1',evolveFrom:'Parent'}));
  rejected(pokemon('Synthetic ex'));rejected(pokemon('Synthetic ex',{suffix:'EX'}));
});
test('legacy provider MEGA and MegaEvolution stages compile only with EX predecessor',()=>{
  for(const stage of ['MEGA','MegaEvolution']){
    const c=compiled(pokemon('M Synthetic EX',{stage,suffix:'EX',evolveFrom:'Synthetic-EX'}));
    assert.equal(c.stage,'MegaEvolution');assert.equal(c.prizes,2);
  }
  rejected(pokemon('M Synthetic EX',{stage:'MEGA',suffix:'EX',evolveFrom:'Synthetic ex'}));
  rejected(pokemon('M Synthetic EX',{suffix:'EX'}));
  assert.equal(compiled(pokemon('Mega Synthetic ex',{suffix:'ex',stage:'Stage1',evolveFrom:'Synthetic'})).prizes,3);
  rejected(pokemon('M Synthetic ex',{suffix:'ex',stage:'MEGA',evolveFrom:'Synthetic ex'}));
});
test('known prize and Mega reminders are checked in full, unknown rules fail closed',()=>{
  const base=pokemon('M Synthetic EX',{stage:'MEGA',suffix:'EX',evolveFrom:'Synthetic EX',rules:[
    'When your Pokemon-EX is Knocked Out, your opponent takes 2 Prize cards.',
    'When 1 of your Pokemon becomes a Mega Evolution Pokemon, your turn ends.'
  ]});
  compiled(base);rejected({...base,raw_data:{...base.raw_data,rules:[...base.raw_data.rules,'Draw another Prize card.']}});
  rejected(pokemon('Synthetic EX',{suffix:'EX',rules:["When your Pokemon-ex is Knocked Out, your opponent takes 2 Prize cards."]}));
});
// https://github.com/tcgdex/cards-database/blob/master/data/Sword%20%26%20Shield/Brilliant%20Stars/121.ts
const drawAbility={type:'Ability',name:'Industrious Incisors',effect:'Once during your turn, you may draw cards until you have 5 cards in your hand.'};
test('complete activated Ability text compiles with per-unit per-turn limits',()=>{
  const c=compiled(row({abilities:[drawAbility]}));assert.deepEqual(c.abilities[0].program,{kind:'draw_until',count:5});assert.equal(c.abilities[0].limit,'turn');
  for(const [effect,kind] of [
    ['Once during your turn (before your attack), you may draw a card.','draw'],
    ['Once during your turn, you may heal 30 damage from this Pokemon.','heal_self'],
    ["Once during your turn, you may put 2 damage counters on your opponent's Active Pokemon.",'damage']
  ])assert.equal(compiled(row({abilities:[{...drawAbility,effect}]})).abilities[0].program.kind,kind);
});
test('Abilities never drop costs, positions, conditions or end-turn clauses',()=>{
  for(const effect of [drawAbility.effect+' Your turn ends.','Once during your turn, you may discard an Energy card to draw 2 cards.',{en:drawAbility.effect},''])rejected(row({abilities:[{...drawAbility,effect}]}));
  assert.equal(compiled(row({abilities:[{...drawAbility,effect:"Once during your turn, if this Pokemon is in the Active Spot, you may draw cards until you have 5 cards in your hand."}]})).abilities[0].position,'active');
  for(const abilities of [{},'unknown',[{...drawAbility,type:'Unknown Power'}]])rejected(row({abilities}));
  rejected(row({abilities:[drawAbility,{...drawAbility,effect:'Prevent all damage.'}]}));
});
// Primary exact Tool profiles:
// data/XY/XY/121.ts; data/XY/BREAKpoint/99.ts;
// data/Black & White/Plasma Freeze/99.ts; data/XY/Evolutions/75.ts.
const tools=[
  ['Muscle Band',"The attacks of the Pokémon this card is attached to do 20 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance).",{damage:20}],
  ['Fighting Fury Belt',"The Basic Pokémon this card is attached to gets +40 HP and its attacks do 10 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance).",{hp:40,damage:10,filter:'basic'}],
  ['Giant Cape','The Pokémon this card is attached to gets +20 HP.',{hp:20}],
  ['Float Stone','The Pokémon this card is attached to has no Retreat Cost.',{retreat:'free'}],
  ['Charizard Spirit Link','Your turn does not end if the Pokémon this card is attached to becomes M Charizard-EX.',{spiritLink:'M Charizard EX'}]
];
for(const [name,effect,expected]of tools)test('reviewed distinct Tool: '+name,()=>{
  const c=compiled(trainer(name,effect,'Tool'));assert.equal(c.program.kind,'tool');assert.equal(c.program.trainerType,'Tool');for(const [k,v]of Object.entries(expected))assert.equal(c.program[k],v);
  rejected(trainer(name,effect+' Draw a card.','Tool'));rejected(trainer(name,effect,'Item'));
});
// https://github.com/tcgdex/cards-database/blob/master/data/XY/Primal%20Clash/137.ts
// https://github.com/tcgdex/cards-database/blob/master/data/XY/Furious%20Fists/102.ts
const seas="Once during each player's turn, that player may heal 30 damage from each of his or her Water Pokémon and Lightning Pokémon.";
const center="Each Stage 1 and Stage 2 Pokémon in play (both yours and your opponent's) gets +30 HP.";
test('Stadiums compile shared modifiers and each-player activations separately',()=>{
  assert.deepEqual(compiled(trainer('Rough Seas',seas,'Stadium')).program.activation,{kind:'heal_all',amount:30,types:['Water','Lightning']});
  assert.deepEqual(compiled(trainer('Training Center',center,'Stadium')).program.modifiers,{hp:30,filter:'evolved'});
  rejected(trainer('Rough Seas',seas+' Draw 1 card.','Stadium'));rejected(trainer('Arena',center,'Item'));
});
test('multi-step Trainer preserves ordered effects and rejects a trailing unknown clause',()=>{
  const c=compiled(trainer('Synthetic Training','Draw 2 cards. Heal 30 damage from 1 of your Pokemon.','Supporter'));
  assert.deepEqual(c.program.steps,[{kind:'draw',count:2},{kind:'heal',amount:30}]);
  assert.equal(c.program.kind,'sequence');
  rejected(trainer('Synthetic Training',c.program.text+' Your opponent skips their next turn.','Supporter'));
});
// https://github.com/tcgdex/cards-database/blob/master/data/XY/BREAKthrough/149.ts
// https://github.com/tcgdex/cards-database/blob/master/data/XY/Flashfire/97.ts
test('Super Rod restores to deck and Startling Megaphone removes opponent Tools',()=>{
  const rod=compiled(trainer('Super Rod','Shuffle 3 in any combination of Pokémon and basic Energy cards from your discard pile into your deck.'));
  assert.equal(rod.program.destination,'deck');assert.equal(rod.program.filter,'pokemon_or_energy');assert.equal(rod.program.count,3);assert.equal(rod.program.optional,false);
  const megaphone=compiled(trainer('Startling Megaphone',"Discard all Pokémon Tool cards attached to each of your opponent's Pokémon."));assert.equal(megaphone.program.kind,'discard_tools');assert.equal(megaphone.program.side,'opponent');
});
test('search discard costs and complete private-search instructions are retained',()=>{
  const c=compiled(trainer('Synthetic Search','You can play this card only if you discard 2 other cards from your hand. Search your deck for a Pokemon, reveal it, and put it into your hand. Then, shuffle your deck.'));
  assert.equal(c.program.kind,'search');assert.equal(c.program.discard,2);
  rejected(trainer('Synthetic Search','Search your deck for a Pokemon, reveal it, and put it into your hand.'));
});
test('ACE SPEC limits aggregate different card names and artworks',()=>{
  const d=trainingDeck();d[2]={...d[2],quantity:1,card:compiled(trainer('Synthetic ACE A','Draw 2 cards.','Item',{rarity:'ACE SPEC Rare'}))};
  const removed=trainingDeck()[2].quantity-1;d.at(-1).quantity+=removed;
  assert.equal(deckValidation(d).playable,true);
  const another=structuredClone(d[2]);another.card.name='Synthetic ACE B';d.push(another);d.at(-2).quantity--;
  assert.equal(deckValidation(d).playable,false);assert.match(deckValidation(d).errors.join(' '),/ACE SPEC/);
  assert.equal(compiled(trainer('Synthetic ACE old','Draw 2 cards.','Ace Spec')).ace_spec,true);
  const d2=trainingDeck();d2[0].card.compiler=LEGACY_ARENA_VERSION;assert.equal(deckValidation(d2).playable,false);
});
test('EX/ex copy limits distinguish mechanics and consolidate suffix separator variants',()=>{
  const ex=compiled(pokemon('Synthetic ex',{suffix:'ex'})),EX=compiled(pokemon('Synthetic EX',{suffix:'EX'}));
  const energy=trainingDeck().find(x=>x.card.kind==='energy').card;
  assert.equal(deckValidation([{card:ex,quantity:4},{card:EX,quantity:4},{card:energy,quantity:52}]).playable,true);
  const hyphen={...EX,name:'Synthetic-EX'};
  assert.equal(deckValidation([{card:EX,quantity:4},{card:hyphen,quantity:1},{card:energy,quantity:55}]).playable,false);
});
// M Venusaur EX, https://github.com/tcgdex/cards-database/blob/master/data/XY/XY/2.ts
test('combined Special Conditions compile without silently losing either condition',()=>{
  const a=attackProgram({name:'Crisis Vine',cost:['Grass','Grass','Grass','Colorless'],damage:120,effect:"Your opponent's Active Pokémon is now Paralyzed and Poisoned."});
  assert.deepEqual(a.effects,[{kind:'condition',condition:'paralyzed'},{kind:'condition',condition:'poisoned'}]);
  assert.throws(()=>attackProgram({...a,effect:"Your opponent's Active Pokemon is now Asleep and Paralyzed."}));
});
test('malformed text, unsupported mechanics and partially understood attacks fail closed',()=>{
  for(const extra of [{tera:true},{item:{name:'Held',effect:'x'}},{ancientTrait:{effect:'x'}},{rules:{text:'x'}},{effect:'Prevent damage.'},{abilities:[drawAbility],attacks:[{name:'Bad',cost:[],effect:'Win the game.'}]}])rejected(row(extra));
  rejected(trainer('Malformed',{en:'Draw 2 cards.'}));
  assert.throws(()=>attackProgram({name:'Malformed',cost:[],damage:10,effect:{en:'Draw 2 cards.'}}));
});
// https://github.com/tcgdex/cards-database/blob/master/data/Sword%20%26%20Shield/Darkness%20Ablaze/159.ts
test('Bird Keeper requires a successful switch before its draw',()=>{
  const c=compiled(trainer('Bird Keeper','Switch your Active Pokémon with 1 of your Benched Pokémon. If you do, draw 3 cards.','Supporter'));
  assert.equal(c.program.requires_switch,true);assert.deepEqual(c.program.steps,[{kind:'switch'},{kind:'draw',count:3}]);
  rejected(trainer('Bird Keeper',c.program.text+' Draw a Prize card.','Supporter'));
});
// https://github.com/tcgdex/cards-database/blob/master/data/XY/Flashfire/69.ts
test('M Charizard EX attack discards the top five own cards after damage',()=>{
  const c=compiled(pokemon('M Charizard EX',{suffix:'EX',stage:'MEGA',evolveFrom:'Charizard-EX',attacks:[{name:'Wild Blaze',cost:['Fire','Fire','Darkness','Colorless','Colorless'],damage:300,effect:'Discard the top 5 cards of your deck.'}]}));
  assert.deepEqual(c.attacks[0].effects,[{kind:'discard_deck',count:5}]);
});
test('Basic Energy validates complete text and never bypasses additional effects',()=>{
  const energy=effect=>({...row(),name:'Fire Energy',raw_data:{category:'Energy',energyType:'Normal',effect}});
  compiled(energy(''));compiled(energy('This card provides Fire Energy.'));compiled(energy('Basic Energy'));
  compiled({...energy('Basic Energy'),raw_data:{category:'Energy',energyType:'Basic',effect:'Basic Energy'}});
  for(const effect of ['When attached, draw 3 cards.','This card provides Fire Energy. Draw a card.',{en:'This card provides Fire Energy.'}])rejected(energy(effect));
  rejected({...energy(''),raw_data:{category:'Energy',energyType:'Special'}});
});
// The legacy TCGdex printing omits ACE metadata:
// https://github.com/tcgdex/cards-database/blob/master/data/Black%20%26%20White/Plasma%20Blast/94.ts
// Modern printing: data/Scarlet & Violet/Temporal Forces/153.ts.
test('reviewed Master Ball ACE SPEC printings cannot bypass the one-card limit through missing provider rarity',()=>{
  for(const [effect,extra]of [
    ['Search your deck for a Pokémon, reveal it, and put it into your hand. Shuffle your deck afterward.',{rarity:'Rare'}],
    ['Search your deck for a Pokémon, reveal it, and put it into your hand. Then, shuffle your deck.',{rarity:'ACE SPEC Rare'}]
  ])assert.equal(compiled(trainer('Master Ball',effect,'Item',extra)).ace_spec,true);
  rejected(trainer('Master Ball','Look at the top 7 cards of your deck. Choose a Pokemon.'));
});
