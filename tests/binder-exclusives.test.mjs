import test from 'node:test';
import assert from 'node:assert/strict';
import {exclusiveInput,exclusivePlan} from '../lib/binder-exclusives-logic.mjs';
const binder={id:'b',revision:1,columns:2,rows:2,page_count:1};
const row=(n,key='holo',extra={})=>({printing_id:n+'-'+key,card_id:'en:set-'+n,set_id:'en:set',local_id:String(n),key,label:key,distribution:'regular',position:n,is_collected:true,...extra});
const product=(n,extra={})=>row(n,'normal',{distribution:'product_exclusive',...extra});
const input={action:'add',set_ids:['en:set']};
test('bulk addition inserts exact exclusive finishes in natural number order and pushes existing cards',()=>{
  const existing=[row(10,'holo',{position:2}),row(1,'holo',{position:0})];
  const plan=exclusivePlan(binder,existing,[product(2)],input);
  assert.deepEqual(plan.slots.map(s=>s.local_id),['1','2','10']);assert.deepEqual(plan.slots.map(s=>s.position),[0,1,2]);
  assert.equal(plan.slots[1].is_collected,false);assert.equal(plan.slots[2].is_collected,true);assert.equal(plan.added.length,1);
});
test('removal closes gaps across pages and keeps duplicate pockets, marks and unaffected extras',()=>{
  const other=product(3,{set_id:'en:other',position:9});
  const original=[row(1,'holo',{position:0}),product(1,{position:3}),row(2,'holo',{position:6}),row(2,'holo',{position:7,is_collected:false}),other];
  const copy=structuredClone(original),p=exclusivePlan({...binder,page_count:3},original,[],{...input,action:'remove'});
  assert.equal(p.removed.length,1);assert.deepEqual(p.slots.map(s=>s.position),[0,1,2,3]);assert.deepEqual(p.slots.map(s=>s.is_collected),[true,true,false,true]);
  assert.deepEqual(original,copy);assert.equal(p.page_count,3);
});
test('bulk insertion skips existing printings, deduplicates candidates and retains natural set grouping',()=>{
  const p=exclusivePlan(binder,[product(2,{position:0}),row(1,'holo',{set_id:'en:second',position:1})],[product(2),product(10),product(10),product(1,{set_id:'en:second'})],{...input,set_ids:['en:second','en:set']});
  assert.equal(p.added.length,2);assert.deepEqual(p.slots.map(s=>s.set_id),['en:set','en:set','en:second','en:second']);
});
test('bulk tool never adds promos, unconfirmed printings or retired catalogue choices',()=>{
  const p=exclusivePlan(binder,[],[product(1,{distribution:'promo'}),product(2,{distribution:'unknown'}),product(3,{catalogue_available:false})],input);assert.equal(p.slots.length,0);
});
test('addition expands pages, caps at 60, and can restore an empty binder',()=>{
  const p=exclusivePlan(binder,[],[1,2,3,4,5].map(n=>product(n)),input);assert.equal(p.page_count,2);
  assert.throws(()=>exclusivePlan(binder,[],Array.from({length:241},(_,n)=>product(n)),input),/60 pages/);
});
test('preview tokens reject catalogue reclassification and changed marks/layout',()=>{
  const old=[row(1)],p=exclusivePlan(binder,old,[product(2)],input);
  assert.notEqual(p.token,exclusivePlan(binder,old,[product(2,{distribution:'unknown'})],input).token);
  assert.notEqual(p.token,exclusivePlan(binder,[row(1,'holo',{is_collected:false})],[product(2)],input).token);
  assert.notEqual(p.token,exclusivePlan({...binder,revision:2},old,[product(2)],input).token);
});
test('bulk input validates exact sets, action and bounded preview/apply fields',()=>{
  assert.deepEqual(exclusiveInput({...input,set_ids:['en:set','en:set']}),input);
  for(const bad of [{action:'delete'},{set_ids:[]},{set_ids:['https://example.test']},{quantity:0},{printing_scope:'all'}])assert.throws(()=>exclusiveInput({...input,...bad}));
  assert.throws(()=>exclusiveInput({...input,revision:1,request_id:'bad',preview_token:'a'.repeat(64)},true));
});
