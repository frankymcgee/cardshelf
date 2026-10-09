import test from 'node:test';
import assert from 'node:assert/strict';
import { compileArenaCard as compile, deckValidation, attackProgram } from '../lib/arena/cards.mjs';
import { newArena, applyArenaAction as act, legalArenaActions as legal, arenaView as view, assertArena, attackDamage, energySatisfied } from '../lib/arena/engine.mjs';
import { cpuAction } from '../lib/arena/bot.mjs';
import { arenaSpectatorView } from '../lib/arena/spectator.mjs';
import { trainingDeck } from '../lib/arena/training.mjs';
import { ARENA_VERSION, LEGACY_RULES_ARENA_VERSION } from '../shared/arena.mjs';
import { arenaPokemonName } from '../shared/arena-card-name.mjs';
import { readyFixture, row, take, power, attack, trainer, rngFor } from './helpers/arena-fixtures.mjs';

// Acceptance reference: uploaded 30c_rulebook_en.pdf, September 2026, pp18–43.
// Synthetic small profiles isolate each rule; real exact-text fixtures are
// labelled separately. This suite does not certify every printed card effect.
const card=(name,raw={})=>{const result=compile({...row({...(!raw.attacks&&raw.stage==='VSTAR'?{attacks:[{name:'Star Hit',cost:[],damage:10,effect:"(You can't use more than 1 VSTAR Power in a game.)"}]}:{}),...raw}),name});assert.equal(result.supported,true,result.reason);return result.card;};
const rejected=(s,seat,action)=>{const before=JSON.stringify(s);assert.throws(()=>act(s,seat,action));assert.equal(JSON.stringify(s),before);};
const energy=()=>trainingDeck().find(r=>r.card.kind==='energy').card;
const deck=entries=>[...entries,{card:energy(),quantity:60-entries.reduce((n,r)=>n+r.quantity,0)}];
const put=(s,seat,face,zone='hand')=>{const u=take(s,seat,()=>true,zone);u.card=structuredClone(face);return u;};
const setActive=(s,seat,face)=>{s.players[seat].active.card=structuredClone(face);return s.players[seat].active;};
const chooseAll=s=>act(s,s.pending.seat,{type:'choose',choices:view(s,s.pending.seat).prompt.options.slice(0,view(s,s.pending.seat).prompt.max).map(o=>o.id)});

for(const name of ['Pikachu LV. 12','Pikachu Lv.12','Pikachu δ','Pikachu δ (Delta Species)'])test(`p21: Level/Delta are not names: ${name}`,()=>{
  assert.equal(arenaPokemonName(name),arenaPokemonName('Pikachu'));
  assert.equal(deckValidation(deck([{card:card('Pikachu'),quantity:4},{card:card(name),quantity:1}])).playable,false);
});
for(const name of ["Brock's Pikachu",'Alolan Pikachu','Pikachu ex','Pikachu EX','Pikachu ◇','Pikachu ★'])test(`p21/24/31: significant name remains distinct: ${name}`,()=>assert.notEqual(arenaPokemonName(name),arenaPokemonName('Pikachu')));
test('p21: EX/ex remain distinct but hyphen/space variants do not bypass copy limits',()=>{
  assert.notEqual(arenaPokemonName('Pikachu EX'),arenaPokemonName('Pikachu ex'));
  assert.equal(arenaPokemonName('Pikachu-EX'),arenaPokemonName('Pikachu EX'));
});
test('frozen v3 retains its old name semantics and compiler while new matches use v4',()=>{
  const old=compile({...row(),name:'Pikachu'},LEGACY_RULES_ARENA_VERSION).card;
  assert.equal(old.compiler,LEGACY_RULES_ARENA_VERSION);
  assert.equal(deckValidation([{card:old,quantity:4},{card:{...old,name:'Pikachu LV. 12'},quantity:4},{card:{...energy(),compiler:LEGACY_RULES_ARENA_VERSION},quantity:52}],LEGACY_RULES_ARENA_VERSION).playable,true);
  assert.equal(newArena([trainingDeck(),trainingDeck('tide')],{rng:rngFor(44)}).version,ARENA_VERSION);
});
test('p18: lone mulligan waits for opponent setup, then private bonus Bench choices precede reveal',()=>{
  let s=newArena([trainingDeck(),trainingDeck('tide')],{rng:rngFor(44)});
  for(const [seat,p]of s.players.entries()){
    const pool=[...p.hand,...p.deck];p.hand=[];p.deck=pool;
    const remove=predicate=>p.deck.splice(p.deck.findIndex(predicate),1)[0];
    if(seat===0){p.hand.push(remove(c=>c.card.kind==='pokemon'&&c.card.stage==='Basic'));for(let i=0;i<6;i++)p.hand.push(remove(c=>c.card.kind==='energy'));
      const bonus=remove(c=>c.card.kind==='pokemon'&&c.card.stage==='Basic');p.deck.splice(6,0,bonus);
    }else{for(let i=0;i<7;i++)p.hand.push(remove(c=>c.card.kind==='energy'));const basic=remove(c=>c.card.kind==='pokemon'&&c.card.stage==='Basic');p.deck.unshift(basic);}
    p.mulligans=0;
  }
  assert.equal(view(s,1).players[1].mulligan_waiting,true);
  assert.equal(s.events.some(e=>e.kind==='mulligan'),false);
  s=act(s,s.toss,{type:'first',seat:0});
  s=act(s,0,{type:'setup',card:s.players[0].hand[0].id,zone:'active'});
  s=act(s,0,{type:'ready'},{rng:max=>max-1});
  assert.equal(s.players[0].prizes.length,6);assert.equal(s.players[1].mulligans,1);
  assert.equal(s.events.filter(e=>e.kind==='mulligan').length,1);
  assert.equal(view(s,1).players[0].active.hidden,true);
  s=act(s,1,{type:'setup',card:s.players[1].hand.find(c=>c.card.stage==='Basic').id,zone:'active'});
  s=act(s,1,{type:'ready'});assert.equal(s.pending.kind,'bonus');assert.equal(s.setup_complete,false);
  s=act(s,0,{type:'choose',choices:['1']});assert.equal(s.pending.kind,'bonus_bench');
  const q=view(s,0).prompt;assert.equal(q.min,0);assert.equal(q.max,1);assert.equal(view(s,1).prompt,null);
  const bonusId=q.options[0].id;assert.equal(JSON.stringify(view(s,1)).includes(bonusId),false);
  assert.equal(view(s,1).players[0].active.hidden,true);
  s=act(s,0,{type:'choose',choices:[bonusId]});
  assert.equal(s.players[0].bench.length,1);assert.equal(s.setup_complete,true);assert.equal(s.phase,'playing');assertArena(s);
});
test('p18: choosing zero bonus cards is legal and skips the bonus Bench prompt',()=>{
  let s=readyFixture();s.setup_complete=false;s.phase='resolution';s.pending={kind:'bonus',seat:0,max:1};s.queue=[{kind:'reveal'},{kind:'begin',seat:0}];
  const before=s.players[0].hand.length;s=act(s,0,{type:'choose',choices:['0']});assert.equal(s.pending,null);assert.equal(s.setup_complete,true);assert.equal(s.players[0].hand.length,before+1);
});
for(const [name,raw,prizes]of [
  ['Mega Example ex',{suffix:'ex',stage:'Stage1',evolveFrom:'Parent'},3],
  ['Example V',{suffix:'V'},2],
  ['Example VMAX',{stage:'VMAX',evolveFrom:'Example V'},3],
  ['Example VSTAR',{stage:'VSTAR',evolveFrom:'Example V'},2],
  ['Example GX',{suffix:'GX',stage:'Stage2',evolveFrom:'Parent'},2],
  ['Example & Partner GX',{suffix:'TAG TEAM-GX'},3],
  ['Radiant Example',{rarity:'Radiant Rare'},1]
])test(`pp23–34: ${name} has correct stage and ${prizes}-Prize rule`,()=>{
  const c=card(name,raw);assert.equal(c.prizes,prizes);
  let s=readyFixture();setActive(s,1,c);attack(s,0,{damage:500});s=act(s,0,{type:'attack',index:0});assert.equal(s.pending.kind,'prize');assert.equal(s.pending.count,prizes);assertArena(s);
});
test('p23: modern Mega ex evolves normally and does not end the turn',()=>{
  let s=readyFixture();const previous=setActive(s,0,card('Parent'));const c=put(s,0,card('Mega Example ex',{suffix:'ex',stage:'Stage1',evolveFrom:'Parent'}));
  s=act(s,0,{type:'evolve',card:c.id,target:previous.id});assert.equal(s.phase,'playing');assert.equal(s.turn,0);assert.equal(s.players[0].active.card.prizes,3);
});
test('p39: Primal Reversion uses the legacy Mega EX turn-ending rule',()=>{
  let s=readyFixture();const previous=setActive(s,0,card('Example EX',{suffix:'EX'})),c=put(s,0,card('Primal Example EX',{suffix:'EX',stage:'MEGA',evolveFrom:'Example EX'}));
  s=act(s,0,{type:'evolve',card:c.id,target:previous.id});assert.equal(s.turn,1);assert.equal(s.events.some(e=>e.kind==='mega_turn_end'),true);
});
test('p28: one Radiant total, not one per name; Radiant cannot evolve',()=>{
  const a=card('Radiant A',{rarity:'Radiant Rare'}),b=card('Radiant B',{rarity:'Radiant Rare'});
  assert.equal(deckValidation(deck([{card:a,quantity:1},{card:b,quantity:1}])).playable,false);
  assert.equal(deckValidation(deck([{card:a,quantity:1}])).playable,true);
  const s=readyFixture();const previous=setActive(s,0,a),c=put(s,0,card('Impossible Evolution',{stage:'Stage1',evolveFrom:'Radiant A'}));rejected(s,0,{type:'evolve',card:c.id,target:previous.id});
});
test('pp28/30: VSTAR and VMAX evolve only from the matching Basic V',()=>{
  for(const stage of ['VSTAR','VMAX']){const s=readyFixture(),previous=setActive(s,0,card('Example V',{suffix:'V'})),c=put(s,0,card('Example '+stage,{stage,evolveFrom:'Example V'}));
    assert.equal(legal(s,0).some(m=>m.action.card===c.id&&m.action.target===previous.id),true);
    previous.card.rule_box=null;assert.equal(legal(s,0).some(m=>m.action.card===c.id),false);}
});
test('pp28/34: GX/VSTAR attacks share one marker per player for the whole game',()=>{
  for(const family of ['GX','VSTAR']){let s=readyFixture();const raw=family==='GX'?{suffix:'GX'}:{stage:'VSTAR',evolveFrom:'Example V'};
    const face=card('Example '+family,{...raw,attacks:[{name:family==='GX'?'Burst-GX':'Star Burst',cost:[],damage:10,effect:`(You can't use more than 1 ${family==='GX'?'GX attack':'VSTAR Power'} in a game.)`}]});
    setActive(s,0,face);s=act(s,0,{type:'attack',index:0});assert.equal(s.players[0][family==='GX'?'gxUsed':'vstarUsed'],true);
    s.turn=0;s.turnNumber+=1;setActive(s,0,face);rejected(s,0,{type:'attack',index:0});assert.equal(view(s,0).players[0][family==='GX'?'gx_used':'vstar_used'],true);}
});
test('p20: Confusion failure does not consume a GX/VSTAR marker; an attack coin failure does',()=>{
  for(const family of ['GX','VSTAR']){let s=readyFixture();const face=card('Example '+family,{...(family==='GX'?{suffix:'GX'}:{stage:'VSTAR',evolveFrom:'Example V'}),attacks:[{name:family==='GX'?'Burst-GX':'Star Burst',cost:[],damage:10,effect:`Flip a coin. If tails, this attack does nothing. (You can't use more than 1 ${family==='GX'?'GX attack':'VSTAR Power'} in a game.)`}]});
    setActive(s,0,face).conditions.special='confused';let next=act(s,0,{type:'attack',index:0},{rng:()=>0});assert.equal(next.players[0][family==='GX'?'gxUsed':'vstarUsed'],false);
    s.players[0].active.conditions.special=null;next=act(s,0,{type:'attack',index:0},{rng:()=>0});assert.equal(next.players[0][family==='GX'?'gxUsed':'vstarUsed'],true);}
});
test('p28: VSTAR Ability and attack consume the same marker, but GX is independent',()=>{
  let s=readyFixture();const face=card('Example VSTAR',{stage:'VSTAR',evolveFrom:'Example V',abilities:[{type:'Ability',name:'Star Draw',effect:"During your turn, you may draw 2 cards. (You can't use more than 1 VSTAR Power in a game.)"}],attacks:[{name:'Star Hit',cost:[],damage:10,effect:"(You can't use more than 1 VSTAR Power in a game.)"}]});
  const u=setActive(s,0,face);s=act(s,0,{type:'ability',card:u.id,index:0});assert.equal(s.turn,0);assert.equal(s.players[0].vstarUsed,true);assert.equal(s.players[0].gxUsed,false);rejected(s,0,{type:'attack',index:0});rejected(s,0,{type:'ability',card:u.id,index:0});
});
test('p21: a fresh tiebreaker game resets per-game powers, V-UNION names and Lost Zones',()=>{
  let s=readyFixture({bench:false});for(const p of s.players){p.gxUsed=true;p.vstarUsed=true;p.unionPlayed=['mewtwo v-union'];p.lostZone.push(p.deck.pop());}
  s.players[0].active.card.hp=30;attack(s,0,{damage:500,effects:[{kind:'recoil',amount:30}]});s=act(s,0,{type:'attack',index:0});while(s.pending){const q=view(s,s.pending.seat).prompt;s=act(s,s.pending.seat,{type:'choose',choices:q.options.slice(0,q.min).map(o=>o.id)},{rng:max=>max-1});}
  assert.equal(s.round,2);assert.equal(s.prizeGoal,6);for(const p of s.players){assert.equal(p.gxUsed,false);assert.equal(p.vstarUsed,false);assert.deepEqual(p.unionPlayed,[]);assert.deepEqual(p.lostZone,[]);}assertArena(s);
});
test('p35: dual types apply Weakness first, then Resistance of either type',()=>{
  const s=readyFixture(),u=setActive(s,0,card('Dual Example',{types:['Fire','Water']})),d=setActive(s,1,card('Defender',{weaknesses:[{type:'Fire',value:'x2'}],resistances:[{type:'Water',value:'-30'}]}));
  assert.equal(attackDamage({damage:40},u,d),50);assert.equal(attackDamage({damage:40},u,d,40,true),40);assert.equal(attackDamage({damage:0},u,d),0);
});
test('p27: Tera Bench protection prevents attack damage, not damage counters or Active damage',()=>{
  const protection="As long as this Pokemon is on your Bench, prevent all damage done to this Pokemon by attacks (both yours and your opponent's).";
  const s=readyFixture(),u=s.players[0].active,d=setActive(s,1,card('Tera Example ex',{suffix:'ex',effect:protection}));
  assert.equal(attackDamage({damage:40},u,d,40,true),0);assert.equal(attackDamage({damage:40},u,d,40,false),40);
  const c=trainer(s,0,{kind:'damage',target:'opponent_active',amount:20});const n=act(s,0,{type:'trainer',card:c.id});assert.equal(n.players[1].active.damage,20);
});
test('pp20/27: targeted Bench attacks are privately selected and Tera/no-Weakness rules apply',()=>{
  let s=readyFixture();s.players[0].active.card.attacks=[attackProgram({name:'Bench shot',cost:[],damage:0,effect:"This attack does 30 damage to one of your opponent's Pokemon. (Don't apply Weakness and Resistance for Benched Pokemon.)"})];
  const target=s.players[1].bench[0];target.card.weakness=[{type:s.players[0].active.card.type,value:'x2'}];s=act(s,0,{type:'attack',index:0});assert.equal(s.pending.kind,'attack_target');assert.equal(view(s,1).prompt,null);s=act(s,0,{type:'choose',choices:[target.id]});assert.equal(s.players[1].bench[0].damage,30);assert.equal(s.players[1].active.damage,0);
});
test('p21: attack up-to recovery allows zero; Trainer unrestricted searches require one',()=>{
  let s=readyFixture();take(s,0,c=>c.card.kind==='energy','discard');s.players[0].active.card.attacks=[attackProgram({name:'Recover',cost:[],damage:0,effect:'Put up to 2 basic Energy cards from your discard pile into your hand.'})];
  s=act(s,0,{type:'attack',index:0});assert.equal(view(s,0).prompt.min,0);s=act(s,0,{type:'choose',choices:[]});assert.equal(s.turn,1);
  s=readyFixture();const c=put(s,0,card('Unrestricted Search',{category:'Trainer',trainerType:'Item',effect:'Search your deck for up to 2 cards and put them into your hand. Then, shuffle your deck.'}));s=act(s,0,{type:'trainer',card:c.id});assert.equal(view(s,0).prompt.min,1);rejected(s,0,{type:'choose',choices:[]});
});
test('p33: Prism limits are one per name, not one total',()=>{
  const a=card('Example ◇'),b=card('Other ◇');assert.equal(deckValidation(deck([{card:a,quantity:1},{card:b,quantity:1}])).playable,true);assert.equal(deckValidation(deck([{card:a,quantity:2}])).playable,false);
});
test('pp27/33: Prism Knock Out sends only Prism cards to public, unrecoverable Lost Zone',()=>{
  let s=readyFixture();setActive(s,1,card('Example ◇'));power(s,1,1);attack(s,0,{damage:500});s=act(s,0,{type:'attack',index:0});assert.equal(s.players[1].lostZone.length,1);assert.equal(s.players[1].discard.length,1);assert.equal(view(s,0).players[1].lost_zone[0].card.name,'Example ◇');assertArena(s);
});
test('p33: discard-and-draw, Trainer resolution, and discard costs route Prism cards to Lost Zone',()=>{
  let s=readyFixture();const prism=put(s,0,card('Draw ◇',{category:'Trainer',trainerType:'Item',effect:'Draw 2 cards.'}));s=act(s,0,{type:'trainer',card:prism.id});assert.equal(s.players[0].lostZone.length,1);
  const inHand=put(s,0,card('In hand ◇'));const c=trainer(s,0,{kind:'discard_draw',count:2});s=act(s,0,{type:'trainer',card:c.id});assert.equal(s.players[0].lostZone.some(u=>u.card.name===inHand.card.name),true);assertArena(s);
});
test('p36: BREAK inherits attacks/Abilities/Weakness/Resistance/Retreat and keeps its own HP/type',()=>{
  let s=readyFixture();const parent=card('Parent',{retreat:3,weaknesses:[{type:'Water',value:'x2'}],resistances:[{type:'Grass',value:'-20'}],abilities:[{type:'Ability',name:'Draw',effect:'Once during your turn, you may draw a card.'}]});const u=setActive(s,0,parent);u.damage=20;u.conditions.poison=true;
  const c=put(s,0,card('Parent BREAK',{stage:'BREAK',evolveFrom:'Parent',hp:180,types:['Lightning'],retreat:undefined,attacks:[{name:'New attack',cost:[],damage:50}]}));s=act(s,0,{type:'evolve',card:c.id,target:u.id});
  const evolved=s.players[0].active;assert.equal(evolved.card.attacks.length,2);assert.equal(evolved.card.abilities.length,1);assert.equal(evolved.card.hp,180);assert.equal(evolved.card.type,'Lightning');assert.equal(evolved.card.retreat,3);assert.deepEqual(evolved.card.weakness,parent.weakness);assert.equal(evolved.damage,20);assert.equal(evolved.conditions.poison,false);
  attack(s,1,{damage:500});s.turn=1;s.turnNumber++;s=act(s,1,{type:'attack',index:0});const discarded=s.players[0].discard.find(c=>c.card.stage==='BREAK');assert.equal(discarded.card.attacks.length,1);assert.equal(discarded.card.abilities.length,0);assertArena(s);
});
test('p41: printed predecessor overrides stage-number assumptions for Fossil evolutions',()=>{
  const s=readyFixture();const u=setActive(s,0,card('Kabuto'));u.card.stage='RESTORED';const c=put(s,0,card('Kabutops',{stage:'Stage2',evolveFrom:'Kabuto'}));assert.equal(legal(s,0).some(m=>m.action.card===c.id&&m.action.target===u.id),true);
});
test('p44: multi-Energy supplies typed/Colorless costs without double-counting rainbow Energy',()=>{
  const s=readyFixture(),u=s.players[0].active,c=take(s,0,c=>c.card.kind==='energy',null);c.card=card('Double Colorless Energy',{category:'Energy',energyType:'Special',effect:'This card provides 2 Colorless Energy.'});u.energy=[c];assert.equal(energySatisfied(u,['Colorless','Colorless']),true);assert.equal(energySatisfied(u,['Fire']),false);
  c.card=card('Rainbow Example',{category:'Energy',energyType:'Special',effect:'This card provides every type of Energy but provides only 1 Energy at a time.'});assert.equal(energySatisfied(u,['Fire']),true);assert.equal(energySatisfied(u,['Fire','Water']),false);
});
test('p44: Retreat discards enough provided Energy, but rejects unnecessary extra cards',()=>{
  let s=readyFixture();power(s,0,2);s.players[0].active.card.retreat=2;s.players[0].active.energy[0].card=card('Double Colorless Energy',{category:'Energy',energyType:'Special',effect:'This card provides 2 Colorless Energy.'});const target=s.players[0].bench[0].id;s=act(s,0,{type:'retreat',target});const q=view(s,0).prompt;assert.equal(q.min,1);assert.equal(q.max,2);
  rejected(s,0,{type:'choose',choices:q.options.map(o=>o.id)});const cpu=cpuAction(view(s,0),{rng:()=>0});assert.equal(cpu.choices.length,1);s=act(s,0,cpu);assert.equal(s.players[0].active.id,target);assertArena(s);
});
test('p26: ACE SPEC limit includes Special Energy and Trainers together',()=>{
  const a=card('Synthetic ACE Energy',{category:'Energy',energyType:'Special',rarity:'ACE SPEC Rare',effect:'This card provides 2 Colorless Energy.'});
  const b=card('Synthetic ACE Item',{category:'Trainer',trainerType:'Ace Spec',effect:'Draw 2 cards.'});
  assert.equal(a.ace_spec,true);assert.equal(deckValidation(deck([{card:card('Basic'),quantity:4},{card:a,quantity:1},{card:b,quantity:1}])).playable,false);
});
test('pp27/28: Tera metadata never hides unknown gameplay text and VSTAR cannot lose its Power marker',()=>{
  assert.equal(compile({...row({suffix:'ex',tera:true,effect:'Ignore all attacks.'}),name:'Example ex'}).supported,false);
  assert.equal(compile({...row({stage:'VSTAR',evolveFrom:'Example V'}),name:'Example VSTAR'}).supported,false);
});
test('p32: TAG TEAM extra-Energy GX bonus counts Energy units beyond the complete attack cost',()=>{
  for(const n of [2,3]){let s=readyFixture();setActive(s,0,card('Example & Partner GX',{suffix:'TAG TEAM-GX',attacks:[{name:'Megaton Friends GX',cost:['Colorless','Colorless','Colorless','Colorless'],damage:210,effect:"If this Pokemon has at least 1 extra Energy attached to it (in addition to this attack's cost), draw cards until you have 10 cards in your hand. (You can't use more than 1 GX attack in a game.)"}]}));
    power(s,0,n);for(const e of s.players[0].active.energy)e.card=card('Double Colorless Energy',{category:'Energy',energyType:'Special',effect:'This card provides 2 Colorless Energy.'});
    s.players[1].active.card.hp=500;s.players[1].active.card.weakness=[];const before=s.players[0].hand.length;
    s=act(s,0,{type:'attack',index:0});assert.equal(s.players[1].active.damage,210);assert.equal(s.players[0].gxUsed,true);assert.equal(s.players[0].hand.length,n===3?10:before);assertArena(s);
  }
});
test('real Eevee & Snorlax GX effect family compiles every attack, including bonus and attachment',()=>{
  const c=card('Eevee & Snorlax GX',{suffix:'TAG TEAM-GX',hp:270,types:['Colorless'],retreat:4,attacks:[
    {name:'Cheer Up',cost:['Colorless'],effect:'Attach an Energy card from your hand to 1 of your Pokemon.'},
    {name:'Dump Truck Press',cost:['Colorless','Colorless','Colorless','Colorless'],damage:'120+',effect:"If your opponent's Active Pokemon is an Evolution Pokemon, this attack does 120 more damage."},
    {name:'Megaton Friends GX',cost:['Colorless','Colorless','Colorless','Colorless'],damage:210,effect:"If this Pokemon has at least 1 extra Energy attached to it (in addition to this attack's cost), draw cards until you have 10 cards in your hand. (You can't use more than 1 GX attack in a game.)"}
  ]});assert.equal(c.prizes,3);assert.equal(c.attacks[2].power,'gx');assert.equal(c.attacks.length,3);
});
test('p32: attack hand attachment is private, mandatory when possible, and does not spend the normal attachment',()=>{
  let s=readyFixture();attack(s,0,{damage:0});s.players[0].active.card.attacks=[attackProgram({name:'Cheer Up',cost:[],effect:'Attach an Energy card from your hand to 1 of your Pokemon.'})];
  const c=take(s,0,c=>c.card.kind==='energy');s=act(s,0,{type:'attack',index:0});assert.equal(s.pending.kind,'attach_hand_energy');assert.equal(view(s,1).prompt,null);rejected(s,0,{type:'choose',choices:[]});
  s=act(s,0,{type:'choose',choices:[c.id]});assert.equal(s.pending.kind,'attach_hand_target');const target=s.players[0].bench[0].id;s=act(s,0,{type:'choose',choices:[target]});assert.equal(s.players[0].bench[0].energy.length,1);assert.equal(s.players[0].energyAttached,false);assert.equal(s.turn,1);assertArena(s);
});
test('p43: devolution returns the printed top card, retains damage and attachments, and clears Conditions',()=>{
  let s=readyFixture();const parent=setActive(s,1,card('Parent',{hp:200}));power(s,1,1);parent.damage=20;
  s.turn=1;s.turnNumber++;const c=put(s,1,card('Parent BREAK',{stage:'BREAK',evolveFrom:'Parent',hp:250}));s=act(s,1,{type:'evolve',card:c.id,target:parent.id});
  s.players[1].active.conditions.poison=true;s.turn=0;s.turnNumber++;s.players[0].active.card.attacks=[attackProgram({name:'Devolution',cost:[],effect:"Devolve each of your opponent's evolved Pokemon by putting the highest Stage Evolution card on it into your opponent's hand."})];
  s=act(s,0,{type:'attack',index:0});assert.equal(s.players[1].active.card.name,'Parent');assert.equal(s.players[1].active.damage,20);assert.equal(s.players[1].active.energy.length,1);assert.equal(s.players[1].active.conditions.poison,false);
  const returned=s.players[1].hand.find(u=>u.card.stage==='BREAK');assert.equal(returned.card.attacks.length,1);assert.equal(s.players[1].active.under.length,0);assertArena(s);
});
test('p43: devolution finishes for all Pokémon before checking lowered HP Knock Outs',()=>{
  let s=readyFixture();for(const u of [s.players[1].active,s.players[1].bench[0]]){u.card.hp=200;u.damage=90;const previous=take(s,1,()=>true,null);previous.card=card('Small parent',{hp:80});u.under=[previous];}
  s.players[0].active.card.attacks=[attackProgram({name:'Devolution',cost:[],effect:"Devolve each of your opponent's evolved Pokemon by putting the highest Stage Evolution card on it into your opponent's hand."})];
  s=act(s,0,{type:'attack',index:0});assert.equal(s.pending.kind,'prize');assert.equal(s.pending.count,2);assert.equal(s.events.filter(e=>e.kind==='devolve').length,2);assert.equal(s.players[1].hand.filter(c=>c.card.hp===200).length,2);assertArena(s);
});
test('real Raichu BREAK family: complete discard-all clause compiles',()=>assert.deepEqual(attackProgram({name:'Grand Bolt',cost:['Lightning','Colorless','Colorless'],damage:170,effect:'Discard all Energy attached to this Pokemon.'}).effects,[{kind:'discard_energy',count:'all',type:null}]));
test('real Lapras VMAX family: additional Water Energy damage uses Energy units',()=>{
  let s=readyFixture();const face=card('Lapras VMAX',{stage:'VMAX',evolveFrom:'Lapras V',attacks:[{name:'G-Max Pump',cost:[],damage:'90+',effect:'This attack does 30 more damage for each Water Energy attached to this Pokemon.'}]});setActive(s,0,face);power(s,0,2,'Water');s.players[1].active.card.hp=300;s.players[1].active.card.weakness=[];s=act(s,0,{type:'attack',index:0});assert.equal(s.players[1].active.damage,150);
});
test('real Radiant Greninja family: Ability Energy cost is private and mandatory',()=>{
  let s=readyFixture();const face=card('Radiant Example',{rarity:'Radiant Rare',abilities:[{type:'Ability',name:'Concealed Cards',effect:'You must discard an Energy card from your hand in order to use this Ability. Once during your turn, you may draw 2 cards.'}]});const u=setActive(s,0,face);assert.equal(legal(s,0).some(m=>m.action.type==='ability'),false);take(s,0,c=>c.card.kind==='energy');s=act(s,0,{type:'ability',card:u.id,index:0});assert.equal(s.pending.kind,'ability_discard');assert.equal(view(s,1).prompt,null);rejected(s,0,{type:'choose',choices:[]});s=chooseAll(s);assert.equal(s.players[0].discard.length,1);assert.equal(s.players[0].hand.length,2);
});
test('real Moonlight Shuriken family: selects two targets, pays Energy, then resolves both before KOs',()=>{
  let s=readyFixture();s.players[0].active.card.attacks=[attackProgram({name:'Moonlight Shuriken',cost:[],effect:"Discard 2 Energy from this Pokemon. This attack does 90 damage to 2 of your opponent's Pokemon. (Don't apply Weakness and Resistance for Benched Pokemon.)"})];power(s,0,2);s.players[1].active.card.hp=200;s.players[1].active.card.weakness=[];s.players[1].bench[0].card.hp=200;
  s=act(s,0,{type:'attack',index:0});assert.equal(view(s,0).prompt.min,2);s=chooseAll(s);assert.equal(s.pending.kind,'attack_discard');s=chooseAll(s);assert.equal(s.players[1].active.damage,90);assert.equal(s.players[1].bench[0].damage,90);assert.equal(s.players[0].active.energy.length,0);
});
test('p21/real Hail Blade family: any amount permits zero and counts discarded cards, not Energy units',()=>{
  for(const n of [0,2]){let s=readyFixture();s.players[0].active.card.attacks=[attackProgram({name:'Hail Blade',cost:[],damage:'60×',effect:'You may discard any amount of {W} Energy from your Pokemon. This attack does 60 damage for each card you discarded in this way.'})];power(s,0,2,'Water');s.players[1].active.card.hp=300;s.players[1].active.card.weakness=[];s=act(s,0,{type:'attack',index:0});const q=view(s,0).prompt;assert.equal(q.min,0);s=act(s,0,{type:'choose',choices:q.options.slice(0,n).map(o=>o.id)});assert.equal(s.players[1].active.damage,n*60);assertArena(s);}
});

const unionCard=piece=>{
  const input={...row(),id:`en:swshp-SWSH${158+piece}`,set_id:'en:swshp',name:'Mewtwo V-UNION',raw_data:{category:'Pokemon',stage:'V-UNION',suffix:'V',illustrator:'AKIRA EGAWA',hp:310,types:['Psychic'],retreat:0,abilities:[{type:'Ability',name:'Photon Barrier',effect:"Prevent all effects of attacks from your opponent's Pokemon done to this Pokemon. (Damage is not an effect.)"}],attacks:[
    {name:'Union Gain',cost:['Colorless'],effect:'Attach up to 2 Psychic Energy cards from your discard pile to this Pokemon.'},
    {name:'Super Regeneration',cost:['Psychic','Psychic','Colorless'],effect:'Heal 200 damage from this Pokemon.'},
    {name:'Psysplosion',cost:['Psychic','Psychic','Colorless'],effect:"Put 16 damage counters on your opponent's Pokemon in any way you like."},
    {name:'Final Burn',cost:['Psychic','Psychic','Psychic','Colorless'],damage:300}
  ]}};
  const result=compile(input);assert.equal(result.supported,true,result.reason);return result.card;
};
test('p29: four distinct matching V-UNION quarters assemble atomically from discard, not hand',()=>{
  let s=readyFixture();const pieces=[1,2,3,4].map(n=>put(s,0,unionCard(n),'discard'));
  const before=view(s,0).players[0].discard[0];assert.equal(before.card.rule_box,null);for(const key of ['hp','attacks','abilities','retreat'])assert.equal(key in before.card,false);assert.equal('effective_hp' in before,false);
  const move=legal(s,0).find(m=>m.action.type==='union');assert.ok(move);s=act(s,0,move.action);assert.equal(s.players[0].bench.length,2);assert.equal(s.players[0].discard.length,0);
  const u=s.players[0].bench[1];assert.equal(u.parts.length,3);assert.equal(u.under.length,0);assert.equal(view(s,0).players[0].bench[1].card.rule_box,'V-UNION');assert.equal(view(s,0).players[0].bench[1].card.prizes,3);assertArena(s);
  const fresh=readyFixture();for(const n of [1,1,2,3])put(fresh,0,unionCard(n),'discard');assert.equal(legal(fresh,0).some(m=>m.action.type==='union'),false);
  rejected(fresh,0,{type:'bench',card:fresh.players[0].discard[0].id});assert.equal(pieces.length,4);
});
test('p29: V-UNION needs a real Basic in its deck and rejects mixed or unreviewed piece metadata',()=>{
  assert.equal(deckValidation(deck([1,2,3,4].map(n=>({card:unionCard(n),quantity:1})))).playable,false);
  assert.equal(deckValidation(deck([{card:card('Basic'),quantity:1},...[1,2,3,4].map(n=>({card:unionCard(n),quantity:1}))])).playable,true);
  const d=deck([{card:card('Basic'),quantity:1},{card:unionCard(1),quantity:1},{card:{...unionCard(2),union:{...unionCard(2).union,group:'other-set'}},quantity:1}]);assert.equal(deckValidation(d).playable,false);
  assert.equal(compile({...row({stage:'V-UNION',suffix:'V',illustrator:'Wrong'}),id:'en:swshp-SWSH159',name:'Mewtwo V-UNION'}).supported,false);
});
test('p29: V-UNION KO awards three Prizes, returns four separate pieces and cannot be replayed',()=>{
  let s=readyFixture();for(const n of [1,2,3,4])put(s,0,unionCard(n),'discard');s=act(s,0,legal(s,0).find(m=>m.action.type==='union').action);
  const p=s.players[0],old=p.active;p.active=p.bench.pop();p.bench.push(old);s.turn=1;s.turnNumber++;attack(s,1,{damage:500});s=act(s,1,{type:'attack',index:0});assert.equal(s.pending.count,3);assert.equal(s.players[0].discard.filter(c=>c.card.union).length,4);
  s=chooseAll(s);s=chooseAll(s);assert.equal(s.turn,0);assert.equal(legal(s,0).some(m=>m.action.type==='union'),false);assertArena(s);
});
test('p20/29: attack damage counters allocate exactly, do not use Weakness, and all resolve before KOs',()=>{
  let s=readyFixture();s.players[0].active.card.attacks=[attackProgram({name:'Counters',cost:[],effect:"Put 3 damage counters on your opponent's Pokemon in any way you like."})];const target=s.players[1].bench[0];target.card.hp=10;s=act(s,0,{type:'attack',index:0});
  for(let i=0;i<2;i++){s=act(s,0,{type:'choose',choices:[target.id]});assert.equal(s.players[1].bench.some(c=>c.id===target.id),true);assert.equal(s.pending.kind,'damage_counter');}
  s=act(s,0,{type:'choose',choices:[target.id]});assert.equal(s.players[1].bench.some(c=>c.id===target.id),false);assert.equal(s.pending.kind,'prize');assertArena(s);
});
test('p29: Photon Barrier prevents attack effects, not attack damage or Trainer damage counters',()=>{
  let s=readyFixture();const u=setActive(s,1,unionCard(1));u.card.union=null;attack(s,0,{damage:10,effects:[{kind:'condition',condition:'poisoned'}]});s.players[1].active.card.weakness=[];s=act(s,0,{type:'attack',index:0});assert.equal(s.players[1].active.damage,10);assert.equal(s.players[1].active.conditions.poison,false);
});
const fossilEffect="Play this card as if it were a 70-HP Basic Colorless Pokemon. At any time during your turn, you may discard this card from play. This card can't be affected by any Special Conditions, and it can't retreat.";
test('pp33/42: Fossil Item is not a Basic out of play; in play it is a Basic with printed restrictions',()=>{
  const fossil=card('Rare Fossil',{category:'Trainer',trainerType:'Item',hp:70,effect:fossilEffect});assert.equal(deckValidation(deck([{card:fossil,quantity:4}])).playable,false);
  let s=readyFixture();const c=put(s,0,fossil);s=act(s,0,{type:'trainer',card:c.id});const u=s.players[0].bench[1];assert.equal(u.card.kind,'pokemon');assert.equal(u.card.stage,'Basic');assert.equal(u.card.hp,70);
  const p=s.players[0],old=p.active;p.active=p.bench.pop();p.bench.push(old);assert.equal(legal(s,0).some(m=>m.action.type==='retreat'),false);attack(s,1,{damage:10,effects:[{kind:'condition',condition:'poisoned'}]});s.turn=1;s.turnNumber++;s=act(s,1,{type:'attack',index:0});assert.equal(s.players[0].active.conditions.poison,false);
  s.turn=0;s.turnNumber++;const id=s.players[0].active.id;s=act(s,0,{type:'discard_fossil',card:id});assert.equal(s.players[0].discard[0].card.kind,'trainer');assert.equal(s.pending.kind,'promote');assert.equal(s.players[1].prizes.length,6);assertArena(s);
});
test('p33: Fossil can evolve by name, and its discarded card becomes a Trainer again',()=>{
  let s=readyFixture();const c=put(s,0,card('Rare Fossil',{category:'Trainer',trainerType:'Item',hp:70,effect:fossilEffect}));s=act(s,0,{type:'trainer',card:c.id});const u=s.players[0].bench[1];u.entered=0;const evo=put(s,0,card('Arctozolt',{stage:'Stage1',evolveFrom:'Rare Fossil'}));s=act(s,0,{type:'evolve',card:evo.id,target:u.id});assert.equal(s.players[0].bench[1].card.fossil,undefined);
  const p=s.players[0],old=p.active;p.active=p.bench.pop();p.bench.push(old);s.turn=1;s.turnNumber++;attack(s,1,{damage:500});s=act(s,1,{type:'attack',index:0});assert.equal(s.players[0].discard.find(c=>c.card.name==='Rare Fossil').card.kind,'trainer');assertArena(s);
});
test('p41: Restored Fossil bottom-deck search is private, optional and only plays permitted cards',()=>{
  let s=readyFixture();const restored=put(s,0,card('Omanyte',{stage:'RESTORED',evolveFrom:'Helix Fossil Omanyte'}),'deck');const c=put(s,0,card('Helix Fossil Omanyte',{category:'Trainer',trainerType:'Item',effect:'Look at the bottom 7 cards of your deck. You may reveal an Omanyte you find there and put it onto your Bench. Shuffle the other cards back into your deck.'}));
  assert.equal(legal(s,0).some(m=>m.action.type==='bench'&&m.action.card===restored.id),false);s=act(s,0,{type:'trainer',card:c.id});const q=view(s,0).prompt;assert.equal(q.looked_at.length,7);assert.equal(q.max,1);assert.equal(view(s,1).prompt,null);
  for(const u of q.looked_at)assert.equal(JSON.stringify(view(s,1)).includes(u.id),false);s=act(s,0,{type:'choose',choices:[restored.id]});assert.equal(s.players[0].bench[1].card.stage,'RESTORED');assert.equal(s.players[0].bench[1].under.length,0);assert.equal(s.players[0].discard[0].card.name,'Helix Fossil Omanyte');assertArena(s);
});
test('p15: next player orders Checkup effects, Conditions stay grouped, KOs wait for all steps',()=>{
  for(const conditionsFirst of [true,false]){let s=readyFixture();const u=setActive(s,0,card('Healer',{hp:40,abilities:[{type:'Ability',name:'Checkup heal',effect:'During Pokemon Checkup, heal 20 damage from this Pokemon.'}]}));u.damage=20;u.conditions={special:null,poison:true,burn:true};s=act(s,0,{type:'end_turn'});assert.equal(s.pending.kind,'checkup_order');assert.equal(s.pending.seat,1);assert.equal(view(s,0).prompt,null);
    const q=view(s,1).prompt,trigger=q.options.find(o=>o.id!=='conditions').id;s=act(s,1,{type:'choose',choices:[conditionsFirst?'conditions':trigger]},{rng:()=>0});assert.ok(s.players[0].active);assert.equal(s.pending.kind,'checkup_order');assert.equal(view(s,1).prompt.options.length,1);
    s=act(s,1,{type:'choose',choices:[conditionsFirst?trigger:'conditions']},{rng:()=>0});assert.equal(s.players[0].active.damage,30);assert.equal(s.turn,1);assertArena(s);}
});
const flareOwner=" When this card is removed from a Pokemon for any reason, put this card in its owner's discard pile.";
test('p37: Team Flare Hyper Gear attaches only to opponent EX and returns to its original owner',()=>{
  let s=readyFixture();setActive(s,1,card('Example EX',{suffix:'EX'}));const c=put(s,0,card('Head Ringer Team Flare Hyper Gear',{category:'Trainer',trainerType:'Tool',effect:'The attacks of the Pokemon this card is attached to cost Colorless more.'+flareOwner}));
  const target=s.players[1].active.id;rejected(s,0,{type:'trainer',card:c.id,target:s.players[0].active.id});s=act(s,0,{type:'trainer',card:c.id,target});assert.equal(view(s,1).players[1].active.card.attacks[0].cost.length,2);assertArena(s);
  attack(s,0,{damage:500});s=act(s,0,{type:'attack',index:0});assert.equal(s.players[0].discard.some(u=>u.card.name===c.card.name),true);assert.equal(s.players[1].discard.some(u=>u.card.name===c.card.name),false);assertArena(s);
});
test('p37: Jamming Net reduces damage before Weakness/Resistance, never below zero',()=>{
  let s=readyFixture();setActive(s,1,card('Example EX',{suffix:'EX'}));const c=put(s,0,card('Jamming Net Team Flare Hyper Gear',{category:'Trainer',trainerType:'Tool',effect:"The attacks of the Pokemon this card is attached to do 20 less damage to all Defending Pokemon (before applying Weakness and Resistance). (Don't apply Weakness and Resistance for Benched Pokemon.)"+flareOwner}));s=act(s,0,{type:'trainer',card:c.id,target:s.players[1].active.id});assert.equal(attackDamage({damage:30},s.players[1].active,s.players[0].active),10);assert.equal(attackDamage({damage:10},s.players[1].active,s.players[0].active),0);assert.equal(attackDamage({damage:0},s.players[1].active,s.players[0].active),0);
});
test('p32/real Mallow & Lana family: optional full discard cost heals only the switched-out Pokémon',()=>{
  for(const bonus of [true,false]){let s=readyFixture();s.players[0].active.card.hp=200;s.players[0].active.damage=90;const old=s.players[0].active.id,target=s.players[0].bench[0].id;const c=put(s,0,card('Mallow & Lana',{category:'Trainer',trainerType:'Supporter',effect:'Switch your Active Pokemon with 1 of your Benched Pokemon. When you play this card, you may discard 2 other cards from your hand. If you do, heal 120 damage from the Pokemon you moved to your Bench.'}));take(s,0,c=>c.card.kind==='energy');take(s,0,c=>c.card.kind==='energy');s=act(s,0,{type:'trainer',card:c.id,target});assert.deepEqual(view(s,0).prompt.allowed_counts,[0,2]);const q=view(s,0).prompt;rejected(s,0,{type:'choose',choices:[q.options[0].id]});s=act(s,0,{type:'choose',choices:bonus?q.options.slice(0,2).map(o=>o.id):[]});assert.equal(s.players[0].active.id,target);assert.equal(s.players[0].bench.find(u=>u.id===old).damage,bonus?0:90);assert.equal(s.players[0].supporterPlayed,true);assertArena(s);}
});
const machineEffect='The Pokemon this card is attached to can use the attack on this card. (You still need the necessary Energy to use this attack.) If this card is attached to 1 of your Pokemon, discard it at the end of your turn.';
test('p44: Technical Machine grants a costed attack only while attached and expires at end of turn',()=>{
  let s=readyFixture();s.players[0].active.card.attacks=[];const c=put(s,0,card('Technical Machine: Test',{category:'Trainer',trainerType:'Tool',effect:machineEffect,attacks:[{name:'Machine hit',cost:['Colorless'],damage:20}]}));s=act(s,0,{type:'trainer',card:c.id,target:s.players[0].active.id});assert.equal(legal(s,0).some(m=>m.action.type==='attack'),false);power(s,0,1);assert.equal(legal(s,0).some(m=>m.action.type==='attack'),true);s.players[1].active.card.weakness=[];s=act(s,0,{type:'attack',index:0});assert.equal(s.players[1].active.damage,20);assert.equal(s.players[0].active.tools.length,0);assert.equal(s.players[0].discard.some(u=>u.card.name==='Technical Machine: Test'),true);assertArena(s);
});
test('p21/real TM Evolution: up-to-zero is legal and chosen evolutions retain stacks and damage',()=>{
  let s=readyFixture();const bench=s.players[0].bench[0];bench.card.name='Parent';bench.entered=s.players[0].turns;bench.damage=10;const evolution=put(s,0,card('Child',{stage:'Stage1',evolveFrom:'Parent'}),'deck');const c=put(s,0,card('Technical Machine: Evolution',{category:'Trainer',trainerType:'Tool',effect:machineEffect,attacks:[{name:'Evolution',cost:[],effect:'Choose up to 2 of your Benched Pokemon. For each of those Pokemon, search your deck for a card that evolves from that Pokemon and put it onto that Pokemon to evolve it. Then, shuffle your deck.'}]}));s.players[0].active.card.attacks=[];s=act(s,0,{type:'trainer',card:c.id,target:s.players[0].active.id});s=act(s,0,{type:'attack',index:0});assert.equal(view(s,0).prompt.min,0);s=act(s,0,{type:'choose',choices:[bench.id]});assert.equal(s.pending.kind,'evolve_deck');assert.equal(view(s,1).prompt,null);s=act(s,0,{type:'choose',choices:[evolution.id]});assert.equal(s.players[0].bench[0].card.name,'Child');assert.equal(s.players[0].bench[0].damage,10);assert.equal(s.players[0].bench[0].under.length,1);assert.equal(s.turn,1);assertArena(s);
});
test('p21: unrestricted search selections stay private; no card faces enter events or spectators',()=>{
  let s=readyFixture();const c=put(s,0,card('Private search',{category:'Trainer',trainerType:'Item',effect:'Search your deck for up to 2 cards and put them into your hand. Then, shuffle your deck.'}));s=act(s,0,{type:'trainer',card:c.id});const q=view(s,0).prompt,picked=q.options.slice(0,2);s=act(s,0,{type:'choose',choices:picked.map(o=>o.id)});const event=s.events.find(e=>e.kind==='search');assert.equal('revealed' in event,false);const spectator=arenaSpectatorView(s);assert.deepEqual(spectator.players[0].hand,[]);for(const card of s.players[0].hand)assert.equal(JSON.stringify(spectator).includes(card.id),false);
});
test('public spectator includes Lost Zone and power markers, not private prompts or hands',()=>{
  const s=readyFixture();put(s,0,card('Public ◇'),'lostZone');s.players[0].gxUsed=true;const v=arenaSpectatorView(s);assert.equal(v.players[0].gx_used,true);assert.equal(v.players[0].lost_zone.length,1);assert.equal(v.prompt,null);assert.equal('queue' in v,false);
});
test('catalogue safety: verified Tera printing is protected even when provider omits its Tera rule',()=>{
  const input={...row({suffix:'ex',stage:'Stage1',evolveFrom:'Growlithe',hp:280,types:['Fire'],retreat:3,attacks:[{name:'Raging Claws',cost:['Fire','Fire'],damage:'30+',effect:'This attack does 10 more damage for each damage counter on this Pokemon.'},{name:'Bright Flame',cost:['Fire','Fire','Fire'],damage:250,effect:'Discard 2 {R} Energy from this Pokemon.'}]}),id:'en:sv01-032',name:'Arcanine ex'};
  assert.equal(compile(input).supported,true,compile(input).reason);assert.equal(compile(input).card.tera,true);
  assert.equal(compile({...input,id:'en:sv99-999',name:'Ambiguous ex'}).supported,false);
  assert.equal(compile({...input,id:'en:sv99-999',name:'Known non-Tera ex',raw_data:{...input.raw_data,tera:false}}).supported,true);
  assert.equal(compile({...input,name:'Not Arcanine ex'}).supported,false);
});
test('p37: Ancient Traits stay separate from Abilities; α Recovery doubles healing',()=>{
  let s=readyFixture();const u=setActive(s,0,card('Tentacool',{hp:100,abilities:[{type:'Ancient Trait',name:'α Recovery',effect:'When this Pokemon is healed, double the amount healed.'}]}));u.damage=60;
  assert.equal(legal(s,0).some(m=>m.action.type==='ability'),false);const c=trainer(s,0,{kind:'heal',amount:20});s=act(s,0,{type:'trainer',card:c.id,target:u.id});assert.equal(s.players[0].active.damage,20);assert.equal(s.players[0].active.card.abilities[0].kind,'trait');
});
test('p37: α Growth optionally attaches a second hand Energy to the same Pokémon only',()=>{
  let s=readyFixture();const u=setActive(s,0,card('Growth',{abilities:[{type:'Ancient Trait',name:'α Growth',effect:'When you attach an Energy card from your hand to this Pokemon (except with an attack, Ability, or Trainer card), you may attach 2 Energy cards.'}]}));const a=take(s,0,c=>c.card.kind==='energy'),b=take(s,0,c=>c.card.kind==='energy');s=act(s,0,{type:'energy',card:a.id,target:u.id});assert.equal(s.pending.kind,'alpha_energy');assert.equal(view(s,0).prompt.min,0);s=act(s,0,{type:'choose',choices:[b.id]});assert.equal(s.players[0].active.energy.length,2);assert.equal(s.players[0].bench[0].energy.length,0);assert.equal(legal(s,0).some(m=>m.action.type==='energy'),false);assertArena(s);
});
test('p43: reviewed Poké-Power honors its printed Special Condition prohibition',()=>{
  const s=readyFixture(),u=setActive(s,0,card('Power',{abilities:[{type:'Poke-POWER',name:'Draw power',effect:"Once during your turn (before your attack), you may draw 2 cards. This power can't be used if this Pokemon is affected by a Special Condition."}]}));
  assert.equal(legal(s,0).some(m=>m.action.type==='ability'),true);u.conditions.poison=true;assert.equal(legal(s,0).some(m=>m.action.type==='ability'),false);
});
