import test from 'node:test';
import assert from 'node:assert/strict';
import {applyArenaAction as act,arenaView as view,assertArena,newArena,legalArenaActions as legal} from '../lib/arena/engine.mjs';
import {readyFixture,take,attack,trainer,rngFor} from './helpers/arena-fixtures.mjs';
import {trainingDeck} from '../lib/arena/training.mjs';
import {ARENA_VERSION,LEGACY_EXPANDED_ARENA_VERSION} from '../shared/arena.mjs';
import * as frozen from '../lib/arena/engine-v2.mjs';

const choose=s=>{const q=view(s,s.pending.seat).prompt;return act(s,s.pending.seat,{type:'choose',choices:q.options.slice(0,q.min).map(c=>c.id)});};
const legacy=s=>{const old=JSON.parse(JSON.stringify(s).replaceAll(ARENA_VERSION,LEGACY_EXPANDED_ARENA_VERSION));delete old.tiebreaker;return old;};
test('six-Prize tiebreaker finishes at the first resolved Prize advantage, without taking all six',()=>{
  let s=readyFixture();s.tiebreaker=true;attack(s,0,{damage:500});s=act(s,0,{type:'attack',index:0});s=choose(s);
  assert.equal(s.phase,'finished');assert.equal(s.result,0);assert.equal(s.players[0].prizes.length,5);assert.equal(s.players[1].prizes.length,6);assertArena(s);
});
test('equal simultaneous tiebreaker Prizes continue; a later unequal award wins',()=>{
  let s=readyFixture();s.tiebreaker=true;s.players[0].active.card.hp=30;attack(s,0,{damage:500,effects:[{kind:'recoil',amount:30}]});s=act(s,0,{type:'attack',index:0});while(s.pending)s=choose(s);
  assert.equal(s.phase,'playing');assert.equal(s.tiebreaker,true);assert.equal(s.round,1);assert.equal(s.players[0].prizes.length,5);assert.equal(s.players[1].prizes.length,5);
  attack(s,1,{damage:500});s=act(s,1,{type:'attack',index:0});s=choose(s);assert.equal(s.phase,'finished');assert.equal(s.result,1);assertArena(s);
});
test('simultaneous tie actually redeals and sets six private Prizes per player',()=>{
  let s=readyFixture({bench:false});s.players[0].active.card.hp=30;attack(s,0,{damage:500,effects:[{kind:'recoil',amount:30}]});s=act(s,0,{type:'attack',index:0});while(s.pending)s=choose(s);
  assert.equal(s.phase,'setup');assert.equal(s.round,2);assert.equal(s.tiebreaker,true);s=act(s,s.toss,{type:'first',seat:0});
  for(const seat of [0,1]){const basic=s.players[seat].hand.find(c=>c.card.stage==='Basic');s=act(s,seat,{type:'setup',card:basic.id,zone:'active'});s=act(s,seat,{type:'ready'});}
  while(s.pending)s=choose(s);
  for(const seat of [0,1]){assert.equal(s.players[seat].prizes.length,6);assert.equal(view(s,seat).tiebreaker,true);assert.deepEqual(view(s,seat).players[1-seat].hand,[]);}assertArena(s);
});
for(const destination of ['hand','deck'])test('Trainer up-to recovery requires one eligible public card: '+destination,()=>{
  let s=readyFixture();take(s,0,c=>c.card.kind==='energy','discard');take(s,0,c=>c.card.kind==='energy','discard');const c=trainer(s,0,{kind:'recover',filter:'energy',count:2,optional:true,destination});s=act(s,0,{type:'trainer',card:c.id});
  const q=view(s,0).prompt;assert.equal(q.min,1);assert.equal(q.max,2);assert.throws(()=>act(s,0,{type:'choose',choices:[]}));s=act(s,0,{type:'choose',choices:[q.options[0].id]});assert.equal(s.pending,null);assertArena(s);
});
test('empty-hand shuffle-and-draw draws the existing deck without shuffling or consuming RNG',()=>{
  let s=readyFixture();const c=trainer(s,0,{kind:'shuffle_draw',count:3}),before=s.players[0].deck.map(c=>c.id),faces=s.players[0].deck.slice(0,3).map(c=>c.card.id);assert.equal(s.players[0].hand.length,1);
  let calls=0;s=act(s,0,{type:'trainer',card:c.id},{rng:n=>{calls++;return n-1;}});assert.equal(calls,0);assert.deepEqual(s.players[0].deck.map(c=>c.id),before.slice(3));assert.deepEqual(s.players[0].hand.map(c=>c.card.id),faces);assertArena(s);
});
test('discard-and-draw with an empty deck remains playable when discarding changes the hand',()=>{
  let s=readyFixture();const c=trainer(s,0,{kind:'discard_draw',count:7});take(s,0,c=>c.card.kind==='energy');s.players[0].discard.push(...s.players[0].deck);s.players[0].deck=[];
  assert.ok(legal(s,0).some(m=>m.action.card===c.id));s=act(s,0,{type:'trainer',card:c.id});assert.equal(s.players[0].hand.length,0);assert.equal(s.phase,'playing');assertArena(s);
});
test('serialized Expanded v2 decisions retain zero-card recovery and old shuffle behavior',()=>{
  let s=readyFixture();take(s,0,c=>c.card.kind==='energy','discard');const c=trainer(s,0,{kind:'recover',filter:'energy',count:2,optional:true,destination:'deck'});s=legacy(s);s=act(s,0,{type:'trainer',card:c.id});assert.equal(view(s,0).prompt.min,0);
  const snapshot=JSON.stringify(s),next=act(JSON.parse(snapshot),0,{type:'choose',choices:[]},{rng:rngFor(5)});assert.equal(next.version,LEGACY_EXPANDED_ARENA_VERSION);assert.ok(next.events.some(e=>e.kind==='shuffle'));assertArena(next);assert.deepEqual(view(s,0),frozen.arenaView(s,0));assert.equal(JSON.stringify(s),snapshot);
});
test('frozen Expanded v2 retains one-Prize sudden death; new engines reject that setup',()=>{
  let s=legacy(readyFixture({bench:false}));s.players[0].active.card.hp=30;attack(s,0,{damage:500,effects:[{kind:'recoil',amount:30}]});s=act(s,0,{type:'attack',index:0});while(s.pending)s=choose(s);assert.equal(s.prizeGoal,1);assert.equal(s.version,LEGACY_EXPANDED_ARENA_VERSION);assertArena(s);assert.throws(()=>newArena([trainingDeck(),trainingDeck('tide')],{prizes:1}));
  const rows=trainingDeck().map(r=>({...r,card:{...r.card,compiler:LEGACY_EXPANDED_ARENA_VERSION}}));assert.equal(newArena([rows,rows],{version:LEGACY_EXPANDED_ARENA_VERSION}).version,LEGACY_EXPANDED_ARENA_VERSION);
});
