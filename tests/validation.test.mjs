import test from 'node:test';
import assert from 'node:assert/strict';
import * as v from '../lib/validate.mjs';
const id='11111111-1111-4111-8111-111111111111';
const valid={printing_id:id,condition:'NM',quantity:1,wishlist:false,notes:'',revision:0};
test('accepts an explicitly versioned ownership row',()=>assert.deepEqual(v.entryInput(valid),valid));
for(const [label,value] of [['negative',-1],['fractional',1.2],['too high',10000],['numeric string','2'],['NaN',NaN]])
  test('rejects '+label+' quantity',()=>assert.throws(()=>v.entryInput({...valid,quantity:value}),/Quantity/));
test('rejects unknown conditions',()=>assert.throws(()=>v.entryInput({...valid,condition:'GEM'}),/Condition/));
test('rejects a missing revision',()=>assert.throws(()=>v.entryInput({...valid,revision:undefined}),/Revision/));
test('rejects non-boolean wishlist',()=>assert.throws(()=>v.entryInput({...valid,wishlist:'true'}),/Wishlist/));
test('rejects NUL in notes',()=>assert.throws(()=>v.entryInput({...valid,notes:'a\0b'}),/invalid character/));
test('discards client-supplied user IDs',()=>assert.equal(v.entryInput({...valid,user_id:'someone-else'}).user_id,undefined));
test('normalises email without accepting header injection',()=>{
  assert.equal(v.email(' Person@Example.com '),'person@example.com');
  assert.throws(()=>v.email('person@example.com\r\nBcc:other@example.com'));
});
test('password preserves leading and trailing spaces',()=>assert.equal(v.password('  long password  '),'  long password  '));
test('provider identifiers cannot introduce paths or URLs',()=>{
  for(const value of ['../../admin','https://evil.test/','base1?x=y','base1#x','%2fadmin','base1/x']) assert.throws(()=>v.providerId(value));
  assert.equal(v.providerId('SV-P'),'SV-P');
});
test('card IDs have an explicit supported language',()=>{
  assert.equal(v.cardId('en:base1-4'),'en:base1-4');
  assert.throws(()=>v.cardId('de:base1-4'));assert.throws(()=>v.cardId('en:base1:4'));
});
test('binder limits constrain total storage',()=>{
  assert.equal(v.binderInput({title:'My binder',columns:4,rows:4,page_count:60}).page_count,60);
  assert.throws(()=>v.binderInput({title:'My binder',columns:100,rows:3,page_count:1}));
  assert.throws(()=>v.binderInput({title:'My binder',columns:3,rows:3,page_count:0}));
  assert.throws(()=>v.binderInput({title:'My binder',columns:3,rows:3,page_count:2,color:'invalid'}));
});
