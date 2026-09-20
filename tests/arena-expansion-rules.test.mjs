import test from 'node:test';
import assert from 'node:assert/strict';
import { applyArenaAction as act, legalArenaActions as legal, arenaView as view, assertArena, attackDamage } from '../lib/arena/engine.mjs';
import { readyFixture, take, power, attack, trainer, rngFor } from './helpers/arena-fixtures.mjs';

const play=(s,seat,c,target)=>act(s,seat,{type:'trainer',card:c.id,...(target?{target}:{})});
const tool=(s,seat,program={},target=s.players[seat].active)=>{
  const c=trainer(s,seat,{kind:'tool',trainerType:'Tool',...program});
  return {card:c,state:play(s,seat,c,target.id)};
};
const ability=(unit,program,limit='turn',name='Reviewed ability')=>{unit.card.abilities=[{kind:'activated',name,text:'Synthetic reviewed effect',limit,program}];};
const use=(s,seat,unit=s.players[seat].active)=>act(s,seat,{type:'ability',card:unit.id,index:0});
const chooseFirst=s=>{const q=view(s,s.pending.seat).prompt;return act(s,s.pending.seat,{type:'choose',choices:q.options.slice(0,q.min).map(o=>o.id)});};
function finishPrompts(s){for(let i=0;s.pending&&i<20;i++)s=chooseFirst(s);assert.equal(s.pending,null);assertArena(s);return s;}
function megaFixture({link=null}={}){
  let s=readyFixture();
  const u=s.players[0].active;u.card.name='Charizard EX';u.card.rule_box='EX';u.card.prizes=2;u.damage=20;u.conditions={special:'asleep',poison:true,burn:true};power(s,0,2);
  if(link)s=tool(s,0,{spiritLink:link}).state;
  const c=take(s,0,x=>x.card.stage==='Stage1');Object.assign(c.card,{name:'M Charizard EX',evolves_from:'Charizard-EX',stage:'MegaEvolution',rule_box:'EX',prizes:2,hp:230});
  return {s,action:{type:'evolve',card:c.id,target:s.players[0].active.id},mega:c};
}

test('EX and ex Knock Outs award two prizes, capped by prizes remaining',()=>{
  for(const rule_box of ['EX','ex'])for(const remaining of [1,6]){
    let s=readyFixture();s.players[1].active.card.rule_box=rule_box;s.players[1].active.card.prizes=2;
    s.players[0].deck.push(...s.players[0].prizes.splice(remaining));attack(s,0,{damage:500});s=act(s,0,{type:'attack',index:0});
    assert.equal(view(s,0).prompt.min,Math.min(remaining,2));assert.ok(view(s,0).prompt.options.every(x=>x.hidden&&!x.card));s=chooseFirst(s);assertArena(s);
  }
});
test('legacy Mega evolution preserves the stack, clears conditions and ends the turn',()=>{
  const {s,action}=megaFixture(),next=act(s,0,action);
  assert.equal(next.players[0].active.card.stage,'MegaEvolution');assert.equal(next.players[0].active.energy.length,2);assert.equal(next.players[0].active.damage,20);
  assert.equal(next.players[0].active.under.length,1);assert.deepEqual(next.players[0].active.conditions,{special:null,poison:false,burn:false});assert.equal(next.turn,1);assert.ok(next.events.some(e=>e.kind==='mega_turn_end'));assertArena(next);
});
test('Mega evolution obeys timing and EX predecessor and cannot evolve from modern ex',()=>{
  const {s,action}=megaFixture();s.players[0].active.card.rule_box='ex';s.players[0].active.card.name='Charizard ex';assert.throws(()=>act(s,0,action));
  s.players[0].active.card.rule_box='EX';s.players[0].active.card.name='Charizard EX';s.players[0].active.evolved=s.players[0].turns;assert.throws(()=>act(s,0,action));
  s.players[0].active.evolved=0;s.players[0].active.entered=s.players[0].turns;assert.throws(()=>act(s,0,action));
});
test('only the matching Spirit Link prevents Mega evolution ending the turn',()=>{
  for(const [link,turn] of [['M Charizard-EX',0],['M Venusaur-EX',1]]){
    const {s,action}=megaFixture({link}),next=act(s,0,action);assert.equal(next.turn,turn);assert.equal(next.players[0].active.tools.length,1);assert.equal(next.players[0].active.under[0].tools.length,0);assertArena(next);
  }
});
test('one Tool per Pokémon, with no opposing attachments and no arbitrary replacement',()=>{
  let s=readyFixture();const target=s.players[0].active.id;s=tool(s,0,{hp:20}).state;const other=trainer(s,0,{kind:'tool',trainerType:'Tool',damage:20});
  assert.throws(()=>play(s,0,other,target));assert.throws(()=>play(s,0,other,s.players[1].active.id));assert.equal(legal(s,0).filter(m=>m.card===other.id).length,1);
  assert.equal(view(s,0).players[0].active.effective_hp,s.players[0].active.card.hp+20);assertArena(s);
});
test('Tool damage bonuses apply before Weakness and Resistance, only with nonzero attack damage',()=>{
  let s=readyFixture();s=tool(s,0,{damage:20}).state;const [u,d]=[s.players[0].active,s.players[1].active];d.card.weakness=[{type:u.card.type,value:'x2'}];d.card.resistance=[{type:u.card.type,value:'-30'}];
  assert.equal(attackDamage({},u,d,30),70);assert.equal(attackDamage({},u,d,0),0);
  u.tools[0].card.program.filter='ex';u.card.rule_box='EX';assert.equal(attackDamage({},u,d,30),30);u.card.rule_box='ex';assert.equal(attackDamage({},u,d,30),70);
});
test('Float Stone permits a free retreat without Energy and still respects conditions and the once-per-turn limit',()=>{
  let s=readyFixture();s.players[0].active.card.retreat=3;s=tool(s,0,{retreat:'free'}).state;assert.equal(view(s,0).players[0].active.effective_retreat,0);
  const target=s.players[0].bench[0].id,blocked=structuredClone(s);blocked.players[0].active.conditions.special='paralyzed';assert.throws(()=>act(blocked,0,{type:'retreat',target}));
  s=act(s,0,{type:'retreat',target});assert.equal(s.pending,null);assert.equal(s.players[0].retreated,true);assert.equal(legal(s,0).some(m=>m.action.type==='retreat'),false);
});
test('a Tool remains attached on evolution; loss of its Basic-only HP bonus can cause a Knock Out',()=>{
  let s=readyFixture();s.players[0].active.card.hp=100;s=tool(s,0,{hp:40,damage:10,filter:'basic'}).state;s.players[0].active.damage=120;
  const c=take(s,0,x=>x.card.stage==='Stage1');c.card.evolves_from=s.players[0].active.card.name;c.card.hp=100;
  s=act(s,0,{type:'evolve',card:c.id,target:s.players[0].active.id});assert.equal(s.players[0].active,null);assert.equal(s.pending.kind,'prize');assert.equal(s.pending.seat,1);assert.equal(s.players[0].discard.length,3);
  s=finishPrompts(s);assert.equal(s.turn,0);assert.equal(s.players[1].prizes.length,5);
});
test('Knock Out discards evolved Pokémon, all underlying cards, Energy and the attached Tool',()=>{
  let s=readyFixture();s=tool(s,0,{hp:20}).state;const c=take(s,0,x=>x.card.stage==='Stage1');c.card.evolves_from=s.players[0].active.card.name;
  s=act(s,0,{type:'evolve',card:c.id,target:s.players[0].active.id});power(s,0,2);s.turn=1;s.turnNumber=4;attack(s,1,{damage:500});s=act(s,1,{type:'attack',index:0});assert.equal(s.players[0].discard.length,5);assert.equal(s.players[0].active,null);assertArena(s);
});
test('a shared Stadium replaces the prior one in its owner discard and enforces name and turn limits',()=>{
  let s=readyFixture();const a=trainer(s,0,{kind:'stadium',trainerType:'Stadium',modifiers:{hp:30,filter:'evolved'}});a.card.name='Training Center';s=play(s,0,a);assert.equal(s.stadium.seat,0);
  const another=trainer(s,0,{kind:'stadium',trainerType:'Stadium',activation:{kind:'heal_all',amount:30,types:['Water','Lightning']}});another.card.name='Rough Seas';assert.throws(()=>play(s,0,another));
  s=act(s,0,{type:'end_turn'});const same=trainer(s,1,{kind:'stadium',trainerType:'Stadium',modifiers:{hp:30,filter:'evolved'}});same.card.name='Training Center';assert.throws(()=>play(s,1,same));
  const b=trainer(s,1,{kind:'stadium',trainerType:'Stadium',activation:{kind:'heal_all',amount:30,types:['Water','Lightning']}});b.card.name='Rough Seas';s=play(s,1,b);
  assert.equal(s.stadium.seat,1);assert.equal(s.players[0].discard.at(-1).card.name,'Training Center');assert.equal(view(s,0).stadium.unit.card.name,'Rough Seas');assertArena(s);
});
test('Stadium activation heals only eligible own Pokémon and is once per player per turn',()=>{
  let s=readyFixture();s.players[0].active.card.type='Water';s.players[0].active.damage=50;s.players[0].bench[0].card.type='Fire';s.players[0].bench[0].damage=40;s.players[1].active.card.type='Water';s.players[1].active.damage=50;
  const c=trainer(s,0,{kind:'stadium',trainerType:'Stadium',activation:{kind:'heal_all',amount:30,types:['Water','Lightning']}});s=play(s,0,c);s=act(s,0,{type:'stadium'});
  assert.equal(s.players[0].active.damage,20);assert.equal(s.players[0].bench[0].damage,40);assert.equal(s.players[1].active.damage,50);assert.throws(()=>act(s,0,{type:'stadium'}));
  s=act(s,0,{type:'end_turn'});s=act(s,1,{type:'stadium'});assert.equal(s.players[1].active.damage,20);
});
test('a newly replaced Stadium has its own activation allowance that turn',()=>{
  let s=readyFixture();const c=trainer(s,0,{kind:'stadium',trainerType:'Stadium',activation:{kind:'heal_all',amount:30,types:['Water']}});c.card.name='First Stadium';s=play(s,0,c);s=act(s,0,{type:'end_turn'});s=act(s,1,{type:'end_turn'});
  s.players[0].active.card.type='Water';s.players[0].active.damage=60;s.players[0].active.card.hp=100;s=act(s,0,{type:'stadium'});
  const d=trainer(s,0,{kind:'stadium',trainerType:'Stadium',activation:{kind:'heal_all',amount:30,types:['Water']}});d.card.name='Replacement Stadium';s=play(s,0,d);s=act(s,0,{type:'stadium'});assert.equal(s.players[0].active.damage,0);
});
test('replacing Training Center resolves simultaneous HP-loss Knock Outs before returning control',()=>{
  let s=readyFixture();for(const p of s.players){p.active.card.stage='Stage1';p.active.card.hp=100;p.active.damage=120;}
  const c=trainer(s,0,{kind:'stadium',trainerType:'Stadium',modifiers:{hp:30,filter:'evolved'}});c.card.name='Training Center';s=play(s,0,c);assert.equal(view(s,0).players[0].active.effective_hp,130);
  s=act(s,0,{type:'end_turn'});const d=trainer(s,1,{kind:'stadium',trainerType:'Stadium',activation:{kind:'heal_all',amount:30,types:['Water']}});d.card.name='Rough Seas';s=play(s,1,d);
  assert.equal(s.players[0].active,null);assert.equal(s.players[1].active,null);assert.equal(s.pending.kind,'prize');assert.equal(legal(s,1).length,0);
  s=finishPrompts(s);assert.equal(s.players[0].prizes.length,5);assert.equal(s.players[1].prizes.length,5);assert.equal(s.turn,1);assert.equal(s.phase,'playing');
});
test('discarding HP Tools can Knock Out multiple targets and aggregates their prize awards',()=>{
  let s=readyFixture();s.turn=1;s.turnNumber=4;s.players[1].active.card.hp=100;s.players[1].bench[0].card.hp=100;s=tool(s,1,{hp:40,filter:'basic'}).state;s=tool(s,1,{hp:40,filter:'basic'},s.players[1].bench[0]).state;
  s.players[1].active.damage=120;s.players[1].bench[0].damage=120;s.players[1].active.card.prizes=2;s.turn=0;s.turnNumber=5;
  const c=trainer(s,0,{kind:'discard_tools',side:'opponent',count:'all'});s=play(s,0,c);assert.equal(s.pending.kind,'prize');assert.equal(s.pending.count,3);assert.equal(s.players[1].discard.length,4);assert.ok(s.players[0].discard.some(x=>x.card.id===c.card.id));
  s=finishPrompts(s);assert.equal(s.phase,'finished');assert.equal(s.result,0);assertArena(s);
});
test('activated Abilities have independent per-instance turn limits and reset on the next own turn',()=>{
  let s=readyFixture();ability(s.players[0].active,{kind:'draw',count:1});ability(s.players[0].bench[0],{kind:'draw',count:1});const initial=s.players[0].hand.length;
  s=use(s,0);assert.equal(s.turn,0);assert.throws(()=>use(s,0));s=use(s,0,s.players[0].bench[0]);assert.equal(s.players[0].hand.length,initial+2);
  s=act(s,0,{type:'end_turn'});s=act(s,1,{type:'end_turn'});s=use(s,0);assertArena(s);
});
test('once-while-in-play Abilities remain used through retreat and later turns',()=>{
  let s=readyFixture();ability(s.players[0].active,{kind:'draw',count:1},'instance');const id=s.players[0].active.id;s=use(s,0);s.players[0].active.card.retreat=0;s=act(s,0,{type:'retreat',target:s.players[0].bench[0].id});
  s=act(s,0,{type:'end_turn'});s=act(s,1,{type:'end_turn'});assert.throws(()=>act(s,0,{type:'ability',card:id,index:0}));
});
test('draw-until Abilities stop at the hand threshold and do not consume themselves when no effect is possible',()=>{
  let s=readyFixture();ability(s.players[0].active,{kind:'draw_until',count:3});s=use(s,0);assert.equal(s.players[0].hand.length,3);
  s=act(s,0,{type:'end_turn'});s=act(s,1,{type:'end_turn'});assert.equal(legal(s,0).some(m=>m.action.type==='ability'),false);assert.throws(()=>use(s,0));
});
test('Ability damage ignores Weakness/Resistance and resolves Knock Out without ending the turn',()=>{
  let s=readyFixture();ability(s.players[0].active,{kind:'damage',amount:20,target:'opponent_active'});s.players[1].active.card.hp=100;s.players[1].active.damage=80;s.players[1].active.card.resistance=[{type:s.players[0].active.card.type,value:'-30'}];
  s=use(s,0);assert.equal(s.pending.kind,'prize');assert.equal(s.players[1].active,null);s=finishPrompts(s);assert.equal(s.turn,0);assert.equal(s.phase,'playing');assert.throws(()=>use(s,0));
});
test('a self-healing Ability is limited, uses its own source and cannot target another Pokémon',()=>{
  let s=readyFixture();ability(s.players[0].bench[0],{kind:'heal_self',amount:30});s.players[0].bench[0].damage=40;s.players[0].active.damage=20;
  s=use(s,0,s.players[0].bench[0]);assert.equal(s.players[0].bench[0].damage,10);assert.equal(s.players[0].active.damage,20);assert.throws(()=>act(s,0,{type:'ability',card:s.players[0].bench[0].id,index:0,target:s.players[0].active.id}));
});
test('multi-step Trainer resumes after each typed choice and is discarded exactly once',()=>{
  let s=readyFixture();s.players[0].active.damage=40;const source=s.players[0].active.id;
  const c=trainer(s,0,{kind:'sequence',steps:[{kind:'draw',count:2},{kind:'heal',amount:30},{kind:'switch'}]});const count=s.players[0].hand.length;s=play(s,0,c);assert.equal(s.players[0].hand.length,count+1);assert.equal(s.pending.kind,'effect_target');assert.equal(view(s,0).prompt.effect_kind,'heal');assert.equal(view(s,1).prompt,null);
  assert.equal(s.players[0].resolving.length,1);assert.equal(legal(s,0).length,0);s=act(s,0,{type:'choose',choices:[source]});assert.equal(s.pending.kind,'effect_target');assert.equal(view(s,0).prompt.effect_kind,'switch');s=chooseFirst(s);
  assert.equal(s.players[0].bench.find(x=>x.id===source).damage,10);assert.equal(s.players[0].resolving.length,0);assert.equal(s.players[0].discard.filter(x=>x.card.id===c.card.id).length,1);assert.equal(s.turn,0);assertArena(s);
});
test('multi-step effect skips impossible optional results and resolves its remaining steps',()=>{
  let s=readyFixture();const c=trainer(s,0,{kind:'sequence',steps:[{kind:'heal',amount:30},{kind:'draw',count:2}]});s=play(s,0,c);assert.equal(s.pending,null);assert.equal(s.players[0].hand.length,2);assert.equal(s.players[0].resolving.length,0);
});
test('multi-step hidden searches retain privacy and cannot be hijacked by the opponent',()=>{
  let s=readyFixture();take(s,0,x=>x.card.kind==='energy','discard');const c=trainer(s,0,{kind:'sequence',steps:[{kind:'search',filter:'pokemon',count:1},{kind:'recover',filter:'energy',count:1,optional:true}]});s=play(s,0,c);
  const hidden=view(s,0).prompt.options[0].id;assert.equal(view(s,1).prompt,null);assert.equal(JSON.stringify(view(s,1)).includes(hidden),false);assert.throws(()=>act(s,1,{type:'choose',choices:[hidden]}));
  s=act(s,0,{type:'choose',choices:[]},{rng:rngFor(55)});assert.equal(s.pending.kind,'recover');assert.equal(s.players[0].resolving.length,1);s=chooseFirst(s);assert.equal(s.players[0].resolving.length,0);assert.equal(s.phase,'playing');assertArena(s);
});
test('recovery into deck reveals chosen eligible cards, shuffles, and does not add them to hand',()=>{
  let s=readyFixture();take(s,0,x=>x.card.kind==='pokemon','discard');take(s,0,x=>x.card.kind==='energy','discard');const c=trainer(s,0,{kind:'recover',filter:'pokemon_or_energy',destination:'deck',count:3,optional:true});const before=s.players[0].deck.length;s=play(s,0,c);const q=view(s,0).prompt;assert.equal(q.options.length,2);s=act(s,0,{type:'choose',choices:q.options.map(o=>o.id)},{rng:rngFor(21)});
  assert.equal(s.players[0].deck.length,before+2);assert.equal(s.players[0].hand.length,0);assert.equal(s.players[0].discard.length,1);assert.ok(s.events.some(e=>e.kind==='recover'&&e.revealed.length===2));assertArena(s);
});
test('pending multi-step choices survive serialization and remain immutable and deterministic with seeded RNG',()=>{
  let s=readyFixture();const c=trainer(s,0,{kind:'sequence',steps:[{kind:'search',filter:'pokemon',count:1},{kind:'draw',count:1}]});s=play(s,0,c);const stored=JSON.stringify(s);const next=act(JSON.parse(stored),0,{type:'choose',choices:[]},{rng:rngFor(77)});
  assert.equal(JSON.stringify(s),stored);assert.equal(next.players[0].hand.length,1);assert.equal(next.players[0].resolving.length,0);assertArena(next);for(const hidden of next.players[0].deck)assert.equal(JSON.stringify(view(next,1)).includes(hidden.id),false);
});

test('conditional switch-and-draw Trainer requires a switch and draws only after its choice',()=>{
  let s=readyFixture({bench:false});const c=trainer(s,0,{trainerType:'Supporter',kind:'sequence',requires_switch:true,steps:[{kind:'switch'},{kind:'draw',count:3}]});assert.throws(()=>play(s,0,c));
  const basic=take(s,0,x=>x.card.kind==='pokemon'&&x.card.stage==='Basic',null);s.players[0].bench.push(basic);s=play(s,0,c);assert.equal(s.pending.kind,'effect_target');assert.equal(s.players[0].hand.length,0);
  s=chooseFirst(s);assert.equal(s.players[0].active.id,basic.id);assert.equal(s.players[0].hand.length,3);assert.equal(s.players[0].supporterPlayed,true);assertArena(s);
});
test('attack self-deck discard reveals only discarded cards and can exhaust the deck without immediate loss',()=>{
  let s=readyFixture();attack(s,0,{damage:10,effects:[{kind:'discard_deck',count:5}]});s.players[0].discard.push(...s.players[0].deck.splice(2));const discarded=s.players[0].deck.map(c=>c.card.id);s=act(s,0,{type:'attack',index:0});
  assert.equal(s.players[0].deck.length,0);assert.equal(s.phase,'playing');assert.equal(s.turn,1);assert.deepEqual(s.events.find(e=>e.kind==='discard_deck').revealed.map(c=>c.id),discarded);assertArena(s);
});
