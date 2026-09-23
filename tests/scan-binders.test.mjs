import test from 'node:test';
import assert from 'node:assert/strict';
import {automaticScanPocket,scanBinderPockets} from '../shared/scan-binders.mjs';
import {scanConfirmation} from '../lib/card-scan-logic.mjs';
const printing='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const binder={id:printing,game:'pokemon',binder_type:'collection',rows:2,columns:2,page_count:2,revision:1,slots:[]};
test('automatic placement finds an existing printing across all pages before any empty pocket',()=>{
  const b={...binder,slots:[{position:6,printing_id:printing},{position:4,printing_id:printing},{position:1,printing_id:other}]};
  assert.deepEqual(automaticScanPocket(b,printing),{position:4,existing:true,collected:false,page:2,pocket:1});
  assert.equal(scanBinderPockets(b,printing).some(p=>p.position===1),false);
  assert.equal(b.slots[0].position,6,'Selection does not reorder the binder');
});
test('automatic placement uses the first empty pocket across pages or reports a full binder',()=>{
  const slots=Array.from({length:8},(_,position)=>({position,printing_id:other}));
  assert.equal(automaticScanPocket({...binder,slots},printing),null);
  assert.deepEqual(automaticScanPocket({...binder,slots:slots.filter(s=>s.position!==5)},printing),{position:5,existing:false,collected:false,page:2,pocket:2});
  assert.equal(automaticScanPocket({...binder,slots:slots.map(s=>s.position===7?{...s,printing_id:printing}:s)},printing).position,7,'A full binder still accepts a matching printing');
});
test('collection binders offer empty pockets even when the printing is already planned',()=>{
  assert.deepEqual(scanBinderPockets({...binder,slots:[{position:0,printing_id:printing}]},printing).map(p=>p.position),[0,1,2,3,4,5,6,7]);
});
test('tracking binders reuse missing or collected checklist pockets instead of duplicating rows',()=>{
  const b={...binder,binder_type:'tracking',slots:[{position:0,printing_id:printing,is_collected:true},{position:6,printing_id:printing,is_collected:false}]};
  assert.equal(automaticScanPocket(b,printing).position,6);
  assert.deepEqual(scanBinderPockets(b,printing).map(p=>p.position),[0,6]);
  b.slots.pop();assert.equal(automaticScanPocket(b,printing).collected,true);
  assert.equal(automaticScanPocket({...b,slots:[]},printing).position,0);
});
test('unselected, unsupported and malformed binders have no placement preview',()=>{
  for(const b of [null,{...binder,game:'other'},{...binder,binder_type:'unknown'},{...binder,page_count:1000}])assert.equal(automaticScanPocket(b,printing),null);
  assert.equal(automaticScanPocket(binder,''),null);
});
test('automatic confirmation is explicit and manual confirmation keeps legacy receipt fingerprints',()=>{
  const input={printing_id:printing,condition:'UNKNOWN',quantity:1,entry_revision:0,confirm:true,binder:{id:printing,revision:1,position:0}};
  const legacy=scanConfirmation(input);assert.deepEqual(scanConfirmation({...input,binder:{...input.binder,mode:'manual'}}),legacy);
  const auto={...input,binder:{id:printing,revision:1,mode:'auto'}};
  assert.deepEqual(scanConfirmation(auto).binder,auto.binder);
  for(const change of [{...auto.binder,position:0},{...auto.binder,mode:'replace'},{...auto.binder,revision:0},{...auto.binder,printing_id:other},{id:printing,revision:1}])assert.throws(()=>scanConfirmation({...input,binder:change}));
});
