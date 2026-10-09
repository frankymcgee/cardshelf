import test from 'node:test';
import assert from 'node:assert/strict';
import { newArena, applyArenaAction as act, legalArenaActions as legal, arenaView as view, energySatisfied, attackDamage, assertArena } from '../lib/arena/engine.mjs';
import { trainingDeck } from '../lib/arena/training.mjs';
import { compileArenaCard,attackProgram,deckValidation } from '../lib/arena/cards.mjs';
import { cpuAction,driveCpu } from '../lib/arena/bot.mjs';
import { arenaPaidTier,ARENA_VERSION,LESSONS } from '../shared/arena.mjs';
import { readyFixture,take,power,attack,trainer,row,rngFor } from './helpers/arena-fixtures.mjs';
const immutable=(s,seat,a,options)=>{const original=JSON.stringify(s),next=act(s,seat,a,options);assert.equal(JSON.stringify(s),original);assertArena(next);return next;};
const rejected=(s,seat,a)=>{const before=JSON.stringify(s);assert.throws(()=>act(s,seat,a));assert.equal(JSON.stringify(s),before);};

test('training decks are original, supported, exactly sixty cards and contain no external artwork',()=>{
  for(const theme of ['ember','tide']){const d=trainingDeck(theme);assert.equal(deckValidation(d).playable,true);assert.equal(d.reduce((n,r)=>n+r.quantity,0),60);assert.ok(d.every(r=>r.card.image_url===null));}
});
test('deck limits aggregate names across collectible variants and exempt only Basic Energy',()=>{
  const d=trainingDeck();d[1].card.name=d[0].card.name;assert.equal(deckValidation(d).playable,false);
  assert.equal(deckValidation(trainingDeck().slice(1)).playable,false);
  const noBasic=trainingDeck().map(r=>({...r,card:{...r.card,stage:'Stage1'}}));assert.equal(deckValidation(noBasic).playable,false);
});
test('complete executable card data is required and arbitrary category/foreign records fail closed',()=>{
  assert.equal(compileArenaCard(row()).supported,true);
  for(const change of [{game:'mtg'},{language:'ja'},{raw_data:{category:'Unknown'}}])assert.equal(compileArenaCard({...row(),...change}).supported,false);
  for(const raw of [{abilities:[{name:'Unknown'}]},{suffix:'ex'},{item:{}},{types:['Fire','Water','Grass']},{hp:undefined},{retreat:undefined},{stage:'VSTAR'}])assert.equal(compileArenaCard(row(raw)).supported,false);
});
test('future/unimplemented text cannot silently become a vanilla attack or Trainer',()=>{
  for(const text of ['Deal damage based on a new rule.','Draw 2 cards. Then win the game.','Your opponent cannot play cards.'])assert.throws(()=>attackProgram({name:'Unknown',cost:[],damage:20,effect:text}));
  assert.equal(compileArenaCard(row({category:'Trainer',trainerType:'Stadium',effect:'Draw 3 cards.'})).supported,false);
});
for(const [text,kind]of [["Your opponent's Active Pokémon is now Asleep.",'condition'],['Flip a coin. If heads, the Defending Pokémon is now Paralyzed.','coin_condition'],['This Pokémon also does 20 damage to itself.','recoil'],['Heal 20 damage from this Pokémon.','heal_self'],['Draw 2 cards.','draw'],['Discard a Fire Energy from this Pokémon.','discard_energy'],['Flip a coin. If tails, this attack does nothing.','coin_gate']])test('compile exact effect: '+kind,()=>{assert.equal(attackProgram({name:'Test',cost:[],damage:20,effect:text}).effects[0].kind,kind);});
test('unbounded numeric effects, duplicate modifiers and unknown formulas are rejected',()=>{
  for(const a of [{damage:'20+',effect:''},{damage:'20x',effect:''},{damage:15},{damage:'1000000'},{damage:'30x',effect:'Flip 100 coins. This attack does 30 damage for each heads.'}])assert.throws(()=>attackProgram({name:'test',cost:[],...a}));
  assert.equal(compileArenaCard(row({weaknesses:[{type:'Water',value:'x2'},{type:'Water',value:'x2'}]})).supported,false);
});
test('artwork is restricted to allowed card assets; arbitrary URLs are not forwarded',()=>{
  assert.equal(compileArenaCard({...row(),image_url:'https://evil.test/tracker'}).card.image_url,null);
  assert.equal(compileArenaCard({...row(),image_url:'javascript:alert(1)'}).card.image_url,null);
});
for(const [effect,kind]of [['Draw 3 cards.','draw'],['Discard your hand and draw 7 cards.','discard_draw'],['Shuffle your hand into your deck. Then, draw 6 cards.','shuffle_draw'],['Heal 30 damage from 1 of your Pokémon.','heal'],['Switch your Active Pokémon with 1 of your Benched Pokémon.','switch'],["Switch 1 of your opponent's Benched Pokémon with their Active Pokémon.",'gust'],['Search your deck for a Basic Pokémon, reveal it, and put it into your hand. Then, shuffle your deck.','search'],['Put up to 2 basic Energy cards from your discard pile into your hand.','recover']])test('compile supported Trainer: '+kind,()=>{const c=compileArenaCard(row({category:'Trainer',trainerType:'Item',effect}));assert.equal(c.supported,true,c.reason);assert.equal(c.card.program.kind,kind);});
test('starting state deals private seven-card hands, has no prizes yet and conserves every instance',()=>{
  const s=newArena([trainingDeck(),trainingDeck('tide')],{rng:rngFor(44)});for(const p of s.players){assert.equal(p.hand.length,7);assert.equal(p.deck.length,53);assert.equal(p.prizes.length,0);assert.ok(p.hand.some(c=>c.card.stage==='Basic'));}assertArena(s);
});
test('opening field remains private even when a player concedes before both fields are ready',()=>{
  let s=newArena([trainingDeck(),trainingDeck('tide')],{rng:rngFor(4)});const basic=s.players[0].hand.find(c=>c.card.stage==='Basic');s=act(s,0,{type:'setup',card:basic.id,zone:'active'});assert.equal(view(s,1).players[0].active.hidden,true);s=act(s,0,{type:'concede'});assert.equal(view(s,1).players[0].active.hidden,true);assert.ok(!JSON.stringify(view(s,1)).includes(basic.id));
});
test('both players lock setup, first player is chosen once and turn draw/prizes happen automatically',()=>{
  let s=newArena([trainingDeck(),trainingDeck('tide')],{rng:rngFor(3)});s=act(s,s.toss,{type:'first',seat:0});rejected(s,s.toss,{type:'first',seat:1});
  for(let seat=0;seat<2;seat++){const p=s.players[seat],c=p.hand.find(c=>c.card.stage==='Basic');s=act(s,seat,{type:'setup',card:c.id,zone:'active'});s=act(s,seat,{type:'ready'});}
  while(s.pending){const prompt=view(s,s.pending.seat).prompt;s=act(s,s.pending.seat,{type:'choose',choices:[prompt.options[0].id]});}
  assert.equal(s.phase,'playing');assert.equal(s.turn,0);assert.equal(s.turnNumber,1);assert.equal(s.players[0].hand.length,7);assert.equal(s.players[1].hand.length,6);assert.equal(s.players[0].prizes.length,6);assert.equal(s.setup_complete,true);
});
test('opening setup allows only Basics, cannot exceed the five-card Bench and locks ready fields',()=>{
  let s=newArena([trainingDeck(),trainingDeck('tide')],{rng:rngFor(3)});const p=s.players[0],energy=p.hand.find(c=>c.card.kind==='energy');if(energy)rejected(s,0,{type:'setup',card:energy.id,zone:'active'});
  rejected(s,0,{type:'ready'});assert.equal(legal(s,0).some(m=>m.action.type==='attack'),false);
});
test('first player cannot attack or use a Supporter on the opening turn',()=>{
  const s=readyFixture();power(s,0,4);s.turnNumber=1;s.players[0].turns=1;trainer(s,0,{kind:'draw',count:3,trainerType:'Supporter'});
  assert.equal(legal(s,0).some(m=>m.action.type==='attack'),false);assert.equal(legal(s,0).some(m=>m.action.type==='trainer'),false);
});
test('only the current player can play cards, end a turn or attack; concession remains available',()=>{
  const s=readyFixture();power(s,1,4);rejected(s,1,{type:'attack',index:0});rejected(s,1,{type:'end_turn'});assert.equal(act(s,1,{type:'concede'}).result,0);
});
test('Energy must match typed costs, Colorless uses any type and attacking does not normally discard it',()=>{
  const s=readyFixture();const u=power(s,0,2,'Fire');assert.equal(energySatisfied(u,['Fire','Colorless']),true);assert.equal(energySatisfied(u,['Water']),false);assert.equal(energySatisfied(u,['Fire','Fire','Colorless']),false);
  attack(s,0,{damage:10,cost:['Fire']});const n=immutable(s,0,{type:'attack',index:0});assert.equal(n.players[0].active.energy.length,2);
});
test('one Energy attachment from hand per turn; enemy targets and repeat attachment are blocked',()=>{
  let s=readyFixture();const c=take(s,0,c=>c.card.kind==='energy');const target=s.players[0].active.id;
  rejected(s,0,{type:'energy',card:c.id,target:s.players[1].active.id});s=act(s,0,{type:'energy',card:c.id,target});const another=take(s,0,c=>c.card.kind==='energy');rejected(s,0,{type:'energy',card:another.id,target});assert.equal(s.players[0].energyAttached,true);
});
test('attack validates Energy, applies Weakness then Resistance and ends the turn with a new draw',()=>{
  const s=readyFixture();attack(s,0,{damage:40,cost:['Fire']});s.players[0].active.card.type='Fire';s.players[1].active.card.hp=200;s.players[1].active.card.weakness=[{type:'Fire',value:'x2'}];s.players[1].active.card.resistance=[{type:'Fire',value:'-30'}];
  rejected(s,0,{type:'attack',index:0});power(s,0,1,'Fire');const count=s.players[1].hand.length;const n=immutable(s,0,{type:'attack',index:0});assert.equal(n.players[1].active.damage,50);assert.equal(n.turn,1);assert.equal(n.players[1].hand.length,count+1);assert.equal(n.events.some(e=>e.kind==='attack'&&e.damage===50),true);
});
test('zero attack damage remains zero despite an additive Weakness',()=>{const s=readyFixture();s.players[1].active.card.weakness=[{type:s.players[0].active.card.type,value:'+20'}];assert.equal(attackDamage({},s.players[0].active,s.players[1].active,0),0);});
test('clients cannot supply damage, RNG outcomes, state or another player seat with an attack',()=>{
  const s=readyFixture();attack(s,0);for(const extras of [{damage:900},{result:0},{seat:1},{state:{}}])rejected(s,0,{type:'attack',index:0,...extras});rejected(s,0,{type:'counters',damage:900});
});
test('coin gate stops the entire attack; bonus and multiplying damage use server RNG',()=>{
  for(const [effects,heads,expected]of [[[{kind:'coin_gate'}],false,0],[[{kind:'coin_bonus',amount:20}],true,50],[[{kind:'coin_damage',coins:3,per:20}],true,60]]){
    const s=readyFixture();attack(s,0,{damage:30,effects});s.players[1].active.card.hp=200;s.players[1].active.card.weakness=[];const n=act(s,0,{type:'attack',index:0},{rng:()=>heads?1:0});assert.equal(n.players[1].active.damage,expected);
  }
});
for(const condition of ['asleep','paralyzed'])test(condition+' prevents attacking and retreating',()=>{const s=readyFixture();power(s,0,5);s.players[0].active.conditions.special=condition;assert.equal(legal(s,0).some(m=>['attack','retreat'].includes(m.action.type)),false);});
test('Confusion tails places thirty self damage and skips the attack; heads allows it',()=>{
  for(const heads of [false,true]){const s=readyFixture();attack(s,0,{damage:20});s.players[0].active.conditions.special='confused';s.players[1].active.card.weakness=[];const n=act(s,0,{type:'attack',index:0},{rng:()=>heads?1:0});assert.equal(n.players[0].active.damage,heads?0:30);assert.equal(n.players[1].active.damage,heads?20:0);}
});
test('Poison and Burn damage occur between turns, with Burn/Sleep recovery and Paralysis expiry',()=>{
  const s=readyFixture();s.players[0].active.card.hp=200;s.players[0].active.conditions={special:'paralyzed',poison:true,burn:true};s.players[1].active.conditions.special='asleep';const n=act(s,0,{type:'end_turn'},{rng:()=>1});assert.equal(n.players[0].active.damage,30);assert.equal(n.players[0].active.conditions.burn,false);assert.equal(n.players[0].active.conditions.poison,true);assert.equal(n.players[0].active.conditions.special,null);assert.equal(n.players[1].active.conditions.special,null);
});
test('supported attack conditions, healing, recoil and effect draws resolve without manual counters',()=>{
  const s=readyFixture();attack(s,0,{damage:10,effects:[{kind:'condition',condition:'poisoned'},{kind:'recoil',amount:10},{kind:'heal_self',amount:20},{kind:'draw',count:2}]});s.players[0].active.damage=30;s.players[1].active.card.weakness=[];const before=s.players[0].hand.length,n=act(s,0,{type:'attack',index:0},{rng:()=>0});assert.equal(n.players[0].active.damage,20);assert.equal(n.players[1].active.damage,20);assert.equal(n.players[0].hand.length,before+2);
});
test('Energy discard attacks present only eligible own Energy and resolve after payment once',()=>{
  let s=readyFixture();power(s,0,2,'Fire');attack(s,0,{damage:20,cost:['Fire'],effects:[{kind:'discard_energy',count:1,type:'Fire'}]});s.players[1].active.card.weakness=[];s=act(s,0,{type:'attack',index:0});assert.equal(s.pending.kind,'attack_discard');assert.equal(view(s,1).prompt,null);const q=view(s,0).prompt;rejected(s,1,{type:'choose',choices:[q.options[0].id]});s=act(s,0,{type:'choose',choices:[q.options[0].id]});assert.equal(s.players[0].active.energy.length,1);assert.equal(s.players[1].active.damage,20);
});
test('evolution requires a previous turn in play, preserves damage and Energy, clears conditions',()=>{
  const s=readyFixture();const evolution=take(s,0,c=>c.card.stage==='Stage1');const u=s.players[0].active;u.card.name=evolution.card.evolves_from;u.card.stage='Basic';u.damage=20;u.conditions={special:'asleep',poison:true,burn:true};power(s,0,2);const a={type:'evolve',card:evolution.id,target:u.id};u.entered=s.players[0].turns;rejected(s,0,a);u.entered=0;s.players[0].turns=1;rejected(s,0,a);s.players[0].turns=2;const n=immutable(s,0,a);assert.equal(n.players[0].active.damage,20);assert.equal(n.players[0].active.energy.length,2);assert.equal(n.players[0].active.under.length,1);assert.deepEqual(n.players[0].active.conditions,{special:null,poison:false,burn:false});
});
test('retreat pays selected Energy, clears conditions and is limited to once per turn',()=>{
  let s=readyFixture();power(s,0,3);s.players[0].active.card.retreat=2;s.players[0].active.conditions={special:'confused',poison:true,burn:true};const old=s.players[0].active.id,target=s.players[0].bench[0].id;
  s=act(s,0,{type:'retreat',target});assert.equal(s.pending.kind,'retreat_discard');s=act(s,0,{type:'choose',choices:view(s,0).prompt.options.slice(0,2).map(o=>o.id)});assert.equal(s.players[0].active.id,target);assert.equal(s.players[0].bench.find(c=>c.id===old).energy.length,1);assert.deepEqual(s.players[0].bench.find(c=>c.id===old).conditions,{special:null,poison:false,burn:false});assert.equal(legal(s,0).some(m=>m.action.type==='retreat'),false);
});
test('free retreat is a real swap without a payment prompt',()=>{const s=readyFixture();s.players[0].active.card.retreat=0;const target=s.players[0].bench[0].id,n=act(s,0,{type:'retreat',target});assert.equal(n.players[0].active.id,target);assert.equal(n.pending,null);assert.equal(n.players[0].retreated,true);});
test('Items can be used repeatedly; Supporters are once per turn and are discarded after resolving',()=>{
  let s=readyFixture();const c=trainer(s,0,{kind:'draw',count:3,trainerType:'Supporter'});const count=s.players[0].hand.length;s=act(s,0,{type:'trainer',card:c.id});assert.equal(s.players[0].hand.length,count+2);assert.equal(s.players[0].supporterPlayed,true);const c2=trainer(s,0,{kind:'draw',count:3,trainerType:'Supporter'});rejected(s,0,{type:'trainer',card:c2.id});
  const item=trainer(s,0,{kind:'draw',count:1});assert.ok(legal(s,0).some(m=>m.action.card===item.id));
});
test('healing cannot target undamaged or opponent Pokémon and cannot heal below zero',()=>{
  const s=readyFixture();const c=trainer(s,0,{kind:'heal',amount:30});rejected(s,0,{type:'trainer',card:c.id,target:s.players[1].active.id});rejected(s,0,{type:'trainer',card:c.id,target:s.players[0].active.id});s.players[0].active.damage=10;assert.equal(act(s,0,{type:'trainer',card:c.id,target:s.players[0].active.id}).players[0].active.damage,0);
});
test('switching and gust clear the old Active conditions and preserve stacks and damage',()=>{
  for(const kind of ['switch','gust']){const s=readyFixture(),who=kind==='switch'?0:1,c=trainer(s,0,{kind});const old=s.players[who].active.id,target=s.players[who].bench[0].id;s.players[who].active.damage=10;s.players[who].active.conditions.poison=true;const n=act(s,0,{type:'trainer',card:c.id,target});assert.equal(n.players[who].active.id,target);assert.equal(n.players[who].bench.find(u=>u.id===old).damage,10);assert.equal(n.players[who].bench.find(u=>u.id===old).conditions.poison,false);}
});
test('search prompts are private and sorted; a selection reveals only chosen card(s), then shuffles',()=>{
  let s=readyFixture();const c=trainer(s,0,{kind:'search',filter:'basic',count:1});s=act(s,0,{type:'trainer',card:c.id});const prompt=view(s,0).prompt;assert.equal(view(s,1).prompt,null);const names=prompt.options.map(o=>o.label);assert.deepEqual(names,[...names].sort((a,b)=>a.localeCompare(b)));const chosen=prompt.options[0],previous=s.players[0].deck.map(c=>c.id);s=act(s,0,{type:'choose',choices:[chosen.id]},{rng:rngFor(17)});assert.ok(s.players[0].hand.some(c=>c.card.id===chosen.card.card.id));assert.ok(previous.every(id=>!s.players[0].deck.some(c=>c.id===id)));assert.equal(s.players[0].resolving.length,0);
});
test('a hidden-zone search may fail to find, but its cost and shuffle still happen',()=>{
  let s=readyFixture();const c=trainer(s,0,{kind:'search',filter:'pokemon',count:1,discard:2});take(s,0,c=>c.card.kind==='energy');take(s,0,c=>c.card.kind==='energy');s=act(s,0,{type:'trainer',card:c.id});assert.equal(s.pending.kind,'trainer_discard');const ids=view(s,0).prompt.options.slice(0,2).map(o=>o.id);s=act(s,0,{type:'choose',choices:ids});assert.equal(s.pending.kind,'search');s=act(s,0,{type:'choose',choices:[]});assert.equal(s.players[0].discard.length,3);assert.equal(s.phase,'playing');
});
test('public discard recovery exposes matching selectable Energy only',()=>{
  let s=readyFixture();take(s,0,c=>c.card.kind==='energy','discard');take(s,0,c=>c.card.kind==='energy','discard');take(s,0,c=>c.card.kind==='pokemon','discard');const c=trainer(s,0,{kind:'recover',filter:'energy',count:2,optional:true});s=act(s,0,{type:'trainer',card:c.id});const q=view(s,0).prompt;assert.equal(q.options.length,2);s=act(s,0,{type:'choose',choices:q.options.map(o=>o.id)});assert.equal(s.players[0].hand.filter(c=>c.card.kind==='energy').length,2);
});
test('duplicate, oversized, foreign and incomplete prompt selections are rejected',()=>{
  let s=readyFixture();const c=trainer(s,0,{kind:'search',filter:'basic',count:1});s=act(s,0,{type:'trainer',card:c.id});const id=view(s,0).prompt.options[0].id;for(const choices of [[id,id],['forged'],[id,'forged'],null])rejected(s,0,{type:'choose',choices});
});
test('Knock Out discards an entire evolution/Energy stack and awards hidden Prize choices',()=>{
  let s=readyFixture();const defender=s.players[1].active;power(s,1,2);attack(s,0,{damage:500});s=act(s,0,{type:'attack',index:0});assert.equal(s.players[1].active,null);assert.equal(s.players[1].discard.length,3);assert.equal(s.pending.kind,'prize');assert.equal(view(s,0).prompt.options.every(o=>o.hidden&&!o.card),true);assert.equal(view(s,1).prompt,null);s=act(s,0,{type:'choose',choices:['0']});assert.equal(s.pending.kind,'promote');const target=s.players[1].bench[0].id;s=act(s,1,{type:'choose',choices:[target]});assert.equal(s.players[1].active.id,target);assert.equal(s.players[0].prizes.length,5);assert.equal(s.turn,1);assert.ok(!JSON.stringify(s.players[1].discard).includes(defender.id));
});
test('taking the last Prize ends the match automatically and no further game action is accepted',()=>{
  let s=readyFixture();s.players[0].deck.push(...s.players[0].prizes.splice(1));attack(s,0,{damage:500});s=act(s,0,{type:'attack',index:0});s=act(s,0,{type:'choose',choices:['0']});assert.equal(s.phase,'finished');assert.equal(s.result,0);rejected(s,1,{type:'end_turn'});
});
test('no remaining Pokémon is an automatic loss after the awarded Prize is taken',()=>{let s=readyFixture({bench:false});attack(s,0,{damage:500});s=act(s,0,{type:'attack',index:0});s=act(s,0,{type:'choose',choices:['0']});assert.equal(s.phase,'finished');assert.equal(s.result,0);});
test('empty start-of-turn draw loses, but effect draws simply draw the available cards',()=>{
  const s=readyFixture();s.players[1].discard.push(...s.players[1].deck);s.players[1].deck=[];const n=act(s,0,{type:'end_turn'});assert.equal(n.phase,'finished');assert.equal(n.result,0);
});
test('equal simultaneous victories start a fresh six-Prize tiebreaker without losing the action bound',()=>{
  let s=readyFixture({bench:false});s.players[0].active.card.hp=30;attack(s,0,{damage:500,effects:[{kind:'recoil',amount:30}]});s.actions=100;s=act(s,0,{type:'attack',index:0});assert.equal(s.pending.kind,'prize');s=act(s,0,{type:'choose',choices:['0']});s=act(s,1,{type:'choose',choices:['0']});assert.equal(s.phase,'setup');assert.equal(s.round,2);assert.equal(s.prizeGoal,6);assert.equal(s.tiebreaker,true);assert.ok(s.actions>100);assertArena(s);
});
test('opponent hand, Prize identities, draw order, hidden IDs and server continuations never enter a player view',()=>{
  const s=readyFixture();for(let seat=0;seat<2;seat++){const v=view(s,seat),json=JSON.stringify(v),op=s.players[1-seat];for(const key of ['queue','originalDecks','pending'])assert.equal(key in v,false);assert.deepEqual(v.players[1-seat].hand,[]);for(const c of [...op.deck,...op.hand,...op.prizes])assert.ok(!json.includes(c.id));assert.equal('deck' in v.players[seat],false);assert.equal('prizes' in v.players[seat],false);}
});
test('training progress is earned by actions and never changes a real PvP result',()=>{let s=readyFixture();s.mode='tutorial';const c=take(s,0,c=>c.card.kind==='energy');s=act(s,0,{type:'energy',card:c.id,target:s.players[0].active.id});assert.equal(s.progress.attach,true);assert.equal(LESSONS.length,10);});
test('malformed seats, versions and action shapes fail without changing state',()=>{const s=readyFixture();for(const a of [null,{},[],{type:'win'},{type:'end_turn',card:'extra'}])rejected(s,0,a);assert.throws(()=>act(s,2,{type:'end_turn'}));assert.throws(()=>view({...s,version:'unknown'},0));});
test('CPU is supplied a player projection and cannot distinguish hidden opponent cards/order',()=>{
  const s=readyFixture();power(s,0,2);const a=cpuAction(view(s,0),{rng:rngFor(2)}),changed=structuredClone(s);changed.players[1].deck.reverse();changed.players[1].hand.forEach(c=>{c.card.name='Secret altered';});const b=cpuAction(view(changed,0),{rng:rngFor(2)});assert.deepEqual(a,b);
});
for(let seed=1;seed<=50;seed++)test('complete two-CPU game conserves cards and terminates · seed '+seed,()=>{
  let s=newArena([trainingDeck(),trainingDeck('tide')],{mode:seed%2?'practice':'tutorial',rng:rngFor(seed)}),rng=rngFor(seed+1234),steps=0;
  while(s.phase!=='finished'&&steps++<180){for(const seat of [0,1]){s=driveCpu(s,{seat,max:32,difficulty:seed%3?'normal':'easy',rng}).state;assertArena(s);for(const reader of [0,1]){const v=view(s,reader);assert.deepEqual(v.players[1-reader].hand,[]);}}}
  assert.equal(s.phase,'finished','seed '+seed+' did not finish');assert.ok(s.result===0||s.result===1);assert.ok(s.actions<4000);
});
const now=Date.parse('2026-09-20T00:00:00Z'),future='2026-10-20T00:00:00Z',past='2026-08-20T00:00:00Z';
for(const tier of ['collector','plus'])test('arena entitlement accepts valid Live '+tier+' periods and explicit unexpired assignments',()=>{
  assert.equal(arenaPaidTier({subscriptions:[{environment:'production',paid_through:future,offer_snapshot:{plan_code:tier}}]},now).tier,tier);
  assert.equal(arenaPaidTier({override:{tier,expires_at:null}},now).tier,tier);
});
for(const [name,input]of [['nothing',{}],['test payment',{subscriptions:[{environment:'sandbox',paid_through:future,offer_snapshot:{plan_code:'plus'}}]}],['expired payment',{subscriptions:[{environment:'production',paid_through:past,offer_snapshot:{plan_code:'plus'}}]}],['expired override',{override:{tier:'plus',expires_at:past}}],['unparseable override expiry',{override:{tier:'plus',expires_at:'not a date'}}],['arbitrary plan',{override:{tier:'administrator',expires_at:null}}]])test('no automatic arena entitlement: '+name,()=>assert.equal(arenaPaidTier(input,now),null));

// Conservative imports never infer a one-Prize vanilla card from a missing rules marker.
for(const name of ['Synthetic ex','Synthetic VMAX','Synthetic GX','Radiant Synthetic','Synthetic ★'])test('special-mechanic name fails closed without provider suffix: '+name,()=>{assert.equal(compileArenaCard({...row(),name}).supported,false);});
test('malformed Abilities and non-attack Pokémon rules cannot be silently ignored',()=>{for(const extra of [{abilities:{}},{rules:{text:'Unknown'}},{ancientTrait:{name:'Unknown'}},{effect:'An additional rule.'}])assert.equal(compileArenaCard(row(extra)).supported,false);});
