import test from 'node:test';
import assert from 'node:assert/strict';
import { PUBLIC_PAGES,publicPage,sharedPage,safeReturnTo,testingAccess,BILLING_ENABLED,ACCESS_ENFORCED,CURRENT_FEATURES } from '../shared/platform.mjs';
import { requestInput,planInput,requestStatusInput } from '../lib/platform-validation.mjs';
const request={name:'A tester',email:'tester@example.test',purpose:'early_access',message:'I collect sets.',consent:true};
for(const path of PUBLIC_PAGES) test('public marketing route: '+path,()=>assert.equal(publicPage(path),true));
for(const path of ['/app','/cards','/binders','/settings','/account','/admin/platform','/api/public/access-requests','/features-extra'])
 test('not a public UI route: '+path,()=>assert.equal(publicPage(path),false));
test('public routes tolerate a trailing slash only',()=>{assert.equal(publicPage('/features/'),true);assert.equal(publicPage('/features/private'),false)});
test('shared pages accept only the existing public share token shape',()=>{assert.ok(sharedPage('/shared/'+'a'.repeat(64)));assert.ok(!sharedPage('/shared/admin'));assert.ok(!sharedPage('/shared/'+'a'.repeat(64)+'/edit'))});
for(const path of ['/app','/cards?set=en%3Abase1','/binders/abc','/settings#catalogue','/account','/print/abc','/admin/platform'])
 test('login returns to an internal collector route: '+path,()=>assert.equal(safeReturnTo(path),path));
for(const path of ['https://evil.test','//evil.test','/\\evil.test','/login','/api/admin/users','/','/pricing','/app/../../login','/%2f%2fevil.test','/cards%0a','/app%252f..','javascript:alert(1)',null,['/cards']])
 test('unsafe/unwanted login return falls back: '+String(path),()=>assert.equal(safeReturnTo(path),'/app'));
test('legacy accounts keep all current capabilities with no automatic expiry',()=>{const r=testingAccess({kind:'legacy_tester'});assert.equal(r.allowed,true);assert.equal(r.reason,'legacy_tester');assert.equal(r.expires_at,null);assert.equal(r.payment_required,false);assert.equal(r.features.length,CURRENT_FEATURES.length)});
test('new tester and fallback access are also non-billable',()=>{assert.equal(testingAccess({kind:'beta_tester'}).allowed,true);assert.equal(testingAccess(null).payment_required,false)});
test('environment flags cannot accidentally turn on billing in this release',()=>{process.env.BILLING_ENABLED='true';assert.equal(BILLING_ENABLED,false);assert.equal(ACCESS_ENFORCED,false);assert.equal(testingAccess({subscription_status:'past_due'}).allowed,true);delete process.env.BILLING_ENABLED});
test('requests normalise email and discard privilege/payment fields',()=>assert.deepEqual(requestInput({...request,email:'TESTER@example.test',role:'admin',approved:true,plan:'plus'}),{name:request.name,email:request.email,purpose:request.purpose,message:request.message}));
test('request consent must be affirmative',()=>{assert.throws(()=>requestInput({...request,consent:false}));assert.throws(()=>requestInput({...request,consent:'true'}))});
test('request content and purposes are bounded',()=>{assert.throws(()=>requestInput({...request,message:'x'.repeat(1201)}));assert.throws(()=>requestInput({...request,purpose:'subscribe'}));assert.throws(()=>requestInput({...request,email:'a\r\nb@example.test'}))});
test('a request does not carry a password into the stored shape',()=>assert.equal('password' in requestInput({...request,password:'not-stored'}),false));
test('draft prices use integer cents and permit an undecided price',()=>{const p=planInput({name:'Future',monthly_price_minor:null,annual_price_minor:12900,revision:1});assert.equal(p.monthly_price_minor,null);assert.equal(p.annual_price_minor,12900)});
test('draft prices reject floats, strings, negatives, infinity and extreme values',()=>{for(const value of [1.5,'1200',-1,Infinity,10000001])assert.throws(()=>planInput({name:'Future',monthly_price_minor:value,revision:1}))});
test('draft edits require a revision and cannot include billing switches',()=>{assert.throws(()=>planInput({name:'Future'}));assert.equal('billing_enabled' in planInput({name:'Future',revision:1,billing_enabled:true}),false)});
test('request statuses never include automatic approval',()=>{assert.throws(()=>requestStatusInput({status:'approved',revision:1}));assert.deepEqual(requestStatusInput({status:'contacted',revision:2}),{status:'contacted',revision:2})});
