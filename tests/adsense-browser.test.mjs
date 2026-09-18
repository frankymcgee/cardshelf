// Isolated DOM/controller tests. No Google service or browser network is used.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startAdSense, adDocumentNeedsReload } from '../shared/adsense-browser.mjs';
const placement={eligible:true,publisher_id:'ca-pub-1234567890123456',slot_id:'1234567890',revision:1}, nonce='f'.repeat(32);
function harness(){
  const scripts=[],attrs={},win={};let allowed=true,failures=0,width=700;
  const doc={getElementById:id=>scripts.find(s=>s.id===id),createElement:tag=>({tagName:tag}),head:{appendChild:s=>scripts.push(s)}};
  const unit={isConnected:true,getBoundingClientRect:()=>({width}),setAttribute:(k,v)=>{attrs[k]=v;}};
  return {win,doc,unit,scripts,attrs,allow:v=>{allowed=v;},width:v=>{width=v;},failures:()=>failures,
    start:(p=placement,n=nonce)=>startAdSense(win,doc,unit,p,n,()=>allowed,()=>{failures++;})};
}
test('module import and a denied placement make no script, cookies or ad requests',()=>{
  const h=harness();assert.deepEqual(h.win,{});assert.equal(h.start({eligible:false}),false);assert.equal(h.scripts.length,0);
});
for(const input of [null,{}, {...placement,eligible:false},{...placement,publisher_id:'<script>'},{...placement,slot_id:'arbitrary'}])test('browser refuses unvalidated placement '+JSON.stringify(input),()=>{const h=harness();assert.equal(h.start(input),false);assert.equal(h.scripts.length,0);});
for(const n of ['',undefined,'z'.repeat(32),'x\"'])test('browser requires the current document nonce '+JSON.stringify(n),()=>{const h=harness();assert.equal(startAdSense(h.win,h.doc,h.unit,placement,n,()=>true,()=>{}),false);assert.equal(h.scripts.length,0);});
test('zero-width or disconnected unit makes no request',()=>{
  const h=harness();h.width(0);assert.equal(h.start(),false);h.width(700);h.unit.isConnected=false;assert.equal(h.start(),false);assert.equal(h.scripts.length,0);
});
test('permission is checked before inserting Google code',()=>{const h=harness();h.allow(false);assert.equal(h.start(),false);assert.equal(h.scripts.length,0);});
test('one responsive display unit and one nonced official loader per document',()=>{
  const h=harness();assert.equal(h.start(),true);assert.equal(h.scripts.length,1);
  const script=h.scripts[0];assert.equal(script.nonce,nonce);assert.equal(script.async,true);assert.equal(script.crossOrigin,'anonymous');
  assert.equal(script.src,'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client='+placement.publisher_id);
  assert.equal(h.attrs['data-ad-slot'],placement.slot_id);assert.equal(h.attrs['data-full-width-responsive'],'true');assert.equal(h.win.adsbygoogle,undefined);
  script.onload();assert.deepEqual(h.win.adsbygoogle,[{}]);assert.equal(h.start(),false);assert.equal(h.scripts.length,1);
});
test('late script load cannot request an ad after entitlement loss or component removal',()=>{
  for(const remove of [false,true]){const h=harness();h.start();if(remove)h.unit.isConnected=false;else h.allow(false);h.scripts[0].onload();assert.equal(h.win.adsbygoogle,undefined);}
});
test('a blocked loader fails silently without repeated script injection or a timed ad refresh',()=>{const h=harness();h.start();h.scripts[0].onerror();assert.equal(h.failures(),1);assert.equal(h.start(),false);assert.equal(h.scripts.length,1);});
test('ad queue exception invokes failure instead of breaking catalogue navigation',()=>{const h=harness();h.win.adsbygoogle={push(){throw Error('blocked');}};h.start();h.scripts[0].onload();assert.equal(h.failures(),1);});
test('consent is not forged and no personalised/non-personalised override is supplied',()=>{const h=harness();h.start();h.scripts[0].onload();assert.deepEqual(h.win.adsbygoogle,[{}]);assert.equal(h.doc.cookie,undefined);assert.equal(h.win.gtag,undefined);});
for(const to of ['/account','/membership','/login','/reset-password#token=secret','/binders/abc','/admin/passwords','/marketplace/inbox','/explore/en%3Ax'])test('loaded Google document is destroyed before navigating to '+to,()=>assert.equal(adDocumentNeedsReload(true,to,'/explore'),true));
test('entry from the app gets a server-selected document even without a previous ad',()=>{
  assert.equal(adDocumentNeedsReload(false,'/explore','/app'),true);assert.equal(adDocumentNeedsReload(false,'/explore/en%3Ademo','/account'),true);
  assert.equal(adDocumentNeedsReload(false,'/account','/app'),false);assert.equal(adDocumentNeedsReload(true,'/explore','/explore'),false);
  assert.equal(adDocumentNeedsReload(true,'/explore','/',true),false);
});

test('duplicate load events cannot enqueue a second display request',()=>{const h=harness();h.start();h.scripts[0].onload();h.scripts[0].onload();assert.deepEqual(h.win.adsbygoogle,[{}]);});
