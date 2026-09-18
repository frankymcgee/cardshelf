import test from 'node:test';
import assert from 'node:assert/strict';
import {createCataloguePage} from './helpers/game-catalogue-page.mjs';
import {normaliseGameSets} from '../lib/game-provider-logic.mjs';

const fixtures={
  yugioh:[{set_name:'Synthetic Starter',set_code:'SYN',num_of_cards:2,tcg_date:'2020-01-01'},
    {set_name:'Synthetic Reprint',set_code:'SYN',num_of_cards:1}],
  mtg:{data:[{name:'Synthetic Magic',code:'SMG',totalSetSize:3,releaseDate:'2020-01-01'}]}
};
const catalogue=game=>normaliseGameSets(game,fixtures[game]);
const plain=value=>JSON.parse(JSON.stringify(value));
function deferred(){let resolve,reject;const promise=new Promise((ok,fail)=>{resolve=ok;reject=fail;});return {promise,resolve,reject};}

for(const game of ['yugioh','mtg'])test(game+' set response remains a renderable list after download',async()=>{
  const rows=catalogue(game),calls=[];
  const page=createCataloguePage(async(path,options)=>{calls.push({path,...plain(options)});return rows;});
  page.game.value=game;
  assert.equal(page.sets.value.length,0);
  await page.load();
  // The original page assigned rows.sets (undefined), crashing on this exact read.
  assert.equal(page.sets.value.length,rows.length);
  assert.equal(page.visible.value.length,rows.length);
  assert.equal(page.error.value,'');assert.equal(page.loading.value,false);
  assert.deepEqual(plain(page.sets.value),rows);
  assert.deepEqual(calls,[{path:'/api/admin/game-catalogue/sets',query:{game}}]);
});

test('set search keeps the generated identity and searches name and source code',async()=>{
  const rows=catalogue('yugioh'),page=createCataloguePage(async()=>rows);
  await page.load();page.query.value='REPRINT';
  assert.equal(page.visible.value.length,1);assert.equal(page.visible.value[0].code,rows[1].code);
  page.query.value='syn';assert.equal(page.visible.value.length,2);
  assert.notEqual(rows[0].code,rows[1].code,'Reused vendor codes must remain distinguishable.');
  page.query.value='does-not-exist';assert.equal(page.visible.value.length,0);
  assert.equal(page.sets.value.length,2);
});

test('large catalogues retain all records while showing at most 150 matching choices',async()=>{
  const rows=Array.from({length:175},(_,i)=>({...catalogue('yugioh')[0],code:'SYN-'+i,name:'Set '+i}));
  const page=createCataloguePage(async()=>rows);await page.load();
  assert.equal(page.sets.value.length,175);assert.equal(page.visible.value.length,150);
  page.query.value='Set 174';assert.equal(page.visible.value[0].code,'SYN-174');
});

test('a valid empty response is not an error or an undefined list',async()=>{
  const page=createCataloguePage(async()=>[]);await page.load();
  assert.equal(page.sets.value.length,0);assert.equal(page.visible.value.length,0);
  assert.equal(page.error.value,'');assert.equal(page.loading.value,false);
});

for(const [label,response] of [
  ['undefined',undefined],['null',null],['HTML','<!doctype html>'],['object',{}],
  ['unexpected wrapper',{sets:[]}],['null row',[null]],['missing fields',[{name:'Incomplete'}]],
  ['wrong game',catalogue('mtg')],['missing name',[{...catalogue('yugioh')[0],name:undefined}]],
  ['missing source code',[{...catalogue('yugioh')[0],source_code:undefined}]]
])test('malformed '+label+' response reports an error without corrupting list state',async()=>{
  let result=catalogue('yugioh');const page=createCataloguePage(async()=>result);
  await page.load();page.selected.value=result[0].code;
  result=response;await page.load();
  assert.match(page.error.value,/set catalogue/i);assert.equal(page.loading.value,false);
  assert.equal(page.sets.value.length,2);assert.equal(page.visible.value.length,2);
  assert.equal(page.selected.value,catalogue('yugioh')[0].code);
});

test('an initial network failure leaves the form usable and a retry loads the catalogue',async()=>{
  let failed=true;const page=createCataloguePage(async()=>{if(failed)throw new Error('Provider unavailable');return catalogue('yugioh');});
  await page.load();assert.match(page.error.value,/Provider unavailable/);
  assert.equal(page.sets.value.length,0);assert.equal(page.loading.value,false);
  failed=false;await page.load();assert.equal(page.sets.value.length,2);assert.equal(page.error.value,'');
});

test('duplicate clicks do not start overlapping catalogue downloads',async()=>{
  const pending=deferred();let calls=0;
  const page=createCataloguePage(async()=>{calls++;return pending.promise;});
  const first=page.load();await page.load();assert.equal(calls,1);assert.equal(page.loading.value,true);
  pending.resolve(catalogue('yugioh'));await first;assert.equal(page.loading.value,false);
});

for(const failure of [false,true])test('a stale '+(failure?'failed':'successful')+' load cannot overwrite a newer game selection',async()=>{
  const old=deferred(),next=deferred();let calls=0;
  const page=createCataloguePage(async()=>++calls===1?old.promise:next.promise);
  const first=page.load();page.query.value='old query';page.game.value='mtg';
  assert.equal(page.query.value,'');assert.equal(page.selected.value,'');
  const current=page.load();
  if(failure)old.reject(new Error('Old request failed'));else old.resolve(catalogue('yugioh'));
  await first;assert.equal(page.loading.value,true);assert.equal(page.error.value,'');
  assert.equal(page.sets.value.length,0);
  next.resolve(catalogue('mtg'));await current;
  assert.equal(page.sets.value[0].game,'mtg');assert.equal(page.loading.value,false);
});

test('refresh clears a removed selection instead of queuing an absent set',async()=>{
  let rows=catalogue('yugioh');const page=createCataloguePage(async()=>rows);
  await page.load();page.selected.value=rows[0].code;page.confirmed.value=true;
  await page.load();assert.equal(page.selected.value,rows[0].code);
  rows=[];await page.load();assert.equal(page.selected.value,'');assert.equal(page.confirmed.value,false);
});

test('a selected set queues its canonical code and does not queue during a list refresh',async()=>{
  const calls=[],pending=deferred();let refresh=false;
  const page=createCataloguePage(async(path,options)=>{
    calls.push({path,...plain(options)});
    if(options.method==='POST')return {id:'synthetic-job',already_queued:false};
    return refresh?pending.promise:catalogue('yugioh');
  });
  await page.load();page.selected.value=page.sets.value[1].code;page.confirmed.value=true;
  refresh=true;const loading=page.load();await page.queue();assert.equal(calls.length,2);
  pending.resolve(catalogue('yugioh'));await loading;await page.queue();
  assert.equal(page.job.value,'synthetic-job');assert.equal(page.busy.value,false);
  assert.deepEqual(calls[2],{path:'/api/admin/game-catalogue/import',method:'POST',body:{
    game:'yugioh',code:catalogue('yugioh')[1].code,confirm_provider_terms:true}});
});
