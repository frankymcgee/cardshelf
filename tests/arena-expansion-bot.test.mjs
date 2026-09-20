import test from 'node:test';
import assert from 'node:assert/strict';
import { cpuAction,driveCpu } from '../lib/arena/bot.mjs';
import { newArena,arenaView,applyArenaAction,assertArena } from '../lib/arena/engine.mjs';
import { trainingDeck } from '../lib/arena/training.mjs';
import { ARENA_VERSION } from '../shared/arena.mjs';
import { readyFixture,power,rngFor,trainer } from './helpers/arena-fixtures.mjs';

const choices=(kind,min,max,options,extra={})=>({version:ARENA_VERSION,seat:0,phase:'resolution',legal:[],players:[{hand:[],bench:[],discard:[]},{hand:[],bench:[],discard:[]}],prompt:{kind,min,max,options,...extra}});
const unit=(id,{damage=0,hp=100,...extra}={})=>({id,damage,energy:[],conditions:{special:null,poison:false,burn:false},card:{name:id,kind:'pokemon',stage:'Basic',hp,attacks:[{name:'Tap',damage:10,cost:[],effects:[]}],...extra}});

test('expanded CPU obeys every visible prompt cardinality and never invents a selection',()=>{
  const options=[{id:'one',card:unit('one')},{id:'two',card:unit('two')}];
  for(const kind of ['search','recover','trainer_discard','promote','effect_target','prize']) {
    for(const [min,max] of [[0,0],[0,1],[1,1],[1,2],[2,2]]) {
      const view=choices(kind,min,max,options),action=cpuAction(view,{rng:()=>0});
      assert.equal(action.type,'choose');
      assert.ok(action.choices.length>=min&&action.choices.length<=max,kind);
      assert.equal(new Set(action.choices).size,action.choices.length);
      assert.ok(action.choices.every(id=>options.some(option=>option.id===id)));
    }
  }
  assert.deepEqual(cpuAction(choices('search',0,2,[]),{rng:()=>0}),{type:'choose',choices:[]});
});

test('expanded CPU uses effect metadata to heal and selects a vulnerable opposing gust target',()=>{
  const healthy=unit('healthy',{damage:10}),injured=unit('injured',{damage:70});
  const options=[healthy,injured].map(card=>({id:card.id,card}));
  const heal=choices('effect_target',1,1,options,{effect_kind:'heal'});
  heal.players[0].active=healthy;heal.players[0].bench=[injured];
  assert.deepEqual(cpuAction(heal,{rng:()=>0}).choices,['injured']);
  const gust=choices('effect_target',1,1,options,{effect_kind:'gust'});
  gust.players[1].active=unit('opponent');gust.players[1].bench=[healthy,injured];
  assert.deepEqual(cpuAction(gust,{rng:()=>0}).choices,['injured']);
});

test('zero-benefit Stadium and draw-until activations are skipped in favour of ending the turn',()=>{
  const active=unit('active',{abilities:[{program:{kind:'draw_until',count:2}}]});
  const view={version:ARENA_VERSION,seat:0,phase:'playing',prompt:null,
    players:[{active,hand:[unit('one'),unit('two')],bench:[],discard:[],deck_count:20},{active:unit('enemy'),hand:[],bench:[],discard:[]}],
    stadium:{unit:{card:{program:{activation:{kind:'heal_all',amount:30,types:['Water']}}}}},
    legal:[{action:{type:'stadium'}},{action:{type:'ability',card:active.id,index:0}},{action:{type:'end_turn'}}]};
  assert.deepEqual(cpuAction(view,{rng:()=>0}),{type:'end_turn'});
});

test('expanded CPU decisions depend only on the player projection',()=>{
  const state=readyFixture();power(state,0,2);
  state.players[0].active.card.abilities=[{name:'Focus',kind:'activated',limit:'turn',program:{kind:'draw',count:1}}];
  const changed=structuredClone(state);
  changed.players[1].deck.reverse();changed.players[1].hand.forEach(card=>{card.card.name='Hidden changed card';});
  assert.deepEqual(cpuAction(arenaView(state,0),{rng:rngFor(4)}),cpuAction(arenaView(changed,0),{rng:rngFor(4)}));
});

test('CPU uses a once-per-turn Ability once and then advances the game',()=>{
  const state=readyFixture();power(state,0,2);
  state.players[0].active.card.abilities=[{name:'Focus',kind:'activated',limit:'turn',program:{kind:'draw',count:1}}];
  const source=state.players[0].active.id,{state:next,steps}=driveCpu(state,{seat:0,rng:rngFor(114),max:32});
  assert.equal(next.events.filter(event=>event.kind==='ability'&&event.target===source).length,1);
  assert.ok(steps<32);assert.ok(next.turn!==0||next.pending?.seat===1||next.phase==='finished');
  assert.ok(next.events.some(event=>event.kind==='attack'));assertArena(next);
});

test('CPU resolves a sequence search and follow-up target through separate legal prompts',()=>{
  let state=readyFixture();state.players[0].active.damage=40;
  const card=trainer(state,0,{kind:'sequence',steps:[{kind:'search',filter:'basic',count:1},{kind:'heal',amount:30}]});
  state=applyArenaAction(state,0,{type:'trainer',card:card.id});
  assert.equal(arenaView(state,0).prompt.kind,'search');
  state=applyArenaAction(state,0,cpuAction(arenaView(state,0),{rng:()=>0}));
  assert.equal(arenaView(state,0).prompt.kind,'effect_target');
  state=applyArenaAction(state,0,cpuAction(arenaView(state,0),{rng:()=>0}));
  assert.equal(state.players[0].active.damage,10);assert.equal(state.pending,null);assertArena(state);
});

// Original synthetic cards exercise programs without depending on provider imports.
function expandedDeck(theme) {
  const rows=trainingDeck(theme),pokemon=rows.filter(row=>row.card.kind==='pokemon');
  pokemon[0].card.abilities=[{name:'Practice Focus',kind:'activated',limit:'turn',text:'Draw one card.',program:{kind:'draw',count:1}}];
  pokemon[1].card.abilities=[{name:'Practice Spark',kind:'activated',limit:'turn',text:'Place 20 damage.',program:{kind:'damage',amount:20,target:'opponent_active'}}];
  pokemon[2].card.abilities=[{name:'Practice Rest',kind:'activated',limit:'turn',text:'Heal 20 damage.',program:{kind:'heal_self',amount:20}}];
  pokemon[3].card={...pokemon[3].card,name:pokemon[3].card.name+' ex',rule_box:'ex',hp:160,prizes:2};
  rows[4].card.program={kind:'tool',trainerType:'Tool',hp:20,text:'The attached Pokemon gets +20 HP.'};
  rows[5].card.program={kind:'stadium',trainerType:'Stadium',activation:{kind:'heal_all',amount:30,types:['Fire','Water']},text:'Once per turn, heal 30 damage from your Fire and Water Pokemon.'};
  rows[6].card.program={kind:'sequence',trainerType:'Supporter',steps:[{kind:'draw',count:2},{kind:'heal',amount:30}],text:'Draw 2 cards. Then heal 30 damage.'};
  return rows;
}

test('expanded CPU games use Tools, Stadiums, Abilities and multi-step Trainers and reach legal results',()=>{
  const observed=new Set();
  for(let seed=1;seed<=12;seed++) {
    const rng=rngFor(seed+9000);
    let state=newArena([expandedDeck('ember'),expandedDeck('tide')],{mode:'practice',rng:rngFor(seed)}),rounds=0;
    while(state.phase!=='finished'&&rounds++<180) {
      for(const seat of [0,1]) {
        for(let steps=0;steps<32&&state.phase!=='finished';steps++) {
          const view=arenaView(state,seat),action=cpuAction(view,{difficulty:seed%3?'normal':'easy',rng});
          if(!action)break;
          if(action.type==='choose') {
            assert.ok(action.choices.length>=view.prompt.min&&action.choices.length<=view.prompt.max);
            assert.ok(action.choices.every(id=>view.prompt.options.some(option=>option.id===id)));
          }else assert.ok(view.legal.some(move=>JSON.stringify(move.action)===JSON.stringify(action)));
          if(action.type==='trainer')observed.add(view.players[seat].hand.find(card=>card.id===action.card).card.program.kind);
          else observed.add(action.type);
          const before=state.actions;state=applyArenaAction(state,seat,action,{rng});assert.equal(state.actions,before+1);assertArena(state);
          assert.deepEqual(arenaView(state,seat).players[1-seat].hand,[]);
        }
      }
    }
    assert.equal(state.phase,'finished','seed '+seed+' did not finish');
    assert.ok(state.result===0||state.result===1);assert.ok(state.actions<4000);
  }
  for(const mechanic of ['tool','stadium','ability','sequence'])assert.ok(observed.has(mechanic),'CPU did not use '+mechanic);
});

test('a saved Core v1 game still completes through the frozen CPU policy',()=>{
  const version='pokemon-core-v1',deck=theme=>trainingDeck(theme).map(row=>({...row,card:{...row.card,compiler:version}})),rng=rngFor(882);
  let state=newArena([deck('ember'),deck('tide')],{version,mode:'practice',rng}),rounds=0;
  while(state.phase!=='finished'&&rounds++<180)for(const seat of [0,1])state=driveCpu(state,{seat,rng}).state;
  assert.equal(state.version,version);assert.equal(state.phase,'finished');assertArena(state);
});
