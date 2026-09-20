import test from 'node:test';
import assert from 'node:assert/strict';
import { compileArenaCard } from '../lib/arena/cards.mjs';
import { arenaDeckProfile, chooseMatchedOpponent } from '../lib/arena/opponents.mjs';
import { assertMatchVersion, createArenaMatch } from '../lib/arena/matches.mjs';
import { trainingDeck } from '../lib/arena/training.mjs';
import { ARENA_VERSION, LEGACY_ARENA_VERSION } from '../shared/arena.mjs';
import { randomUUID } from 'node:crypto';

// Synthetic catalogue fixtures exercise data flow; they are never installed as
// publisher cards or used as replacement opponents in the application.
function deck({id='candidate',type='Fire',hp=100,cost=2,damage=40,evolution=false}={}) {
  const compile=(name,raw,key)=>compileArenaCard({id:'en:opponent-fixture-'+key,name,game:'pokemon',language:'en',raw_data:raw}).card;
  const basic=compile('Synthetic Basic',{category:'Pokemon',stage:'Basic',hp,retreat:1,types:[type],attacks:[{name:'Synthetic attack',cost:Array(cost).fill(type),damage}]},id+'-basic');
  const energy=compile(type+' Energy',{category:'Energy',energyType:'Basic'},id+'-energy');
  const cards=[{card:basic,quantity:4},{card:energy,quantity:evolution?52:56}];
  if(evolution)cards.push({card:compile('Synthetic Evolution',{category:'Pokemon',stage:'Stage1',evolveFrom:'Synthetic Basic',hp,retreat:1,types:[type],attacks:[{name:'Synthetic attack',cost:[type],damage}]},id+'-evolution'),quantity:4});
  return {id,title:id,cards};
}
test('matched opponents prefer comparable type, evolution mix and attack curve',()=>{
  const own=deck({id:'own',evolution:true});
  const same=deck({id:'near',evolution:true}),different=deck({id:'different',type:'Water',hp:200,cost:4,damage:120});
  const selected=chooseMatchedOpponent(own,[different,same]);
  assert.equal(selected.title,'near');assert.equal(selected.source,'saved');assert.equal(selected.selection,'matched');
  assert.deepEqual(selected.cards,same.cards);assert.ok(selected.cards.every(({card})=>card.id.startsWith('en:')&&!card.training));
  selected.cards[0].quantity=1;assert.equal(same.cards[0].quantity,4,'Opponent snapshots must not share mutable arrays.');
  assert.equal(arenaDeckProfile(own.cards).evolutions,4);
});
test('matched opponents exclude fictional training cards, invalid decks and missing evolution lines',()=>{
  const own=deck(),broken=deck({evolution:true});broken.cards[2].card.evolves_from='Missing Basic';
  const result=chooseMatchedOpponent(own,[{title:'Teaching',cards:trainingDeck()},broken,{title:'Incomplete',cards:own.cards.slice(0,1)}]);
  assert.equal(result.source,'mirror');assert.match(result.reason,/No comparable supported saved deck/);
  assert.deepEqual(result.cards,own.cards);assert.throws(()=>chooseMatchedOpponent({title:'Training',cards:trainingDeck()},[]),/catalogue deck/);
});
test('vastly different saved decks use the disclosed mirror fallback',()=>{
  const own=deck(),result=chooseMatchedOpponent(own,[deck({hp:500,cost:8,damage:1000})]);
  assert.equal(result.source,'mirror');assert.equal(result.selection,'matched');assert.equal(result.title,own.title);
  assert.notEqual(result.cards,own.cards);
});
test('matched opponents need Energy capable of paying at least one attack per Pokémon',()=>{
  const own=deck(),candidate=deck({id:'wrong-energy'});candidate.cards[1].card.type='Water';
  assert.equal(chooseMatchedOpponent(own,[candidate]).source,'mirror');
  candidate.cards[0].card.attacks[0].cost=['Colorless','Colorless'];
  assert.equal(chooseMatchedOpponent(own,[candidate]).source,'saved','Colorless costs accept the existing Basic Energy types.');
});
test('matched selection is deterministic when comparable saved decks tie',()=>{
  const own=deck(),a=deck({id:'a'}),b=deck({id:'b'});
  assert.equal(chooseMatchedOpponent(own,[b,a]).title,'a');assert.equal(chooseMatchedOpponent(own,[a,b]).title,'a');
});
test('matched Mega evolution lines normalize EX separators without confusing modern ex',()=>{
  const own=deck({evolution:true}),candidate=deck({id:'mega',evolution:true});
  candidate.cards[0].card.name='Synthetic Basic-EX';candidate.cards[0].card.rule_box='EX';
  candidate.cards[2].card.stage='MegaEvolution';candidate.cards[2].card.evolves_from='Synthetic Basic EX';
  assert.equal(chooseMatchedOpponent(own,[candidate]).source,'saved');
  candidate.cards[0].card.name='Synthetic Basic ex';candidate.cards[0].card.rule_box='ex';
  assert.equal(chooseMatchedOpponent(own,[candidate]).source,'mirror');
});
test('active and waiting matches accept retained versions and reject inconsistent database state',()=>{
  for(const version of [ARENA_VERSION,LEGACY_ARENA_VERSION]) {
    assert.doesNotThrow(()=>assertMatchVersion({engine_version:version,status:'waiting',state:{}}));
    assert.doesNotThrow(()=>assertMatchVersion({engine_version:version,status:'active',state:{version}}));
  }
  for(const row of [
    {engine_version:'unknown',status:'waiting',state:{}},
    {engine_version:LEGACY_ARENA_VERSION,status:'active',state:{version:ARENA_VERSION}},
    {engine_version:ARENA_VERSION,status:'waiting',state:{version:LEGACY_ARENA_VERSION}},
    {engine_version:ARENA_VERSION,status:'active',state:{}}
  ])assert.throws(()=>assertMatchVersion(row),error=>error.status===409);
});
test('malformed explicit opponent selections fail before any database operation',async()=>{
  for(const opponent of [null,false,0,'','unknown',{},[]])await assert.rejects(
    createArenaMatch(randomUUID(),{mode:'practice',deck_id:randomUUID(),deck_revision:1,alias:'Player',request_id:randomUUID(),opponent}),
    error=>error.status===400&&error.message==='Unsupported selection.'
  );
});
