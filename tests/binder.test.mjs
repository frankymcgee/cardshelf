import test from 'node:test';
import assert from 'node:assert/strict';
import {capacity,validateSlotOperation,applySlotOperation,assertSafeResize} from '../lib/binder-logic.mjs';
const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222';
const binder={columns:3,rows:3,page_count:2};
test('binder capacity is rows × columns × pages',()=>assert.equal(capacity(binder),18));
test('placing a card fills one pocket',()=>assert.deepEqual(applySlotOperation([],{action:'place',target:2,printing_id:a}),[{position:2,printing_id:a}]));
test('placement replaces only its target',()=>assert.deepEqual(applySlotOperation([{position:0,printing_id:b},{position:2,printing_id:b}],{action:'place',target:2,printing_id:a}),[{position:0,printing_id:b},{position:2,printing_id:a}]));
test('moving to an empty pocket leaves the source empty',()=>assert.deepEqual(applySlotOperation([{position:0,printing_id:a}],{action:'swap',source:0,target:12}),[{position:12,printing_id:a}]));
test('dropping onto an occupied pocket swaps rather than discards',()=>assert.deepEqual(applySlotOperation([{position:0,printing_id:a},{position:1,printing_id:b}],{action:'swap',source:0,target:1}),[{position:0,printing_id:b},{position:1,printing_id:a}]));
test('moving to the same position is harmless',()=>assert.deepEqual(applySlotOperation([{position:0,printing_id:a}],{action:'swap',source:0,target:0}),[{position:0,printing_id:a}]));
test('moving from an empty source is a conflict',()=>assert.throws(()=>applySlotOperation([],{action:'swap',source:0,target:1}),/empty/));
test('clearing removes only the target',()=>assert.deepEqual(applySlotOperation([{position:0,printing_id:a},{position:1,printing_id:b}],{action:'clear',target:0}),[{position:1,printing_id:b}]));
test('operations do not mutate their input or physical ownership',()=>{
  const existing=[{position:0,printing_id:a}],owned={quantity:2};
  applySlotOperation(existing,{action:'swap',source:0,target:1});
  assert.deepEqual(existing,[{position:0,printing_id:a}]);assert.equal(owned.quantity,2);
});
test('empty and out-of-range positions are validated',()=>{
  assert.equal(validateSlotOperation(binder,{action:'clear',target:17}).target,17);
  for(const target of [-1,18,1.5,'1']) assert.throws(()=>validateSlotOperation(binder,{action:'clear',target}));
  assert.throws(()=>validateSlotOperation(binder,{action:'swap',source:20,target:0}));
  assert.throws(()=>validateSlotOperation(binder,{action:'place',target:0,printing_id:'bad'}));
});
test('shrinking cannot silently remove occupied slots',()=>{
  assertSafeResize({columns:3,rows:3,page_count:1},[0,8]);
  assert.throws(()=>assertSafeResize({columns:3,rows:3,page_count:1},[0,9]),/occupied/);
});
test('repeated planned printings remain separate positions',()=>assert.deepEqual(applySlotOperation([{position:0,printing_id:a}],{action:'place',target:1,printing_id:a}),[{position:0,printing_id:a},{position:1,printing_id:a}]));
