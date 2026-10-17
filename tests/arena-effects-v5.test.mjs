import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {compileArenaCard as compile,attackProgram} from '../lib/arena/cards.mjs';
import {applyArenaAction as act,legalArenaActions as legal,arenaView as view,assertArena,newArena,attackDamage} from '../lib/arena/engine.mjs';
import {arenaSpectatorView} from '../lib/arena/spectator.mjs';
import {cpuAction,driveCpu} from '../lib/arena/bot.mjs';
import {ARENA_VERSION,LEGACY_EFFECTS_ARENA_VERSION} from '../shared/arena.mjs';
import * as frozen from '../lib/arena/engine-v4.mjs';
import {trainingDeck} from '../lib/arena/training.mjs';
import {readyFixture,take,power,attack,trainer,row,rngFor} from './helpers/arena-fixtures.mjs';
// Complete English catalogue records, TCGdex af57972e8f784c2507ab9e573c99bf02ae2e5e42.
// Fixtures include all attacks, Abilities and available provider metadata.
const rows=JSON.parse(fs.readFileSync(new URL('./helpers/arena-real-cards-v5.json',import.meta.url)));
const card=id=>{const r=rows.find(r=>r.id==='en:'+id);assert.ok(r,id);const c=compile(r);assert.equal(c.supported,true,c.reason);return c.card;};
const face=(s,seat,id,bench=false)=>{const u=bench?s.players[seat].bench[0]:s.players[seat].active;u.card=card(id);return u;};
const put=(s,seat,id,zone='hand')=>{const u=take(s,seat,()=>true,zone);u.card=card(id);return u;};
const pick=(s,ids,options={})=>act(s,s.pending.seat,{type:'choose',choices:ids},options);
const first=s=>view(s,s.pending.seat).prompt.options[0].id;
const reject=(s,seat,a)=>{const before=JSON.stringify(s);assert.throws(()=>act(s,seat,a));assert.equal(JSON.stringify(s),before);};
const ability=(s,u)=>act(s,s.turn,{type:'ability',card:u.id,index:0});
const finish=s=>{let n=0;while(s.pending){assert.ok(n++<100,'Prompt loop');const q=view(s,s.pending.seat).prompt;s=pick(s,q.options.slice(0,q.min).map(o=>o.id));}assertArena(s);return s;};

for(const r of rows)test('V5 compiles complete catalogue card '+r.name+' '+r.id,()=>{
  const c=compile(r);assert.equal(c.supported,true,c.reason);assert.equal(c.card.compiler,ARENA_VERSION);
});
test('V4 matches remain serializable and dispatch to their frozen rules, including setup validation',()=>{
  const decks=[trainingDeck(),trainingDeck('tide')].map(rows=>rows.map(r=>({...r,card:{...r.card,compiler:LEGACY_EFFECTS_ARENA_VERSION}})));
  let s=newArena(decks,{version:LEGACY_EFFECTS_ARENA_VERSION,rng:rngFor(51)});
  s=act(JSON.parse(JSON.stringify(s)),s.toss,{type:'first',seat:0});assert.deepEqual(view(s,0),frozen.arenaView(s,0));
  assert.equal(s.version,LEGACY_EFFECTS_ARENA_VERSION);assert.equal(compile(rows.find(r=>r.name==='Munkidori'),LEGACY_EFFECTS_ARENA_VERSION).supported,false);
});
test('printing metadata supplies Tera/non-Tera and free attacks only for exact matching identities',()=>{
  assert.equal(card('sv03-125').tera,true);assert.equal(card('sv03-164').tera,false);assert.deepEqual(card('sv08.5-004').attacks[0].cost,[]);
  const raw=rows.find(r=>r.id==='en:sv03-125');for(const edit of [{hp:320},{types:['Fire']},{tera:false}])assert.equal(compile({...raw,raw_data:{...raw.raw_data,...edit}}).supported,false);
  const budew=rows.find(r=>r.id==='en:sv08.5-004');assert.equal(compile({...budew,id:'en:unverified-budew'}).supported,false);
});
test('Rare Candy enforces first turn, arrival timing, exact Basic ancestry and hand choices',()=>{
  let s=readyFixture();const basic=face(s,0,'sv03-026'),zard=put(s,0,'sv03-125'),candy=put(s,0,'sv01-191'),wrong=put(s,0,'sv03-164');
  assert.ok(legal(s,0).some(m=>m.action.card===candy.id));
  const young=structuredClone(s);young.players[0].active.entered=young.players[0].turns;assert.equal(legal(young,0).some(m=>m.action.card===candy.id),false);
  const early=structuredClone(s);early.players[0].turns=1;assert.equal(legal(early,0).some(m=>m.action.card===candy.id),false);
  s=act(s,0,{type:'trainer',card:candy.id});s=pick(s,[basic.id]);assert.deepEqual(view(s,0).prompt.options.map(o=>o.id),[zard.id]);reject(s,0,{type:'choose',choices:[wrong.id]});
  s=pick(s,[zard.id]);assert.equal(s.pending.kind,'trigger');assert.equal(s.players[0].active.under[0].card.name,'Charmander');s=pick(s,['skip']);assert.equal(s.phase,'playing');assert.equal(s.players[0].discard.at(-1).card.name,'Rare Candy');assertArena(s);
});
test('Infernal Reign triggers on normal hand evolution, optionally searches and distributes exactly 3 Energy',()=>{
  let s=readyFixture();const parent=face(s,0,'sv03-027'),zard=put(s,0,'sv03-125');for(const c of s.players[0].deck.filter(c=>c.card.kind==='energy'))c.card.type='Fire';
  s=act(s,0,{type:'evolve',card:zard.id,target:parent.id});assert.equal(s.pending.kind,'trigger');s=pick(s,['use']);assert.equal(s.pending.kind,'acceleration_energy');
  const ids=view(s,0).prompt.options.slice(0,3).map(o=>o.id),target=s.players[0].bench[0].id;s=pick(s,ids);
  for(let i=0;i<3;i++)s=pick(s,[target]);assert.equal(s.players[0].bench[0].energy.length,3);assert.equal(s.players[0].energyAttached,false);assert.equal(s.phase,'playing');assertArena(s);
});
test('Infernal Reign does not trigger on evolution from the deck or setup',()=>{
  let s=readyFixture();const parent=face(s,0,'sv03-027',true);const zard=put(s,0,'sv03-125','deck');attack(s,0,{effects:[{kind:'program',program:{kind:'evolve_search',count:1}}]});
  s=act(s,0,{type:'attack',index:0});s=pick(s,[parent.id]);assert.equal(s.pending.kind,'evolve_deck');s=pick(s,[zard.id]);assert.notEqual(s.pending?.kind,'trigger');assert.equal(s.turn,1);
});
test('Burning Darkness counts actual opposing Prize cards taken before Weakness',()=>{
  let s=readyFixture();face(s,0,'sv03-125');power(s,0,2,'Fire');s.players[1].hand.push(...s.players[1].prizes.splice(0,2));s.players[1].active.card.hp=500;s.players[1].active.card.weakness=[];
  s=act(s,0,{type:'attack',index:0});assert.equal(s.players[1].active.damage,240);assert.equal(s.turn,1);
});
test('Quick Search is limited across multiple Pidgeot, even after the first one leaves play',()=>{
  let s=readyFixture();const a=face(s,0,'sv03-164'),b=face(s,0,'sv03-164',true);s=ability(s,a);s=pick(s,[first(s)]);
  assert.equal(legal(s,0).some(m=>m.action.type==='ability'),false);
  const scoop=put(s,0,'sv04-171');s=act(s,0,{type:'trainer',card:scoop.id});s=pick(s,[a.id]);s=finish(s);assert.equal(s.players[0].active.id,b.id);assert.equal(legal(s,0).some(m=>m.action.type==='ability'),false);
});
test('Recon Directive shows top 2 only to its owner, chooses 1 and bottoms the other without shuffle',()=>{
  let s=readyFixture();const u=face(s,0,'sv06-129'),top=s.players[0].deck.slice(0,2),third=s.players[0].deck[2].id;s=ability(s,u);
  assert.equal(s.pending.kind,'look_pick');const own=view(s,0),other=view(s,1),spectator=arenaSpectatorView(s);assert.equal(own.prompt.looked_at.length,2);assert.equal(other.prompt,null);
  for(const c of top){assert.equal(JSON.stringify(other).includes(c.id),false);assert.equal(JSON.stringify(spectator).includes(c.id),false);}
  reject(s,1,{type:'choose',choices:[top[0].id]});s=pick(s,[top[1].id]);assert.equal(s.players[0].deck[0].id,third);assert.equal(s.players[0].deck.at(-1).card.id,top[0].card.id);assert.equal(s.players[0].hand.at(-1).card.id,top[1].card.id);assert.equal(legal(s,0).some(m=>m.action.type==='ability'),false);
});
test('Recon Directive works with only 1 card, and cannot activate with an empty deck',()=>{
  let s=readyFixture();const u=face(s,0,'sv06-129');s.players[0].discard.push(...s.players[0].deck.splice(1));s=ability(s,u);s=pick(s,[first(s)]);assert.equal(s.players[0].deck.length,0);assert.equal(legal(s,0).some(m=>m.action.type==='ability'),false);assertArena(s);
});
test('Phantom Dive places exactly 6 counters only on opposing Bench, including Tera, before KOs',()=>{
  let s=readyFixture();face(s,0,'sv06-130');const bench=face(s,1,'sv06-130',true);power(s,0,1,'Fire');power(s,0,1,'Psychic');s.players[1].active.card.hp=500;s.players[1].active.card.weakness=[];
  s=act(s,0,{type:'attack',index:1});assert.equal(s.players[1].active.damage,200);assert.equal(s.pending.kind,'damage_counter');assert.deepEqual(view(s,0).prompt.options.map(o=>o.id),[bench.id]);
  reject(s,0,{type:'choose',choices:[s.players[1].active.id]});for(let i=0;i<6;i++)s=pick(s,[bench.id]);assert.equal(s.players[1].bench[0].damage,60);assert.equal(s.turn,1);
});
test('Phantom Dive with no opposing Bench completes without a counter prompt',()=>{
  let s=readyFixture({bench:false});face(s,0,'sv06-130');power(s,0,1,'Fire');power(s,0,1,'Psychic');s.players[1].active.card.hp=500;s=act(s,0,{type:'attack',index:1});assert.equal(s.pending,null);assert.equal(s.turn,1);
});
test('Munkidori requires Darkness Energy and damage to move, then transfers rather than heals counters',()=>{
  let s=readyFixture();const u=face(s,0,'sv06-095');s.players[0].bench[0].damage=40;assert.equal(legal(s,0).some(m=>m.action.type==='ability'),false);power(s,0,1,'Darkness');
  const source=s.players[0].bench[0].id,target=s.players[1].bench[0].id;s=ability(s,u);s=pick(s,[source]);assert.deepEqual(view(s,0).prompt.options.map(o=>o.id),['1','2','3']);reject(s,0,{type:'choose',choices:['0']});s=pick(s,['3']);s=pick(s,[target]);assert.equal(s.players[0].bench[0].damage,10);assert.equal(s.players[1].bench[0].damage,30);assert.equal(legal(s,0).some(m=>m.action.type==='ability'),false);
});
test('Munkidori counter movement is unaffected by attack-effect prevention and does not double through α Recovery',()=>{
  let s=readyFixture();const u=face(s,0,'sv06-095');power(s,0,1,'Darkness');u.damage=30;u.card.abilities.push({kind:'trait',modifier:{healMultiplier:2}});s.players[1].bench[0].card.abilities=[{kind:'passive',modifier:{prevent_attack_effects:true}}];const target=s.players[1].bench[0].id;
  s=ability(s,u);s=pick(s,[u.id]);s=pick(s,['2']);s=pick(s,[target]);assert.equal(s.players[0].active.damage,10);assert.equal(s.players[1].bench[0].damage,20);
});
test('Fezandipiti and Unfair Stamp require a KO during the previous opposing turn, excluding Checkup',()=>{
  for(const history of [[],[{turn:2,turnSeat:1,checkup:true}],[{turn:1,turnSeat:1,checkup:false}],[{turn:2,turnSeat:0,checkup:false}]]){const s=readyFixture();face(s,0,'sv06.5-038');const stamp=put(s,0,'sv06-165');s.players[0].knockouts=history;assert.equal(legal(s,0).some(m=>m.action.type==='ability'||m.action.card===stamp.id),false);}
  let s=readyFixture();const u=face(s,0,'sv06.5-038');face(s,0,'sv06.5-038',true);s.players[0].knockouts=[{turn:2,turnSeat:1,checkup:false}];const before=s.players[0].hand.length;s=ability(s,u);assert.equal(s.players[0].hand.length,before+3);assert.equal(legal(s,0).some(m=>m.action.type==='ability'),false);
});
test('actual attack KOs feed next-turn Flip the Script and history survives serialization',()=>{
  let s=readyFixture({turn:1});face(s,0,'sv06.5-038',true);attack(s,1,{damage:500});s=act(s,1,{type:'attack',index:0});s=finish(s);assert.equal(s.turn,0);assert.equal(s.players[0].active.card.name,'Fezandipiti ex');assert.ok(legal(JSON.parse(JSON.stringify(s)),0).some(m=>m.action.type==='ability'));
});
test('Budew Item lock targets the player, allows Tools/Supporters, expires after that next turn',()=>{
  let s=readyFixture();face(s,0,'sv08.5-004');const item=trainer(s,1,{kind:'draw',count:2}),supporter=trainer(s,1,{kind:'draw',count:2,trainerType:'Supporter'}),tool=trainer(s,1,{kind:'tool',hp:20,trainerType:'Tool'});
  s=act(s,0,{type:'attack',index:0});const moves=legal(s,1);assert.equal(moves.some(m=>m.action.card===item.id),false);assert.ok(moves.some(m=>m.action.card===supporter.id));assert.ok(moves.some(m=>m.action.card===tool.id));
  reject(s,1,{type:'trainer',card:item.id});s=act(s,1,{type:'end_turn'});assert.equal(s.players[1].effects.length,0);s=act(s,0,{type:'end_turn'});assert.ok(legal(s,1).some(m=>m.action.card===item.id));
});
test('Dudunsparce draws then shuffles its whole stack and promotes; empty-deck ability is unavailable',()=>{
  let s=readyFixture();const u=face(s,0,'sv05-129');u.under.push(take(s,0,c=>c.card.kind==='pokemon',null));power(s,0,2);const bench=s.players[0].bench[0].id,before=s.players[0].deck.length;
  s=ability(s,u);assert.equal(s.pending.kind,'promote');assert.equal(s.players[0].deck.length,before-3+4);s=pick(s,[bench]);assert.equal(s.players[0].hand.length,3);assert.equal(s.phase,'playing');assertArena(s);
  s.players[0].discard.push(...s.players[0].deck);s.players[0].deck=[];face(s,0,'sv05-129');assert.equal(legal(s,0).some(m=>m.action.type==='ability'),false);
});
test('Baxcalibur can repeatedly accelerate Water without consuming the manual attachment',()=>{
  let s=readyFixture();const u=face(s,0,'sv02-060');for(let i=0;i<2;i++){const e=take(s,0,c=>c.card.kind==='energy');e.card.type='Water';}
  for(let i=0;i<2;i++){s=ability(s,u);s=pick(s,[first(s)]);s=pick(s,[u.id]);}assert.equal(s.players[0].active.energy.length,2);assert.equal(s.players[0].energyAttached,false);assert.equal(legal(s,0).some(m=>m.action.type==='ability'),false);
});
test('Psychic Embrace restricts Energy, recipient type and lethal counter placements',()=>{
  let s=readyFixture();const u=face(s,0,'sv01-086');const e=take(s,0,c=>c.card.kind==='energy','discard');e.card.type='Psychic';u.damage=290;assert.equal(legal(s,0).some(m=>m.action.type==='ability'),false);
  u.damage=280;s=ability(s,u);s=pick(s,[e.id]);assert.deepEqual(view(s,0).prompt.options.map(o=>o.id),[u.id]);s=pick(s,[u.id]);assert.equal(s.players[0].active.damage,300);assert.equal(s.players[0].active.energy.length,1);assertArena(s);
});
test('Buddy-Buddy Poffin searches HP ≤70 Basics directly to Bench without hand-entry triggers',()=>{
  let s=readyFixture();const basic=put(s,0,'sv03-026','deck'),big=put(s,0,'sv06.5-038','deck'),poffin=put(s,0,'sv05-144');s=act(s,0,{type:'trainer',card:poffin.id});const q=view(s,0).prompt;assert.equal(q.max,2);assert.ok(q.options.some(o=>o.id===basic.id));assert.equal(q.options.some(o=>o.id===big.id),false);s=pick(s,[basic.id]);assert.equal(s.players[0].bench.length,2);assert.equal(s.players[0].bench.at(-1).entered,2);assert.equal(s.pending,null);assertArena(s);
});
test('Arven searches Item and Tool separately, reveals each and shuffles only after both',()=>{
  let s=readyFixture();const arven=put(s,0,'sv03-186'),item=put(s,0,'sv01-191','deck'),tool=take(s,0,()=>true,'deck');tool.card={...card('sv01-191'),name:'Synthetic Tool',program:{kind:'tool',trainerType:'Tool',hp:20}};
  const supporter=put(s,0,'sv02-185','deck');s=act(s,0,{type:'trainer',card:arven.id});assert.ok(view(s,0).prompt.options.some(o=>o.id===item.id));assert.equal(view(s,0).prompt.options.some(o=>o.id===tool.id||o.id===supporter.id),false);
  s=pick(s,[item.id]);assert.equal(s.events.some(e=>e.kind==='shuffle'),false);assert.deepEqual(view(s,0).prompt.options.map(o=>o.id),[tool.id]);s=pick(s,[tool.id]);assert.equal(s.events.filter(e=>e.kind==='shuffle').length,1);assert.equal(s.players[0].resolving.length,0);
});
test('Iono bottoms randomized old hands without shuffling the existing top deck and draws by Prizes',()=>{
  let s=readyFixture();const iono=put(s,0,'sv02-185'),own=take(s,0,c=>c.card.kind==='energy'),other=take(s,1,c=>c.card.kind==='energy'),top=s.players.map(p=>p.deck.slice(0,6).map(c=>c.card.id));s=act(s,0,{type:'trainer',card:iono.id},{rng:rngFor(9)});
  assert.deepEqual(s.players.map(p=>p.hand.map(c=>c.card.id)),top);assert.equal(s.players[0].deck.at(-1).card.id,own.card.id);assert.equal(s.players[1].deck.at(-1).card.id,other.card.id);assertArena(s);
});
test('Unfair Stamp draws 5 and 2 and never exposes returned hand identities',()=>{
  let s=readyFixture();const stamp=put(s,0,'sv06-165');s.players[0].knockouts=[{turn:2,turnSeat:1,checkup:false}];const secret=take(s,1,c=>c.card.kind==='energy');s=act(s,0,{type:'trainer',card:stamp.id},{rng:rngFor(21)});assert.equal(s.players[0].hand.length,5);assert.equal(s.players[1].hand.length,2);assert.equal(JSON.stringify(view(s,0)).includes(secret.id),false);assert.equal(s.players[0].discard.at(-1).card.name,'Unfair Stamp');
});
test('Crispin rejects equal Energy types, then puts one in hand and attaches the other',()=>{
  let s=readyFixture();const crispin=put(s,0,'sv08.5-105'),energies=s.players[0].deck.filter(c=>c.card.kind==='energy').slice(0,3);energies[0].card.type='Fire';energies[1].card.type='Fire';energies[2].card.type='Psychic';
  s=act(s,0,{type:'trainer',card:crispin.id});reject(s,0,{type:'choose',choices:[energies[0].id,energies[1].id]});s=pick(s,[energies[0].id,energies[2].id]);s=pick(s,[energies[0].id]);s=pick(s,[s.players[0].active.id]);assert.equal(s.players[0].hand.at(-1).card.type,'Fire');assert.equal(s.players[0].active.energy[0].card.type,'Psychic');assert.equal(s.players[0].energyAttached,false);assertArena(s);
});
test('Counter Catcher requires more remaining Prizes and obeys no-change restrictions',()=>{
  let s=readyFixture();const c=put(s,0,'sv04-160');assert.equal(legal(s,0).some(m=>m.action.card===c.id),false);s.players[1].hand.push(s.players[1].prizes.pop());assert.ok(legal(s,0).some(m=>m.action.card===c.id));const target=s.players[1].bench[0].id;s=act(s,0,{type:'trainer',card:c.id,target});assert.equal(s.players[1].active.id,target);
});
test('opponent-chosen switches pause for the opponent, and clear restrictions on the old Active',()=>{
  let s=readyFixture();s.players[0].active.card.attacks=[attackProgram({name:'Roar',cost:[],damage:10,effect:"Switch out your opponent's Active Pokémon to the Bench. (Your opponent chooses the new Active Pokémon.)"})];s.players[1].active.effects=[{kind:'retreat_lock',expires:4}];const id=s.players[1].bench[0].id;
  s=act(s,0,{type:'attack',index:0});assert.equal(s.pending.seat,1);assert.equal(view(s,0).prompt,null);s=pick(s,[id]);assert.equal(s.turn,1);assert.equal(s.players[1].bench[0].effects.length,0);
});
test('printed attack effects resolve in order: switch before drawing, even with another queued clause',()=>{
  let s=readyFixture();s.players[0].active.card.attacks=[attackProgram({name:'Switch draw',cost:[],damage:10,effect:'Switch this Pokémon with 1 of your Benched Pokémon. Draw 2 cards.'})];const id=s.players[0].bench[0].id;s=act(s,0,{type:'attack',index:0});assert.equal(s.pending.kind,'effect_target');assert.equal(s.players[0].hand.length,0);s=pick(s,[id]);assert.equal(s.players[0].hand.length,2);assert.equal(s.players[0].active.id,id);assert.equal(s.turn,1);
});
test('Energy counted for damage is discarded after damage and before KO Prizes',()=>{
  let s=readyFixture();power(s,0,2);s.players[0].active.card.attacks=[attackProgram({name:'Energy blast',cost:[],damage:'10+',effect:'This attack does 20 more damage for each Energy attached to this Pokémon. Discard all Energy from this Pokémon.'})];s.players[1].active.card.hp=500;s.players[1].active.card.weakness=[];
  s=act(s,0,{type:'attack',index:0});assert.equal(s.players[1].active.damage,50);assert.equal(s.pending.kind,'attack_discard');assert.equal(s.players[0].active.energy.length,2);s=pick(s,view(s,0).prompt.options.map(o=>o.id));assert.equal(s.players[0].active.energy.length,0);assert.equal(s.turn,1);
});
test('self attack lock lasts through the next own turn and is cleared by switching',()=>{
  let s=readyFixture();s.players[0].active.card.attacks=[attackProgram({name:'Heavy',cost:[],damage:10,effect:"During your next turn, this Pokémon can't attack."})];s=act(s,0,{type:'attack',index:0});s=act(s,1,{type:'end_turn'});assert.equal(legal(s,0).some(m=>m.action.type==='attack'),false);
  const old=s.players[0].active.id,c=trainer(s,0,{kind:'switch'});s=act(s,0,{type:'trainer',card:c.id,target:s.players[0].bench[0].id});assert.equal(s.players[0].bench.find(u=>u.id===old).effects.length,0);
});
test('damage reduction applies after Weakness and does not reduce damage-counter effects',()=>{
  let s=readyFixture();s.players[0].active.card.attacks=[attackProgram({name:'Guard',cost:[],damage:0,effect:"During your opponent's next turn, this Pokémon takes 30 less damage from attacks (after applying Weakness and Resistance)."})];s.players[0].active.card.weakness=[{type:s.players[1].active.card.type,value:'x2'}];s=act(s,0,{type:'attack',index:0});attack(s,1,{damage:20,effects:[{kind:'program',program:{kind:'allocate_damage',count:1}}]});s=act(s,1,{type:'attack',index:0});s=pick(s,[s.players[0].active.id]);assert.equal(s.players[0].active.damage,20);
});
test('Manaphy protects Bench damage, while Phantom Dive counters still pass through',()=>{
  let s=readyFixture();face(s,1,'swsh9-041');const bench=s.players[1].bench[0];attack(s,0,{damage:0,effects:[{kind:'bench_damage',side:'opponent',amount:30},{kind:'program',program:{kind:'allocate_damage',count:1,zone:'bench'}}]});s=act(s,0,{type:'attack',index:0});assert.equal(s.players[1].bench[0].damage,0);s=pick(s,[bench.id]);assert.equal(s.players[1].bench[0].damage,10);
});
test('attack immunity is respected unless damage explicitly ignores defending effects',()=>{
  const a={card:{type:'Fire'},energy:[],tools:[]},d={card:{hp:100,weakness:[],resistance:[],abilities:[{kind:'passive',modifier:{reduce_damage:30}}]},effects:[]};
  assert.equal(attackDamage({damage:50,effects:[]},a,d),20);const hit=attackProgram({name:'Shred',cost:[],damage:50,effect:"This attack's damage isn't affected by any effects on your opponent's Active Pokémon."});assert.equal(attackDamage(hit,a,d),50);
});
test('Double Turbo Energy reduces damage before Weakness, and damage cannot restart after reaching zero',()=>{
  let s=readyFixture();power(s,0,1);s.players[0].active.energy[0].card=card('swsh10-216');s.players[1].active.card.hp=500;s.players[1].active.card.weakness=[{type:s.players[0].active.card.type,value:'x2'}];attack(s,0,{damage:50});s=act(s,0,{type:'attack',index:0});assert.equal(s.players[1].active.damage,60);
  const attacker=structuredClone(s.players[0].active),defender=structuredClone(s.players[1].active);attacker.tools=[];defender.card.weakness=[{type:attacker.card.type,value:'+20'}];assert.equal(attackDamage({damage:20,effects:[]},attacker,defender),0);
});
test('rejected unknown clauses never upgrade a card by dropping text',()=>{
  for(const id of ['sv03-125','sv06-130','sv06-129','sv06-095','sv08.5-004']){const r=structuredClone(rows.find(r=>r.id==='en:'+id));r.raw_data.attacks[0].effect=(r.raw_data.attacks[0].effect||'')+' Your opponent skips their next turn.';assert.equal(compile(r).supported,false);}
});
test('CPU uses only disclosed choices and completes each new prompt without stalling',()=>{
  for(const id of ['sv06-129','sv06-095','sv05-129','sv02-060']){let s=readyFixture();const u=face(s,0,id);if(id==='sv06-095'){power(s,0,1,'Darkness');u.damage=20;}if(id==='sv02-060'){const e=take(s,0,c=>c.card.kind==='energy');e.card.type='Water';}s=ability(s,u);let count=0;while(s.pending){const redacted=view(s,s.pending.seat),a=cpuAction(redacted,{rng:rngFor(12)});assert.ok(a);s=act(s,s.pending.seat,a);assert.ok(++count<20);}assertArena(s);}
});
test('simultaneous Active KOs promote the player whose turn would be next first',()=>{
  let s=readyFixture();s.players[0].active.card.hp=30;attack(s,0,{damage:500,effects:[{kind:'recoil',amount:30}]});s=act(s,0,{type:'attack',index:0});while(s.pending.kind==='prize')s=pick(s,['0']);assert.equal(s.pending.kind,'promote');assert.equal(s.pending.seat,1);s=pick(s,[s.players[1].bench[0].id]);assert.equal(s.pending.seat,0);s=finish(s);assert.equal(s.turn,1);
});
test('Shred ignores Active defensive effects while Tera still protects an unrelated Bench target',()=>{
  let s=readyFixture();const bench=face(s,1,'sv06-130',true);s.players[1].active.card.hp=500;attack(s,0,{damage:20});s.players[0].active.card.attacks=[attackProgram({name:'Shred spread',cost:[],damage:20,effect:"This attack's damage isn't affected by any effects on your opponent's Active Pokémon. This attack also does 30 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)"})];s=act(s,0,{type:'attack',index:0});s=pick(s,[bench.id]);assert.equal(s.players[1].bench[0].damage,0);
});
test('before-damage Tool removal precedes HP and defensive damage calculations',()=>{
  let s=readyFixture();const tool=trainer(s,1,{kind:'tool',hp:40,trainerType:'Tool'});s.players[1].active.tools.push(s.players[1].hand.splice(s.players[1].hand.findIndex(c=>c.id===tool.id),1)[0]);s.players[1].active.card.hp=50;s.players[1].active.card.weakness=[];s.players[0].active.card.attacks=[attackProgram({name:'Tool smash',cost:[],damage:50,effect:"Before doing damage, discard all Pokémon Tools from your opponent's Active Pokémon."})];
  s=act(s,0,{type:'attack',index:0});assert.equal(s.pending.kind,'prize');const removal=s.events.findIndex(e=>e.kind==='discard_tools'),hit=s.events.findIndex(e=>e.kind==='attack');assert.ok(removal<hit);assert.equal(s.players[1].discard.length,2);
});
test('coin-until-tails computes its formula and bounded failure leaves the original state intact',()=>{
  let s=readyFixture();s.players[1].active.card.hp=500;s.players[1].active.card.weakness=[];s.players[0].active.card.attacks=[attackProgram({name:'Fury',cost:[],damage:'30x',effect:'Flip a coin until you get tails. This attack does 30 damage for each heads.'})];const coins=[1,1,0];const next=act(s,0,{type:'attack',index:0},{rng:()=>coins.shift()??0});assert.equal(next.players[1].active.damage,60);const before=JSON.stringify(s);assert.throws(()=>act(s,0,{type:'attack',index:0},{rng:()=>1}),/safety limit/);assert.equal(JSON.stringify(s),before);
});
test('complete real-card Charizard and Dragapult decks play to a result through CPU prompts',()=>{
  const entry=(id,quantity)=>({card:card(id),quantity});
  const energy=(type,quantity)=>{const r=compile({...row({category:'Energy',energyType:'Basic'}),name:type+' Energy'});assert.ok(r.supported);return {card:r.card,quantity};};
  const zard=[['sv03-026',4],['sv03-027',2],['sv03-125',3],['sv03-162',3],['sv03-163',1],['sv03-164',2],['sv03-186',4],['sv02-185',3],['sv05-144',4],['sv01-196',4],['sv01-191',4],['sv02-188',2],['sv06.5-061',2],['sv01-181',2],['sv04-160',2],['sv06-165',1]].map(([id,n])=>entry(id,n));zard.push(energy('Fire',17));
  const pult=[['sv06-128',4],['sv06-129',4],['sv06-130',3],['sv06-095',2],['sv08.5-004',2],['sv05-128',1],['sv05-129',1],['sv06.5-038',1],['sv03-186',4],['sv02-185',3],['sv05-144',4],['sv01-196',4],['sv01-191',2],['sv01-181',2],['sv06.5-061',2],['sv04-160',2],['sv06-165',1],['sv08.5-105',2]].map(([id,n])=>entry(id,n));pult.push(energy('Fire',6),energy('Psychic',6),energy('Darkness',4));
  for(const seed of [31,42,81]){let s=newArena([zard,pult],{mode:'practice',rng:rngFor(seed)}),n=0;while(s.phase!=='finished'&&n++<1600){const seat=s.pending?.seat??(s.phase==='setup'?(legal(s,0).some(m=>m.action.type!=='reset_setup')?0:1):s.turn);const a=cpuAction(view(s,seat),{rng:rngFor(n+seed)});assert.ok(a,`No CPU action at ${s.phase}`);s=act(JSON.parse(JSON.stringify(s)),seat,a,{rng:rngFor(seed+n)});assertArena(s);}assert.equal(s.phase,'finished',`CPU did not finish seed ${seed}`);assert.ok([0,1,'draw'].includes(s.result));}
});
test('Iono cannot be played when both hands would be empty after playing it',()=>{
  const s=readyFixture(),c=put(s,0,'sv02-185');assert.equal(s.players[0].hand.length,1);assert.equal(s.players[1].hand.length,0);assert.equal(legal(s,0).some(m=>m.action.card===c.id),false);reject(s,0,{type:'trainer',card:c.id});
});
test('Tenacious Heart leaves 10 HP only from full HP and does not protect counter effects',()=>{
  let s=readyFixture();face(s,1,'sv08-057');s.players[1].active.card.weakness=[];attack(s,0,{damage:500});s=act(s,0,{type:'attack',index:0});assert.equal(s.players[1].active.damage,190);assert.equal(s.pending,null);
  s=act(s,1,{type:'end_turn'});s=act(s,0,{type:'attack',index:0});assert.equal(s.pending.kind,'prize');
  s=readyFixture();face(s,1,'sv08-057');attack(s,0,{damage:0,effects:[{kind:'program',program:{kind:'damage',target:'opponent_active',amount:200}}]});s=act(s,0,{type:'attack',index:0});assert.equal(s.pending.kind,'prize');
});
test('Mimikyu prevents ex attack damage; its Ghost Eye places counters despite damage protection',()=>{
  let s=readyFixture();face(s,0,'sv03-125');power(s,0,2,'Fire');face(s,1,'sv02-097');s=act(s,0,{type:'attack',index:0});assert.equal(s.players[1].active.damage,0);
  power(s,1,1,'Psychic');power(s,1,1);s.players[0].active.card.abilities=[{kind:'passive',modifier:{reduce_damage:50}}];s=act(s,1,{type:'attack',index:0});assert.equal(s.players[0].active.damage,70);
});
