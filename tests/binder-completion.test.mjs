import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { completionState, completionWishlistInput, completionSelection, completionMatchQuery } from '../lib/binder-completion-logic.mjs';
const normal=randomUUID(),holo=randomUUID(),reverse=randomUUID();
const binder={id:randomUUID(),revision:1,binder_type:'collection',game:'pokemon'};
const slots=[{position:0,printing_id:normal,name:'Pikachu',label:'Normal',language:'en',game:'pokemon'},
  {position:1,printing_id:holo,name:'Pikachu',label:'Holo',language:'en',game:'pokemon',is_collected:true},
  {position:5,printing_id:normal,name:'Pikachu',label:'Normal',language:'en',game:'pokemon'},
  {position:6,printing_id:reverse,name:'Pikachu',label:'Reverse Holo',language:'en',game:'pokemon'}];
const entry=(printing,quantity,wishlist=false)=>({printing_id:printing,condition:'UNKNOWN',quantity,wishlist,revision:1});
const request=(state,ids,extra={})=>completionWishlistInput({preview_token:state.preview_token,printing_ids:ids,...extra});
const throws=(fn,status)=>assert.throws(fn,e=>e.status===status);

test('Collection completion uses exact owned printings and groups repeated missing pockets',()=>{
  const state=completionState(binder,slots,[entry(holo,1),entry(reverse,0,true)]);
  assert.deepEqual(state.progress,{total:4,completed:1,missing:3,missing_printings:2,percent:25});
  assert.deepEqual(state.items.map(i=>i.printing_id),[normal,reverse]);
  assert.deepEqual(state.items[0].positions,[0,5]);assert.equal(state.items[1].wishlist,true);
  assert.equal(completionState(binder,slots,[entry(normal,1)]).progress.completed,2,'one owned copy covers repeated printing indicators');
});
test('Tracking completion follows marks independently of inventory and retains missing marks for repeated targets',()=>{
  const state=completionState({...binder,binder_type:'tracking'},slots,[entry(normal,3)]);
  assert.deepEqual(state.items.map(i=>i.printing_id),[normal,reverse]);assert.equal(state.items[0].owned_quantity,3);
  assert.equal(state.progress.completed,1);
  const mixed=completionState({...binder,binder_type:'tracking'},slots.map((s,i)=>({...s,is_collected:i===0})),[]);
  assert.deepEqual(mixed.items.find(i=>i.printing_id===normal).positions,[5]);
});
test('empty and completed binders have coherent totals',()=>{
  assert.deepEqual(completionState(binder,[],[]).progress,{total:0,completed:0,missing:0,missing_printings:0,percent:0});
  const state=completionState(binder,slots,[entry(normal,1),entry(holo,1),entry(reverse,1)]);
  assert.equal(state.progress.percent,100);assert.equal(state.items.length,0);
});
test('completion response does not carry notes or condition records into the shopping list',()=>{
  const state=completionState(binder,slots,[{...entry(normal,0),notes:'private notes',user_id:'private-user'}]);
  const text=JSON.stringify(state);assert.ok(!text.includes('private notes'));assert.ok(!text.includes('private-user'));assert.ok(!text.includes('UNKNOWN'));
});
test('preview token is order-independent but changes with layout, ownership, wishes, revisions or binder type',()=>{
  const entries=[entry(normal,0),entry(holo,1)],state=completionState(binder,slots,entries);
  assert.equal(completionState(binder,[...slots].reverse(),[...entries].reverse()).preview_token,state.preview_token);
  for(const change of [{quantity:1},{wishlist:true},{revision:2},{condition:'NM'}]){
    assert.notEqual(completionState(binder,slots,[{...entries[0],...change},entries[1]]).preview_token,state.preview_token);
  }
  assert.notEqual(completionState({...binder,revision:2},slots,entries).preview_token,state.preview_token);
  assert.notEqual(completionState({...binder,binder_type:'tracking'},slots,entries).preview_token,state.preview_token);
  assert.notEqual(completionState(binder,slots.slice(1),entries).preview_token,state.preview_token);
});
test('selection adds only missing, not-yet-wishlisted exact printings',()=>{
  const state=completionState(binder,slots,[entry(reverse,0,true)]);
  assert.deepEqual(completionSelection(binder,state,request(state,[normal,reverse])),[normal]);
  throws(()=>completionSelection(binder,state,request(state,[randomUUID()])),409);
  throws(()=>completionSelection(binder,state,{...request(state,[normal]),preview_token:'0'.repeat(64)}),409);
});
test('design Tracking checklists require explicit confirmation of the displayed printing',()=>{
  const design={...binder,binder_type:'tracking',generation:{options:{selection:'designs'}}},state=completionState(design,slots,[]);
  throws(()=>completionSelection(design,state,request(state,[normal])),400);
  assert.deepEqual(completionSelection(design,state,request(state,[normal],{confirm_displayed_printings:true})),[normal]);
});
test('a mismatched game in a legacy layout cannot become a wishlist write',()=>{
  const state=completionState(binder,[{...slots[0],game:'mtg'}],[]);
  throws(()=>completionSelection(binder,state,request(state,[normal])),409);
});
test('bulk payload is bounded, strict and rejects duplicate or malformed IDs',()=>{
  const state=completionState(binder,slots,[]),base={preview_token:state.preview_token,printing_ids:[normal]};
  for(const extra of [{user_id:randomUUID()},{quantity:100},{notes:'override'},{wishlist:false}])throws(()=>completionWishlistInput({...base,...extra}),400);
  for(const ids of [[],[normal,normal],[normal.toUpperCase(),normal],[null],Array.from({length:961},()=>randomUUID())])throws(()=>completionWishlistInput({...base,printing_ids:ids}),400);
  for(const token of ['', 'x'.repeat(64), 'a'.repeat(63)])throws(()=>completionWishlistInput({...base,preview_token:token}),400);
  throws(()=>completionWishlistInput({...base,confirm_displayed_printings:'true'}),400);
});
test('listing query rejects unbounded pages, repeated query parameters and arbitrary filters',()=>{
  assert.deepEqual(completionMatchQuery({printing_id:normal}),{printing_id:normal,page:1});
  for(const page of ['0','-1','1.1','100000',['1','2'],'1;drop table'])throws(()=>completionMatchQuery({printing_id:normal,page}),400);
  throws(()=>completionMatchQuery({printing_id:normal,seller_id:'other'}),400);
});
