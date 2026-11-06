import test from 'node:test';
import assert from 'node:assert/strict';
import { binderSpread } from '../shared/binder-book.mjs';
import { applySlotOperation } from '../lib/binder-logic.mjs';
test('right-hand starts cover every real page exactly once in forward and reverse order',()=>{
  for(const right of [true,false]) for(let total=1;total<=60;total++) {
    let page=0;const seen=[],starts=[];
    while(page!==null){const s=binderSpread(page,total,true,right);starts.push(s.current);seen.push(...s.pages);if(s.leadingBlank) assert.deepEqual(s.pages,[0]);page=s.next;}
    assert.deepEqual(seen,Array.from({length:total},(_,i)=>i));
    page=starts.at(-1);const reversed=[];
    while(page!==null){const s=binderSpread(page,total,true,right);reversed.push(s.current);page=s.previous;}
    assert.deepEqual(reversed,starts.toReversed());
  }
});
test('single-page view shows the selected real page without a blank cover',()=>{
  const s=binderSpread(2,5,false,true);assert.deepEqual(s.pages,[2]);assert.equal(s.leadingBlank,false);assert.equal(s.previous,1);assert.equal(s.next,3);
  assert.equal(binderSpread(2,5,true,true).current,1);
  assert.equal(binderSpread(4,5,true,true).next,null);
});
test('automatic gap closing preserves duplicates and stable order across page boundaries',()=>{
  const slots=[{position:0,printing_id:'a'},{position:8,printing_id:'b'},{position:9,printing_id:'a'},{position:24,printing_id:'c'}];
  assert.deepEqual(applySlotOperation(slots,{action:'clear',target:8},true),[{position:0,printing_id:'a'},{position:1,printing_id:'a'},{position:2,printing_id:'c'}]);
  assert.equal(slots[2].position,9);
  assert.deepEqual(applySlotOperation(slots,{action:'clear',target:8}),[slots[0],slots[2],slots[3]]);
});
