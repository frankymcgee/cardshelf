import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { binderType, trackingInput, sameTrackingRequest, assertTrackingSlot } from '../lib/tracking-logic.mjs';
import { trackingProgress, binderTypeLabel, PLAN_FEATURES, planFeatures, TRACKING_COLOUR } from '../shared/binder-types.mjs';
import { testingAccess, CURRENT_FEATURES, BILLING_ENABLED, ACCESS_ENFORCED } from '../shared/platform.mjs';
import { generationInput, makeBinderPlan, previewResult } from '../lib/binder-generation-logic.mjs';
const request = { request_id: randomUUID(), revision: 1, position: 0, printing_id: randomUUID(), collected: true };
const options = { title: 'Tracking fixture', columns: 3, rows: 3, color: '#998877', set_ids: ['en:tracker'], binder_type: 'tracking' };
const sets = [{ id: 'en:tracker', name: 'Test set', series: 'Tests', language: 'en', card_count: 2, imported_count: 2, release_date: '2020-01-01' }];
const candidates = [
  { printing_id: randomUUID(), card_id: 'en:tracker-1', name: 'Fixture One', local_id: '1', set_id: 'en:tracker', key: 'normal', label: 'Normal', quantity: 7 },
  { printing_id: randomUUID(), card_id: 'en:tracker-1', name: 'Fixture One', local_id: '1', set_id: 'en:tracker', key: 'reverse', label: 'Reverse Holo', quantity: 1 },
  { printing_id: randomUUID(), card_id: 'en:tracker-2', name: 'Fixture Two', local_id: '2', set_id: 'en:tracker', key: 'holo', label: 'Holo', quantity: 0 }
];
test('older create requests default to the existing collection binder type', () => { assert.equal(binderType(undefined), 'collection'); assert.equal(binderType(null), 'collection'); });
test('only explicit supported binder types are accepted', () => { for (const s of ['tracking','collection']) assert.equal(binderType(s), s); for (const s of ['plus','free','',{},1]) assert.throws(() => binderType(s)); });
test('quick marks require an explicit boolean state and replay ID', () => { assert.deepEqual(trackingInput(request), request); assert.equal(trackingInput({ ...request, collected: false }).collected, false); });
for (const [field,value] of [['collected',1], ['collected','true'], ['collected',null], ['position',-1], ['position',960], ['position',1.2], ['revision',0], ['revision','1'], ['printing_id','bad'], ['request_id','bad']]) {
  test(`quick mark rejects invalid ${field}=${value}`, () => assert.throws(() => trackingInput({ ...request, [field]: value })));
}
test('quick marks reject privilege and inventory fields', () => { for (const extra of ['user_id','quantity','condition','notes','binder_type']) assert.throws(() => trackingInput({ ...request, [extra]: 'forged' })); });
test('replayed request must match every saved intent field', () => {
  const previous = { position: request.position, printing_id: request.printing_id, collected: true, request_revision: 1 };
  assert.equal(sameTrackingRequest(previous, request), true);
  for (const changes of [{ collected: false }, { position: 2 }, { revision: 2 }, { printing_id: randomUUID() }]) assert.equal(sameTrackingRequest(previous, { ...request, ...changes }), false);
});
test('tracking validates type, capacity and expected printing identity', () => {
  const binder = { binder_type:'tracking', columns:2,rows:2,page_count:1 }, slot = { printing_id: request.printing_id };
  assert.doesNotThrow(() => assertTrackingSlot(binder,slot,request));
  assert.throws(() => assertTrackingSlot({ ...binder,binder_type:'collection' },slot,request));
  assert.throws(() => assertTrackingSlot(binder,slot,{ ...request,position:4 }));
  assert.throws(() => assertTrackingSlot(binder,null,request));
  assert.throws(() => assertTrackingSlot(binder,{printing_id:randomUUID()},request));
});
test('an empty tracker shows zero percent rather than NaN or complete', () => assert.deepEqual(trackingProgress([]), { total:0,collected:0,missing:0,percent:0 }));
test('progress counts saved marks, not collection ownership flags', () => {
  const rows=[{owned:true,is_collected:false},{owned:false,is_collected:true},{owned:true}];
  assert.deepEqual(trackingProgress(rows),{total:3,collected:1,missing:2,percent:33});
  assert.equal(trackingProgress([{is_collected:'true'}]).collected,0);
});
test('binder labels preserve old collection binders and identify trackers', () => { assert.equal(binderTypeLabel({}), 'Collection binder'); assert.equal(binderTypeLabel({binder_type:'tracking'}),'Tracking binder'); });
test('tracking generation includes missing and owned designs but starts all uncollected', () => {
  const plan=makeBinderPlan(generationInput(options),sets,candidates);
  assert.equal(plan.slot_count,2);assert.equal(plan.owned_slots,0);assert.ok(plan.volumes[0].slots.every(s=>s.owned===false));
  assert.equal(plan.options.color,TRACKING_COLOUR);assert.equal(previewResult(plan).binder_type,'tracking');
});
test('tracking printing checklist retains each known printing separately', () => assert.equal(makeBinderPlan(generationInput({...options,selection:'printings'}),sets,candidates).slot_count,3));
test('unrelated inventory updates do not invalidate a tracking preview', () => {
  const input=generationInput(options);
  assert.equal(makeBinderPlan(input,sets,candidates).token,makeBinderPlan(input,sets,candidates.map(c=>({...c,quantity:100}))).token);
});
test('binder type is part of preview identity', () => {
  assert.notEqual(makeBinderPlan(generationInput(options),sets,candidates).token,makeBinderPlan(generationInput({...options,binder_type:'collection'}),sets,candidates).token);
});
test('tracking rejects owned-only truncation instead of silently omitting missing cards', () => assert.throws(()=>generationInput({...options,owned_only:true}),/disable Owned/));
test('collection generation retains existing owned-only behaviour', () => {
  const plan=makeBinderPlan(generationInput({...options,binder_type:'collection',owned_only:true}),sets,candidates);
  assert.equal(plan.slot_count,1);assert.equal(plan.owned_slots,1);assert.equal(plan.options.color,'#998877');
});
test('Collector excludes prices, conditions and custom binder tools', () => {
  assert.ok(PLAN_FEATURES.collector.includes('tracking_binders'));
  for (const code of ['prices','condition','binders','collection']) assert.equal(PLAN_FEATURES.collector.includes(code),false);
});
test('Collector Plus includes every Collector capability and the detailed tools', () => {
  for (const code of [...PLAN_FEATURES.collector,'prices','condition','binders','collection']) assert.ok(PLAN_FEATURES.plus.includes(code));
  assert.deepEqual(planFeatures('invalid'),[]);assert.deepEqual(planFeatures('toString'),[]);
  assert.ok(planFeatures('plus').every(feature=>feature.label&&feature.code));
});
test('legacy, new and fallback testers retain both types and all current features without billing', () => {
  assert.equal(BILLING_ENABLED,false);assert.equal(ACCESS_ENFORCED,false);
  for (const grant of [{kind:'legacy_tester'},{kind:'beta_tester'},null]) {
    const access=testingAccess(grant);assert.equal(access.allowed,true);assert.equal(access.expires_at,null);assert.equal(access.payment_required,false);
    assert.deepEqual(access.features,CURRENT_FEATURES);assert.ok(access.features.some(f=>f.code==='tracking_binders'));assert.ok(access.features.some(f=>f.code==='prices'));
  }
});
test('schema defaults protect existing binders and mark state is stored separately from inventory', () => {
  const sql=readFileSync(new URL('../migrations/005_tracking_binders.sql',import.meta.url),'utf8');
  assert.match(sql,/DEFAULT 'collection'/);assert.match(sql,/is_collected boolean NOT NULL DEFAULT false/);
  assert.doesNotMatch(sql,/(?:UPDATE|DELETE FROM|ALTER TABLE)\s+(?:collection_entries|sessions|app_users|account_access_grants)\b/i);
});
