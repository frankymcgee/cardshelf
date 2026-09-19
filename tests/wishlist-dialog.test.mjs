// Execute the actual CardDialog script with injected API/composable state.
// Browser rendering is covered separately; no provider or database is contacted here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { printingWishlisted, wishlistRevisions, wishlistDraft } from '../shared/wishlist.mjs';
const text=await readFile(new URL('../app/components/CardDialog.vue',import.meta.url),'utf8');
const source=text.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1].replace(/^import .*$/mg,'');
const javascript=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const p='11111111-1111-4111-8111-111111111111',q='22222222-2222-4222-8222-222222222222';
const row=(extra={})=>({printing_id:p,condition:'UNKNOWN',quantity:0,wishlist:false,notes:'',revision:1,...extra});
const card=(extra={})=>({id:'en:demo-1',name:'Fixture',printings:[{id:p,label:'Normal'},{id:q,label:'Holo'}],entries:[],...extra});
const plain=value=>JSON.parse(JSON.stringify(value));
function harness(api){
  const props={cardId:'en:demo-1',printingId:p},events=[],notices=[],watches=[],unmount=[];
  const scope={printingWishlisted,wishlistRevisions,wishlistDraft,
    ref:value=>({value}),reactive:value=>value,computed:fn=>({get value(){return fn();}}),
    watch:(source,handler)=>watches.push({source,handler}),onBeforeUnmount:fn=>unmount.push(fn),
    defineProps:()=>props,defineEmits:()=>name=>events.push(name),useApi:()=>api,
    useAuth:()=>({state:{value:{user:{role:'admin'}}}}),useNotice:()=>({show:(...v)=>notices.push(v)}),
    errorMessage:e=>e.message||'Request failed'};
  const state=vm.runInNewContext('(function(){'+javascript+';return {card,drafts,visualPrintingId,visualWishlisted,busy,wishlistBusy,wishlistError,load,toggleWishlist,save,addManual};})()',scope);
  return {...state,props,events,notices,watches,unmount};
}
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
test('wishlist control is immediately below decorative preview and above card facts',()=>{
  assert.ok(text.indexOf('Decorative finish preview only.')<text.indexOf('class="preview-wishlist"'));
  assert.ok(text.indexOf('class="preview-wishlist"')<text.indexOf('class="detail-facts"'));
  assert.match(text,/:aria-pressed="visualWishlisted"/);assert.match(text,/@click="toggleWishlist"/);
  assert.match(text,/<button type="button" class="button secondary wishlist-toggle"/);
});
test('selected preview alone makes no wishlist write',async()=>{
  const calls=[],h=harness(async(...args)=>{calls.push(args);return card();});await h.load();h.visualPrintingId.value=q;
  assert.equal(calls.length,1);assert.equal(h.visualWishlisted.value,false);
});
test('shortcut sends selected printing and revisions only, never unsaved ownership',async()=>{
  const calls=[],existing=row({quantity:2,notes:'saved'});
  const h=harness(async(path,options)=>{calls.push({path,options});return options?{printing_id:p,wishlist:true,entries:[{...existing,wishlist:true,revision:2}]}:card({entries:[existing]});});
  await h.load();h.drafts[p].quantity=12;h.drafts[p].notes='unfinished edit';await h.toggleWishlist();
  assert.deepEqual(plain(calls[1]),{path:'/api/collection/wishlist',options:{method:'POST',body:{printing_id:p,wishlist:true,revisions:[{condition:'UNKNOWN',revision:1}]}}});
  assert.equal(h.card.value.entries[0].quantity,2);assert.equal(h.card.value.entries[0].notes,'saved');
  assert.equal(h.drafts[p].quantity,12);assert.equal(h.drafts[p].notes,'unfinished edit');assert.equal(h.drafts[p].revision,2);
  assert.equal(h.visualWishlisted.value,true);assert.deepEqual(h.events,['saved']);
});
test('wishlist state follows preview selection without affecting another printing',async()=>{
  const calls=[],h=harness(async(path,options)=>{calls.push({path,options});return options?{printing_id:q,wishlist:true,entries:[row({printing_id:q,wishlist:true})]}:card({entries:[row({wishlist:true})]});});
  await h.load();assert.equal(h.visualWishlisted.value,true);h.visualPrintingId.value=q;assert.equal(h.visualWishlisted.value,false);
  await h.toggleWishlist();assert.equal(calls[1].options.body.printing_id,q);assert.equal(h.card.value.entries.length,2);
});
test('remove action recognises wishes across conditions',async()=>{
  let body;const entries=[row({condition:'NM',wishlist:true}),row({condition:'LP',wishlist:true})];
  const h=harness(async(_,options)=>{if(!options)return card({entries});body=options.body;return {printing_id:p,wishlist:false,entries:entries.map(e=>({...e,wishlist:false,revision:2}))};});
  await h.load();await h.toggleWishlist();assert.equal(body.wishlist,false);assert.equal(body.revisions.length,2);assert.equal(h.visualWishlisted.value,false);
});
test('double click and ownership/manual writes are blocked during a wishlist request',async()=>{
  const pending=deferred(),calls=[],h=harness(async(path,options)=>{calls.push(path);return options?pending.promise:card();});
  await h.load();const first=h.toggleWishlist();assert.equal(h.busy.value,true);
  await h.toggleWishlist();await h.save({id:p});await h.addManual();assert.equal(calls.length,2);
  pending.resolve({printing_id:p,wishlist:true,entries:[row({wishlist:true})]});await first;assert.equal(h.busy.value,false);assert.equal(h.wishlistBusy.value,false);
});
test('failed write reports an error without a success state or event',async()=>{
  const h=harness(async(_,options)=>{if(options)throw new Error('Network unavailable');return card();});await h.load();await h.toggleWishlist();
  assert.equal(h.visualWishlisted.value,false);assert.equal(h.wishlistError.value,'Network unavailable');assert.deepEqual(h.events,[]);assert.equal(h.busy.value,false);
});
test('server denial is visible and does not locally change the wishlist',async()=>{
  const h=harness(async(_,options)=>{if(options)throw {statusCode:403,message:'Membership required'};return card();});await h.load();await h.toggleWishlist();
  assert.equal(h.wishlistError.value,'Membership required');assert.equal(h.card.value.entries.length,0);
});
test('conflict refresh preserves drafts and does not bless stale revisions on a later shortcut',async()=>{
  let gets=0,posts=0;
  const h=harness(async(_,options)=>{
    if(!options)return card({entries:[row({quantity:++gets===1?2:10,revision:gets})]});
    if(++posts===1)throw {statusCode:409,message:'Changed elsewhere'};
    return {printing_id:p,wishlist:true,entries:[row({quantity:10,revision:3,wishlist:true})]};
  });
  await h.load();h.drafts[p].quantity=8;h.drafts[p].notes='unsaved';await h.toggleWishlist();
  assert.equal(h.card.value.entries[0].quantity,10);assert.equal(h.drafts[p].quantity,8);assert.equal(h.drafts[p].revision,1);
  assert.match(h.wishlistError.value,/changed elsewhere/);await h.toggleWishlist();
  assert.equal(h.visualWishlisted.value,true);assert.equal(h.drafts[p].revision,1);assert.equal(h.drafts[p].quantity,8);
});
test('conflict refresh failure does not discard current state or pending notes',async()=>{
  let reads=0;const h=harness(async(_,options)=>{if(options)throw {status:409,message:'Changed elsewhere'};if(reads++)throw new Error('Offline');return card({entries:[row()]});});
  await h.load();h.drafts[p].notes='keep';await h.toggleWishlist();assert.equal(h.wishlistError.value,'Changed elsewhere');assert.equal(h.drafts[p].notes,'keep');
});
test('late response cannot overwrite a different open card',async()=>{
  const pending=deferred(),h=harness(async(_,options)=>options?pending.promise:card());await h.load();const save=h.toggleWishlist();
  h.props.cardId='en:other';h.card.value=card({id:'en:other',entries:[row({notes:'other'})]});
  pending.resolve({printing_id:p,wishlist:true,entries:[row({wishlist:true})]});await save;assert.equal(h.card.value.entries[0].notes,'other');
});
test('late response cannot overwrite the same card after closing and reopening',async()=>{
  const pending=deferred(),h=harness(async(_,options)=>options?pending.promise:card());await h.load();const save=h.toggleWishlist();
  h.props.cardId=null;h.watches[0].handler(null);h.props.cardId='en:demo-1';await h.load();
  pending.resolve({printing_id:p,wishlist:true,entries:[row({wishlist:true})]});await save;assert.equal(h.card.value.entries.length,0);
});
test('unmounted dialogs ignore late responses',async()=>{
  const pending=deferred(),h=harness(async(_,options)=>options?pending.promise:card());await h.load();const save=h.toggleWishlist();h.unmount.forEach(fn=>fn());
  pending.resolve({printing_id:p,wishlist:true,entries:[row({wishlist:true})]});await save;assert.equal(h.card.value.entries.length,0);
});
test('card reload retains chosen preview and loads an existing wish condition',async()=>{
  const h=harness(async()=>card({entries:[row({wishlist:true})]}));await h.load();assert.equal(h.drafts[p].condition,'UNKNOWN');
  h.visualPrintingId.value=q;await h.load();assert.equal(h.visualPrintingId.value,q);
});
test('no selected printing or an in-progress card load cannot submit a shortcut',async()=>{
  let calls=0;const h=harness(async()=>{calls++;return card({printings:[]});});await h.load();await h.toggleWishlist();assert.equal(calls,1);
});
