// Execute the actual Vue component's setup script. Only its reactive/DOM/HTTP
// boundaries are substituted. This is not a full Nuxt or browser rendering test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { startAdSense } from '../shared/adsense-browser.mjs';
import { adFreePath, adsensePageKind, marketplaceAdSize } from '../shared/adsense-policy.mjs';
const source=(await readFile(new URL('../app/components/AdSenseSlot.vue',import.meta.url),'utf8')).match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1].replace(/^import .*$/mg,'');
const compiled=ts.transpileModule(source,{reportDiagnostics:true,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}});
assert.equal((compiled.diagnostics||[]).filter(d=>d.category===ts.DiagnosticCategory.Error).length,0);
const yes=(extra={})=>({eligible:true,publisher_id:'ca-pub-1234567890123456',slot_id:'1234567890',auto_ads:true,page_kind:'marketplace',revision:2,...extra});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function harness({response=yes(),initialLoaded=true,ready=true,autoOnly=false,manualAllowed=true}={}){
  let value=response,throws=false,state;
  const calls=[],scripts=[],redirects=[],listeners=new Map(),watches=[],mounted=[],unmounted=[],timers=[],resize=[],fill=[];
  const props={contentReady:ready,marketplace:true,manualAllowed,autoOnly,adFreeUrl:'/marketplace?q=dragon&page=2'},route={fullPath:'/marketplace',path:'/marketplace'};
  const target={isConnected:true,style:{},attributes:{},getBoundingClientRect:()=>({width:240,height:308}),setAttribute(k,v){this.attributes[k]=v;},getAttribute(k){return this.attributes[k];},closest:()=>({style:{}})};
  const register=(type,fn)=>listeners.set(type,fn),remove=type=>listeners.delete(type);
  const win={addEventListener:register,removeEventListener:remove,location:{replace:value=>redirects.push(value)}};
  const doc={visibilityState:'visible',addEventListener:register,removeEventListener:remove,
    querySelector:selector=>selector.startsWith('script')?{nonce:'a'.repeat(32)}:{content:'2'},
    getElementById:id=>scripts.find(s=>s.id===id),createElement:tag=>({tagName:tag}),head:{appendChild:s=>scripts.push(s)}};
  let refreshResolve;
  const auth={state:{value:{loaded:initialLoaded,user:initialLoaded?{id:'free-user'}:null}},refresh:async()=>{
    await new Promise(resolve=>{refreshResolve=resolve;});auth.state.value={loaded:true,user:{id:'free-user'}};
  }};
  const context={startAdSense,adFreePath,adsensePageKind,marketplaceAdSize,window:win,document:doc,
    defineProps:()=>props,useApi:()=>async(path,options)=>{calls.push({path,options});if(throws)throw Error('offline');return typeof value==='function'?value():value;},useRoute:()=>route,useAuth:()=>auth,
    ref:value=>({value}),computed:read=>({get value(){return read();}}),nextTick:async()=>{if(state.manual.value)state.unit.value=target;},
    watch:(read,callback)=>watches.push({read,callback,old:read()}),onMounted:fn=>mounted.push(fn),onBeforeUnmount:fn=>unmounted.push(fn),
    setInterval:fn=>{timers.push(fn);return 1;},clearInterval:()=>{timers.length=0;},
    ResizeObserver:class{constructor(fn){this.fn=fn;resize.push(this);}observe(){}disconnect(){this.disconnected=true;}},
    MutationObserver:class{constructor(fn){this.fn=fn;fill.push(this);}observe(){}disconnect(){this.disconnected=true;}}
  };
  state=vm.runInNewContext('(function(){'+compiled.outputText+';return {check,requestAd,placement,unit,manual,failed,unfilled,manualRetired,unsupported,flags:()=>({requested,reloading,alive,checking})};})()',context,{timeout:1000});
  const flush=()=>{for(const w of watches){const next=w.read();if(!Object.is(next,w.old)){const old=w.old;w.old=next;w.callback(next,old);}}};
  return{...state,props,route,auth,win,doc,target,calls,scripts,redirects,listeners,timers,resize,fill,flush,
    response:next=>{value=next;},offline:()=>{throws=true;},resolveIdentity:()=>refreshResolve?.(),
    mount:async()=>{mounted.forEach(f=>f());await tick();},unmount:()=>unmounted.forEach(f=>f())};
}
test('controller denial renders no placement and inserts no Google loader',async()=>{const h=harness({response:{eligible:false}});await h.mount();assert.equal(h.placement.value,null);assert.equal(h.scripts.length,0);});
test('Auto-only controller loads once with no manual request or empty tile',async()=>{
  const h=harness({autoOnly:true});await h.mount();assert.equal(h.scripts.length,1);assert.equal(h.manual.value,false);h.scripts[0].onload();assert.equal(h.win.adsbygoogle,undefined);
  await h.check();assert.equal(h.scripts.length,1);assert.equal(h.manualRetired.value,true);
});
test('manual controller uses the actual selected slot with no format expansion',async()=>{
  const h=harness();await h.mount();assert.equal(h.scripts.length,1);h.scripts[0].onload();assert.equal(h.win.adsbygoogle.length,1);
  assert.equal(h.target.attributes['data-ad-slot'],'1234567890');assert.equal(h.target.attributes['data-full-width-responsive'],undefined);
  assert.equal(h.target.style.width,'100%');assert.equal(h.target.style.height,'308px');
});
test('initial identity resolution completes before the ad eligibility request',async()=>{
  const h=harness({initialLoaded:false});await h.mount();assert.equal(h.calls.length,0);assert.equal(h.scripts.length,0);
  h.resolveIdentity();await tick();h.flush();assert.equal(h.calls.length,1);assert.equal(h.scripts.length,1);assert.equal(h.redirects.length,0);
});
test('empty content does not load Google; first available content can load once',async()=>{
  const h=harness({ready:false});await h.mount();assert.equal(h.scripts.length,0);h.props.contentReady=true;h.flush();await tick();assert.equal(h.scripts.length,1);
});
test('clearing loaded content goes to an ad-free document and preserves market filters',async()=>{
  const h=harness();await h.mount();h.props.contentReady=false;h.flush();assert.equal(h.redirects[0],'/marketplace?q=dragon&page=2&ads=off');
  h.props.contentReady=true;h.flush();await h.check();assert.equal(h.scripts.length,1);assert.equal(h.redirects.length,1);
});
for(const change of [{eligible:false},{revision:3},{page_kind:'workspace'}])test('lost or mismatched placement cannot continue loading '+JSON.stringify(change),async()=>{
  const h=harness();await h.mount();h.response(yes(change));await h.check();assert.equal(h.placement.value,null);assert.equal(h.redirects.length,1);assert.ok(h.redirects[0].includes('ads=off'));
});
test('failed eligibility refresh fails closed rather than generating a new ad impression',async()=>{const h=harness();await h.mount();h.offline();await h.check();assert.equal(h.scripts.length,1);assert.equal(h.redirects.length,1);assert.equal(h.win.__cardshelfAdSenseBlocked,true);});
test('wrong document nonce/revision cannot be upgraded in place from an API response',async()=>{
  const h=harness();h.doc.querySelector=()=>null;await h.mount();assert.equal(h.scripts.length,0);assert.equal(h.redirects.length,0);
});
test('pending HTTP completion after unmount cannot insert a loader',async()=>{
  let done;const h=harness({response:()=>new Promise(r=>{done=r;})});await h.mount();h.unmount();done(yes());await tick();assert.equal(h.scripts.length,0);assert.equal(h.placement.value,null);
});
test('filtering retires a manual unit instead of recreating an unrequested blank tile',async()=>{
  const h=harness();await h.mount();h.props.manualAllowed=false;h.flush();assert.equal(h.manualRetired.value,true);
  h.props.manualAllowed=true;h.flush();await h.check();assert.equal(h.manual.value,false);assert.equal(h.scripts.length,1);
});
test('initial low listing density can use Auto but cannot later add a phantom manual tile',async()=>{
  const h=harness({manualAllowed:false});await h.mount();assert.equal(h.scripts.length,1);assert.equal(h.manualRetired.value,true);
  h.props.manualAllowed=true;h.flush();assert.equal(h.manual.value,false);h.scripts[0].onload();assert.equal(h.win.adsbygoogle,undefined);
});
test('Google-reported unfilled units collapse without another push or replacement ad',async()=>{
  const h=harness();await h.mount();h.target.attributes['data-ad-status']='unfilled';h.fill[0].fn();assert.equal(h.unfilled.value,true);await h.check();assert.equal(h.scripts.length,1);
});
test('unsupported marketplace dimensions skip the manual unit, without scaling',async()=>{
  const h=harness();h.target.getBoundingClientRect=()=>({width:100,height:140});await h.mount();assert.equal(h.unsupported.value,true);assert.equal(h.manual.value,false);
  assert.equal(h.scripts.length,1);h.scripts[0].onload();assert.equal(h.win.adsbygoogle,undefined);
});
test('a hidden tab waits until visible before the first loader',async()=>{
  const h=harness();h.doc.visibilityState='hidden';await h.mount();assert.equal(h.scripts.length,0);h.doc.visibilityState='visible';h.listeners.get('visibilitychange')();await tick();assert.equal(h.scripts.length,1);
});
test('an initially zero-width unit can start once after layout provides real dimensions',async()=>{
  const h=harness();h.target.getBoundingClientRect=()=>({width:0,height:308});await h.mount();assert.equal(h.scripts.length,0);
  h.target.getBoundingClientRect=()=>({width:240,height:308});h.resize[0].fn();assert.equal(h.scripts.length,1);h.resize[0].fn();assert.equal(h.scripts.length,1);
});
test('focus and timer eligibility checks do not refresh Google ad units',async()=>{
  const h=harness();await h.mount();h.scripts[0].onload();for(let n=0;n<3;n++){h.timers[0]();await tick();}
  assert.equal(h.scripts.length,1);assert.equal(h.win.adsbygoogle.length,1);assert.equal(h.calls.length,4);
});
test('logout/account change and restored bfcache documents use an ad-free reset',async()=>{
  for(const trigger of [h=>{h.auth.state.value.user=null;h.flush();},h=>h.listeners.get('pageshow')({persisted:true})]){
    const h=harness();await h.mount();trigger(h);assert.equal(h.redirects.length,1);assert.equal(adsensePageKind(h.redirects[0]),null);
  }
});
test('component cleanup disconnects observers, timers and event listeners',async()=>{
  const h=harness();await h.mount();h.unmount();assert.equal(h.listeners.size,0);assert.equal(h.timers.length,0);
  assert.ok(h.resize.every(r=>r.disconnected));assert.ok(h.fill.every(r=>r.disconnected));await h.check();assert.equal(h.scripts.length,1);
});

test('placeholder works without a document nonce and never loads Google', async()=>{
  const h=harness({autoOnly:true,response:{eligible:false,placeholder:true,page_kind:'marketplace',revision:99}});
  h.doc.querySelector=()=>null;await h.mount();
  assert.equal(h.placement.value.placeholder,true);assert.equal(h.scripts.length,0);
  h.requestAd();assert.equal(h.scripts.length,0);
  h.route.fullPath='/account';h.flush();await tick();assert.equal(h.placement.value,null);
});
test('a loaded ad switches to an ad-free document when placeholders are enabled',async()=>{
  const h=harness();await h.mount();h.response({eligible:false,placeholder:true,page_kind:'marketplace'});await h.check();
  assert.equal(h.redirects.length,1);assert.equal(h.scripts.length,1);
});

test('authenticated administrator preview does not call ad eligibility even when blocked',async()=>{
  const h=harness();h.auth.state.value={loaded:true,user:{id:'admin',role:'admin'},admin_placement_view:'preview'};
  h.win.__cardshelfAdSenseBlocked=true;await h.mount();assert.equal(h.calls.length,0);assert.equal(h.scripts.length,0);
  h.auth.state.value={loaded:true,user:null,admin_placement_view:'hidden'};h.flush();await tick();assert.equal(h.placement.value,null);
});
