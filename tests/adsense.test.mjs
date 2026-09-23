import test from 'node:test';
import assert from 'node:assert/strict';
import { ADSENSE_DEFAULTS, adsenseInput, adsenseReady, adsenseCataloguePath, adsenseDeclaration, adsenseCsp, nonceScriptTags } from '../lib/adsense-logic.mjs';
import { sponsorEligible } from '../lib/free-settings-logic.mjs';
const publisher='ca-pub-1234567890123456',nonce='a'.repeat(32);
const valid={enabled:true,verification_enabled:true,publisher_id:publisher,slot_id:'1234567890',revision:0,password:' admin password ',reason:'Reviewed the AdSense configuration',confirm_approval:true,confirm_consent:true,confirm_auto_ads_off:true};
test('AdSense and inert site verification default off, independently of first-party sponsorship',()=>{
  assert.equal(ADSENSE_DEFAULTS.enabled,false);assert.equal(ADSENSE_DEFAULTS.verification_enabled,false);
  assert.equal(adsenseReady(ADSENSE_DEFAULTS),false);assert.equal(adsenseDeclaration(ADSENSE_DEFAULTS),'');
  const saved=adsenseInput(valid);assert.equal(saved.publisher_id,publisher);assert.equal(saved.password,valid.password);
  assert.equal('confirm_consent' in saved,false);assert.equal('ads_enabled' in saved,false);
});
for(const key of ['confirm_approval','confirm_consent','confirm_auto_ads_off'])for(const value of [undefined,false,1,'true'])test('AdSense activation needs true '+key+' '+String(value),()=>assert.throws(()=>adsenseInput({...valid,[key]:value}),e=>e.status===400));
for(const key of ['script','html','role','user_id','enabled_for_paid','ads_enabled','url','client_id'])test('AdSense rejects injected '+key,()=>assert.throws(()=>adsenseInput({...valid,[key]:'unsafe'})));
for(const changes of [{publisher_id:'pub-1234567890123456'},{publisher_id:'ca-pub-123'},{publisher_id:'ca-pub-1234567890123456\"'},{publisher_id:''},{slot_id:''},{slot_id:'1<script>'},{slot_id:'1234'},{slot_id:'12345x'},{revision:-1},{enabled:'true'}])test('invalid AdSense setting '+JSON.stringify(changes),()=>assert.throws(()=>adsenseInput({...valid,...changes})));
test('pausing does not need approval assertions and can retain verification',()=>{
  const out=adsenseInput({...valid,enabled:false,confirm_approval:false,confirm_consent:false,confirm_auto_ads_off:false});
  assert.equal(out.verification_enabled,true);assert.equal(out.enabled,false);
  assert.equal(adsenseDeclaration(out),'google.com, pub-1234567890123456, DIRECT, f08c47fec0942fa0\n');
});
test('verification can precede approval without a slot or an advertising script',()=>{
  const out=adsenseInput({...valid,enabled:false,slot_id:'',confirm_approval:false});assert.equal(adsenseReady(out),false);
  assert.ok(adsenseDeclaration(out).startsWith('google.com, pub-'));assert.throws(()=>adsenseInput({...out,publisher_id:''}));
});
for(const path of ['/explore','/explore/','/explore/en%3Ademo-1','/explore/mtg%3Aen%3Ademo'])test('eligible public catalogue path '+path,()=>assert.equal(adsenseCataloguePath(path),true));
for(const path of ['/', '/cards','/app','/login','/forgot-password','/reset-password','/admin/adsense','/membership','/account','/binders/abc','/marketplace/inbox','/print/abc','/exploreevil','/explore/../../account','//explore','/explore?x=1',undefined,{}])test('no Google advertising on '+String(path),()=>assert.equal(adsenseCataloguePath(path),false));
test('only explicit effective Free accounts are eligible, irrespective of plan marketing name',()=>{
  const free={user:{role:'user'},access:{tier:'free',reason:'free_account',allowed:true},enabled:true};assert.equal(sponsorEligible(free),true);
  for(const tier of ['collector','plus','complimentary','admin',null,undefined])assert.equal(sponsorEligible({...free,access:{...free.access,tier}}),false);
  for(const changes of [{user:null},{user:{role:'admin'}},{grant:{kind:'beta_tester'}},{pendingBilling:true},{enabled:false},{access:{tier:'free',reason:'testing_policy',allowed:true}}])assert.equal(sponsorEligible({...free,...changes}),false);
});
test('Google CSP uses a validated per-document nonce rather than broad host allowlisting on private pages',()=>{
  const csp=adsenseCsp(nonce);assert.ok(csp.includes("'nonce-"+nonce+"'"));assert.match(csp,/'strict-dynamic'/);assert.match(csp,/object-src 'none'/);assert.match(csp,/form-action 'self'/);assert.match(csp,/frame-ancestors 'none'/);
  for(const n of ['',null,'a'.repeat(31),'A'.repeat(32),'\" unsafe-inline'])assert.throws(()=>adsenseCsp(n));
});
test('server HTML nonce pass covers inline modules, external scripts and modulepreloads once',()=>{
  const html='<script src="/theme-init.js"></script><script type="module" nonce="old" src="/_nuxt/entry.js"></script><script type="application/json">{}</script><link rel="modulepreload" href="/x.js"><p>Card</p>';
  const out=nonceScriptTags(html,nonce);assert.equal((out.match(new RegExp('nonce="'+nonce+'"','g'))||[]).length,4);assert.ok(!out.includes('nonce="old"'));assert.ok(out.endsWith('<p>Card</p>'));
  assert.equal(nonceScriptTags(out,nonce),out);assert.throws(()=>nonceScriptTags(html,'bad'));
});

test('pending approval placeholders need no publisher, slots or approval confirmations',()=>{
  const out=adsenseInput({enabled:false,verification_enabled:false,placeholders_enabled:true,revision:0,password:'test',reason:'Pending site approval'});
  assert.equal(out.placeholders_enabled,true);assert.equal(adsenseReady(out),false);
  assert.throws(()=>adsenseInput({...out,placeholders_enabled:'true'}));
});
