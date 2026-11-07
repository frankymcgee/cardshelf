import test from 'node:test';
import assert from 'node:assert/strict';
import { printingIncluded, distributionLabel } from '../shared/printing-distribution.mjs';
import { distributionInput, distributionSignals } from '../lib/printing-distribution.mjs';
import { generationInput, makeBinderPlan, previewResult } from '../lib/binder-generation-logic.mjs';
import { completionState } from '../lib/binder-completion-logic.mjs';
import { trackingProgress } from '../shared/binder-types.mjs';

const options=generationInput({title:'Any set',set_ids:['en:any-set'],columns:3,rows:3,selection:'printings'});
const sets=[{id:'en:any-set',name:'Any set',card_count:1,imported_count:1}];
const rows=['normal','holo','reverse'].map((key,i)=>({key,label:key,printing_id:'printing-'+i,card_id:'en:any-set-001',set_id:'en:any-set',
  local_id:'001',name:'Any card',distribution:i===0?'product_exclusive':'regular',position:i,is_collected:i>0,quantity:i>0?1:0}));

test('regular scope keeps genuine unknowns and excludes only confirmed extra distribution',()=>{
  for(const distribution of ['regular','unknown',undefined])assert.equal(printingIncluded({distribution},'regular'),true);
  for(const distribution of ['promo','product_exclusive']){
    assert.equal(printingIncluded({distribution},'regular'),false);assert.equal(printingIncluded({distribution},'all'),true);
  }
  assert.equal(distributionLabel({}), 'Distribution unconfirmed');
});
test('every set uses the same selection rule, with no two-variant limit',()=>{
  assert.equal(makeBinderPlan(options,sets,rows).slot_count,2);
  const all=makeBinderPlan({...options,printing_scope:'all'},sets,rows);assert.equal(all.slot_count,3);
  const unknown=makeBinderPlan(options,sets,rows.map(p=>({...p,distribution:'unknown'})));assert.equal(unknown.slot_count,3);
  assert.equal(previewResult(unknown).unconfirmed_slots,3);
  assert.equal(previewResult(makeBinderPlan(options,sets,rows)).excluded_extras,1);
  const four=rows.concat({...rows[0],key:'cosmos',printing_id:'four',distribution:'regular'}).map(p=>({...p,distribution:'regular'}));
  assert.equal(makeBinderPlan(options,sets,four).slot_count,4);
});
test('design selection prefers an included finish, and preview tokens cover distribution and scope',()=>{
  const p=makeBinderPlan({...options,selection:'designs'},sets,rows);
  assert.equal(p.volumes[0].slots[0].printing_id,rows[1].printing_id);
  const regular=makeBinderPlan(options,sets,rows);
  assert.notEqual(regular.token,makeBinderPlan({...options,printing_scope:'all'},sets,rows).token);
  assert.notEqual(regular.token,makeBinderPlan(options,sets,rows.map(p=>({...p,distribution:'regular'}))).token);
  assert.throws(()=>generationInput({...options,printing_scope:'two-only'}));
});
test('completion and quick checklist percentages share the scope while retaining extra pockets',()=>{
  const b={id:'binder',binder_type:'tracking',printing_scope:'regular',revision:1};
  const before=structuredClone(rows),state=completionState(b,rows,[]);
  assert.equal(state.progress.total,2);assert.equal(state.progress.completed,2);assert.equal(state.progress.percent,100);
  assert.equal(state.items.length,0);assert.equal(state.extras.length,1);assert.deepEqual(rows,before);
  assert.equal(trackingProgress(rows,'regular').percent,100);assert.equal(trackingProgress(rows).percent,67);
  assert.equal(completionState({...b,printing_scope:'all'},rows,[]).progress.total,3);
  assert.equal(completionState({...b,printing_scope:undefined},rows,[]).progress.total,3);
  const changed=rows.map((p,i)=>i? p : {...p,distribution:'unknown'});
  assert.notEqual(state.preview_token,completionState(b,changed,[]).preview_token);
  assert.equal(completionState(b,changed,[]).unconfirmed_slots,1);
});
test('admin corrections require specific evidence, reject unsafe links and support reset/unknown',()=>{
  const valid={distribution:'product_exclusive',revision:1,note:'Deck product listing',evidence_url:'https://www.tcgplayer.com/product/707026'};
  assert.equal(distributionInput(valid).distribution,'product_exclusive');
  for(const change of [{evidence_url:''},{note:''},{distribution:'normal'},{revision:0},{padding:'x'},
    {evidence_url:'javascript:alert(1)'},{evidence_url:'http://example.test'},{evidence_url:'https://user:secret@example.test'}])assert.throws(()=>distributionInput({...valid,...change}));
  assert.equal(distributionInput({distribution:null,revision:1}).distribution,null);
  assert.equal(distributionInput({distribution:'unknown',revision:1}).note,'');
});
test('detailed provider signals remain clues, filter language, and never treat W stamps or missing prices as promo proof',()=>{
  const raw={variants:{normal:true,holo:true,reverse:true,wPromo:true},variants_detailed:[
    {type:'normal',languages:['en'],stamp:['staff'],foil:'cosmos',thirdParty:{tcgplayer:707026},variantId:'shared-finish-id'},
    {type:'normal',languages:['ja'],thirdParty:{tcgplayer:123}},
    {type:'holo',thirdParty:{tcgplayer:704785}},null]};
  const signals=distributionSignals(raw,{key:'normal'},'en');assert.equal(signals.length,1);
  assert.deepEqual(signals[0].stamps,['staff']);assert.equal(signals[0].tcgplayer,707026);
  assert.equal('distribution' in signals[0],false);assert.equal('variantId' in signals[0],false);
  assert.deepEqual(distributionSignals(null,{key:'normal'},'en'),[]);
  assert.deepEqual(distributionSignals(raw,{key:'wPromo'},'en'),[]);
});
