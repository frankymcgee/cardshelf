// Execute the actual SFC scripts. No Nuxt runtime, network, publisher cards or SQL is used.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';
import ts from 'typescript';
import * as contract from '../shared/arena.mjs';
const plain=v=>JSON.parse(JSON.stringify(v));
const source=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function harness(file,api,props={},path='/arena/matches/11111111-1111-4111-8111-111111111111') {
  const text=source(file),script=text.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1].replace(/^import .*$/mg,'');
  const ast=ts.createSourceFile(file,script,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS),names=[];
  function name(n){if(ts.isIdentifier(n))names.push(n.text);else if(ts.isObjectBindingPattern(n)||ts.isArrayBindingPattern(n))for(const e of n.elements)if(ts.isBindingElement(e))name(e.name);}
  for(const n of ast.statements){if(ts.isVariableStatement(n))for(const d of n.declarationList.declarations)name(d.name);if(ts.isFunctionDeclaration(n)&&n.name)names.push(n.name.text);}
  const js=ts.transpileModule(script,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
  const mounts=[],unmounts=[],watches=[],events=[],navigation=[],storage=new Map(),timeouts=[],intervals=[];
  const route={params:{id:path.split('/').at(-1)},query:{},path};
  const document={hidden:false,addEventListener(){},removeEventListener(){}};
  const auth={state:{value:{user:{id:'test-user',role:'user',name:'Collector'}}}};
  const scope={...contract,console,structuredClone,Date,Math,JSON,Number,String,Promise,URL,Blob,
    nextTick:fn=>fn(),ref:value=>({value}),reactive:value=>value,computed:fn=>({get value(){return fn();}}),watch:(a,b)=>watches.push({a,b}),
    onMounted:fn=>mounts.push(fn),onBeforeUnmount:fn=>unmounts.push(fn),defineProps:()=>props,defineEmits:()=>(...args)=>events.push(args),
    useApi:()=>api,useAuth:()=>auth,useRoute:()=>route,definePageMeta(){},onBeforeRouteLeave(){},onBeforeRouteUpdate(){},useSeoMeta(){},errorMessage:e=>e.message||'Request failed',
    navigateTo:async(to)=>{navigation.push(to)},crypto:{randomUUID},document,
    window:{confirm:()=>true,addEventListener(){},removeEventListener(){}},
    sessionStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
    setTimeout:fn=>{timeouts.push(fn);return timeouts.length},clearTimeout(){},setInterval:fn=>{intervals.push(fn);return intervals.length},clearInterval(){}};
  const state=vm.runInNewContext('(function(){'+js+';return {'+names.join(',')+'};})()',scope);
  return {...state,scope,props,route,auth,storage,mounts,unmounts,watches,events,navigation,text};
}
const matchId='11111111-1111-4111-8111-111111111111';
function frame(revision=1,extra={}){return {id:matchId,revision,status:'active',seat:0,mode:'pvp',host_alias:'You',guest_alias:'Them',table:{phase:'playing',turn:0,players:[{hand:[],active:null,bench:[],discard:[],resolving:[]},{hand:[],active:null,bench:[],discard:[],resolving:[]}],events:[],legal:[],prompt:null,waiting_for:null},...extra};}
const page='app/pages/arena/matches/[id].vue';
test('arena client ignores stale or wrong-match views',()=>{const h=harness(page,async()=>{});h.accept(frame(5));h.accept(frame(2));h.accept(frame(9,{id:'other'}));assert.equal(h.data.value.revision,5);});
test('one user action is submitted with an idempotency key and current revision',async()=>{const calls=[],h=harness(page,async(p,o)=>{calls.push({p,o});return frame(2)});h.accept(frame());await h.act({type:'end_turn'});assert.equal(calls.length,1);assert.equal(calls[0].o.body.revision,1);assert.match(calls[0].o.body.request_id,/^[a-f0-9-]{36}$/);assert.equal(h.data.value.revision,2);assert.equal(h.storage.size,0);});
test('lost response keeps the identical action and request ID for a retry',async()=>{const calls=[],h=harness(page,async(p,o)=>{calls.push(plain(o));if(calls.length===1)throw new Error('lost response');return frame(2)});h.accept(frame());await h.act({type:'end_turn'});assert.equal(h.lostReply.value,true);const saved=[...h.storage.values()][0];assert.match(saved,/end_turn/);assert.ok(!saved.includes('players'));await h.act({type:'concede'});assert.equal(calls.length,1);await h.send();assert.deepEqual(calls[1],calls[0]);assert.equal(h.pending.value,null);assert.equal(h.storage.size,0);});
test('double click is suppressed while the first action is pending',async()=>{const d=deferred(),calls=[],h=harness(page,async(...a)=>{calls.push(a);return d.promise});h.accept(frame());const task=h.act({type:'end_turn'});await h.act({type:'end_turn'});await h.send();assert.equal(calls.length,1);d.resolve(frame(2));await task;});
test('a stale read started before a write cannot replace the acknowledged write',async()=>{const d=deferred(),h=harness(page,async(p,o)=>o?frame(3):d.promise);h.accept(frame());const read=h.load();await h.act({type:'end_turn'});d.resolve(frame(2));await read;assert.equal(h.data.value.revision,3);});
test('a revision conflict clears only pending retry metadata and pauses actions',async()=>{const h=harness(page,async()=>{throw {statusCode:409,message:'Changed'}});h.accept(frame());await h.act({type:'end_turn'});assert.equal(h.pending.value,null);assert.equal(h.connected.value,false);assert.equal(h.storage.size,0);assert.equal(h.data.value.revision,1);});
for(const status of [401,403,404])test('authorization loss '+status+' clears private match state',async()=>{const h=harness(page,async()=>{throw {statusCode:status,message:'Unavailable'}});h.accept(frame());h.pending.value={id:matchId,body:{request_id:randomUUID(),revision:1,action:{type:'end_turn'}}};h.store();await h.load();assert.equal(h.data.value,null);assert.equal(h.pending.value,null);assert.equal(h.storage.size,0);assert.equal(h.autoplay.value,false);});
test('unmounted page does not accept a late private response',async()=>{const d=deferred(),h=harness(page,async()=>d.promise);const read=h.load();h.unmounts.forEach(fn=>fn());d.resolve(frame());await read;assert.equal(h.data.value,null);});
test('hidden tab does not poll or auto-play',async()=>{let calls=0;const h=harness(page,async()=>{calls++;return frame()});h.scope.document.hidden=true;h.autoplay.value=true;h.accept(frame(1,{mode:'practice'}));await h.tick();await h.load();assert.equal(calls,0);});
test('PvP never sends autoplay even when the local toggle is forced true',async()=>{const calls=[],h=harness(page,async(p,o)=>{calls.push(o);return frame()});h.accept(frame());h.autoplay.value=true;await h.tick();assert.equal(calls.length,1);assert.equal(calls[0],undefined);});
test('solo autoplay uses server action and never sends locally computed damage',async()=>{const calls=[],h=harness(page,async(p,o)=>{calls.push(o);return frame(2,{mode:'practice'})});const f=frame(1,{mode:'practice'});f.table.legal=[{action:{type:'end_turn'}}];h.accept(f);h.autoplay.value=true;await h.tick();assert.deepEqual(plain(calls[0].body.action),{type:'autoplay'});});
test('pending decision values are the sole choice payload',()=>{const t=source(page);assert.match(t,/@choose="act\(\{ type: 'choose', choices: \$event \}\)"/);assert.ok(!t.includes("type: 'counters'"));assert.match(t,/data\.mode !== 'pvp'/);});
test('match completion stops local autoplay and blocks further actions',async()=>{let calls=0;const h=harness(page,async()=>{calls++});h.autoplay.value=true;h.accept(frame(9,{status:'finished'}));await h.act({type:'end_turn'});assert.equal(calls,0);assert.equal(h.autoplay.value,false);});
test('reopening a tab restores the original pending action without executing it automatically',async()=>{let calls=0;const h=harness(page,async()=>{calls++;return frame(2)});const body={revision:1,request_id:randomUUID(),action:{type:'end_turn'}};h.storage.set(h.key(),JSON.stringify({id:matchId,body}));await h.mounts[0]();assert.deepEqual(plain(h.pending.value.body),body);assert.equal(calls,1);});
test('view only offers actions associated with the selected public/own card',()=>{const h=harness(page,async()=>{}),f=frame();f.table.legal=[{card:'a',action:{type:'attack'}},{card:'b',action:{type:'energy'}},{card:null,action:{type:'end_turn'}}];h.accept(f);h.selected.value='a';assert.equal(h.moves.value.length,1);assert.equal(h.globalMoves.value.length,1);assert.equal(h.moves.value[0].card,'a');});
test('private lobby invite disappears after another player joins',()=>{const h=harness(page,async()=>{});h.accept(frame(1,{status:'waiting',invite_code:'a'.repeat(48)}));assert.equal(h.invitation.value.length,48);h.accept(frame(2,{status:'approval'}));assert.equal(h.invitation.value,'');});
test('decision selector bounds, replacement and lock are enforced in the component',()=>{const props={prompt:{kind:'prize',options:[{id:'0'},{id:'1'}],min:1,max:1},locked:false};const h=harness('app/components/arena/ArenaDecision.vue',async()=>{},props);assert.equal(h.valid.value,false);h.toggle('0');h.toggle('1');assert.deepEqual(plain(h.selected.value),['1']);props.locked=true;h.toggle('1');assert.equal(h.valid.value,true);});
test('private search supports a deliberate zero-card selection',()=>{const h=harness('app/components/arena/ArenaDecision.vue',async()=>{},{prompt:{kind:'search',options:[],min:0,max:0}});assert.equal(h.valid.value,true);});
test('Free status prevents private deck and match requests on arena home',async()=>{const calls=[],h=harness('app/pages/arena/index.vue',async p=>{calls.push(p);return {allowed:false,message:'Paid only'}});await h.load();assert.deepEqual(calls,['/api/arena/status']);assert.equal(h.decks.value.length,0);assert.equal(h.matches.value.length,0);});
test('PvP home rejects a missing saved deck before making any request',async()=>{let calls=0;const h=harness('app/pages/arena/index.vue',async()=>{calls++});await h.start('pvp');assert.equal(calls,0);assert.match(h.error.value,/saved 60-card deck/);});
test('tutorial creation explicitly selects original training cards, not an existing deck',async()=>{let body;const h=harness('app/pages/arena/index.vue',async(p,o)=>{body=o.body;return {id:matchId}});h.alias.value='Player';h.decks.value=[{id:'saved',revision:1}];h.deck.value='saved';await h.start('tutorial');assert.equal(body.training,true);assert.ok(!Object.hasOwn(body,'deck_id'));assert.equal(h.navigation[0],'/arena/matches/'+matchId);});
test('private match home retains failed creation until same-request retry',async()=>{const calls=[],h=harness('app/pages/arena/index.vue',async(p,o)=>{calls.push(plain(o));if(calls.length===1)throw new Error('Network');return {id:matchId}});h.alias.value='Player';await h.start('practice');await h.start('tutorial');assert.equal(calls.length,1);await h.submit();assert.deepEqual(calls[1],calls[0]);});
test('deck workshop sends identifiers and quantities, not client effect definitions',async()=>{let body;const h=harness('app/pages/arena/decks/[id].vue',async(p,o)=>{body=o.body;return {id:'saved',title:'Deck',cards:[],revision:1,validation:{playable:false,errors:[]}}},{},'/arena/decks/new');h.ready.value=true;h.title.value='Deck';h.rows.value=[{card:{id:'en:demo',program:{cheat:true}},quantity:3}];await h.save();assert.deepEqual(plain(body.cards),[{card_id:'en:demo',quantity:3}]);});
test('deck workshop caps the total and keeps physical collection unchanged',()=>{const h=harness('app/pages/arena/decks/[id].vue',async()=>{throw Error('unexpected')},{},'/arena/decks/new');h.ready.value=true;h.rows.value=[{card:{id:'en:one',kind:'energy'},quantity:60}];h.amount({id:'en:two'},1);assert.equal(h.total.value,60);h.amount({id:'en:one'},-1);assert.equal(h.total.value,59);});
test('an older catalogue search cannot replace a later workshop result',async()=>{const a=deferred(),b=deferred();let n=0;const h=harness('app/pages/arena/decks/[id].vue',async()=>++n===1?a.promise:b.promise,{},'/arena/decks/new');const first=h.search(),second=h.search();b.resolve({items:[{card:{name:'Latest'}}]});await second;a.resolve({items:[]});await first;assert.equal(h.catalogue.value.items[0].card.name,'Latest');});
test('card component does not expose a face for hidden cards and reports HP as remaining health',()=>{const props={unit:{hidden:true}},h=harness('app/components/arena/ArenaCard.vue',async()=>{},props);assert.equal(h.hidden.value,true);assert.equal(h.name.value,'Face-down card');props.unit={id:'a',card:{name:'Demo',hp:100},damage:30};assert.equal(h.hp.value,70);assert.equal(h.name.value,'Demo, 70 of 100 HP');});
test('all arena pages declare noindex and tabletop routes avoid third-party ad components',()=>{for(const p of ['app/pages/arena/index.vue','app/pages/arena/decks/[id].vue',page]){const s=source(p);assert.match(s,/noindex, nofollow/);assert.ok(!/AdSense|SponsorSlot|googlesyndication/.test(s));}});

test('workshop sends catalogue filters to the server rather than filtering the page',async()=>{
 let sent;const h=harness('app/pages/arena/decks/[id].vue',async(p,o)=>{sent=o.query;return {items:[],has_more:false}},{},'/arena/decks/new');
 h.supportedOnly.value=true;h.kind.value='pokemon';h.energyType.value='Fire';h.set.value='en:demo';h.stage.value='Basic';h.owned.value=true;await h.search();
 assert.deepEqual(plain(sent),{q:'',page:1,owned:'1',supported:'1',kind:'pokemon',type:'Fire',set:'en:demo',stage:'Basic'});
});
test('uncertain new-deck saves retain a frozen request and block edits until retry',async()=>{
 const calls=[];const h=harness('app/pages/arena/decks/[id].vue',async(p,o)=>{calls.push(plain(o.body));if(calls.length===1)throw Error('Lost reply');return {id:'saved',title:'Draft',revision:1,cards:[],validation:{playable:false,errors:[]}}},{},'/arena/decks/new');
 h.ready.value=true;h.title.value='Draft';h.rows.value=[{card:{id:'en:demo-1'},quantity:2}];await h.save();assert.equal(h.locked.value,true);
 h.amount({id:'en:demo-1'},1);assert.equal(h.total.value,2);h.title.value='Forced local edit';await h.save();assert.deepEqual(calls[1],calls[0]);assert.equal(h.pendingSave.value,null);
});
test('explicit save rejection retains editable draft rather than indefinite retry',async()=>{
 const h=harness('app/pages/arena/decks/[id].vue',async()=>{throw {statusCode:422,message:'Unavailable card'}},{},'/arena/decks/new');h.ready.value=true;h.title.value='Draft';h.rows.value=[{card:{id:'en:demo-1'},quantity:2}];await h.save();assert.equal(h.pendingSave.value,null);assert.equal(h.locked.value,false);assert.equal(h.total.value,2);
});
test('duplicate opens a separate unsaved draft with revision zero and no mutation',async()=>{
 const calls=[],h=harness('app/pages/arena/decks/[id].vue',async(p,o)=>{calls.push({p,o});if(p.endsWith('/status'))return {allowed:true};if(p==='/api/arena/decks/source')return {title:'Original',revision:7,cards:[{card:{id:'en:demo-1'},quantity:4}],validation:{playable:false}};if(p.endsWith('/decks'))return {legacy:[]};return {sets:[],types:[],items:[],has_more:false}},{},'/arena/decks/new');
 h.route.query.copy='source';await h.mounts[0]();assert.equal(h.title.value,'Original (copy)');assert.equal(h.revision.value,0);assert.equal(h.dirty.value,true);assert.ok(calls.every(c=>!c.o?.method));
});
test('draft import preserves an existing deck title and never writes automatically',()=>{
 const h=harness('app/pages/arena/decks/[id].vue',async()=>{throw Error('unexpected write')},{},'/arena/decks/123');h.ready.value=true;h.title.value='Keep my name';h.applyImport({complete:true,title:'Imported name',cards:[{card:{id:'en:demo-1'},quantity:2}],validation:{playable:false}});assert.equal(h.title.value,'Keep my name');assert.equal(h.total.value,2);assert.equal(h.dirty.value,true);
});
