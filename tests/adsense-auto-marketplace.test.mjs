// Pure contracts and DOM test doubles. No Google requests or account settings.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { adsensePageKind, adsensePagePlan, marketplaceAdRows, marketplaceAdSize, freeMarketplaceReader,
  adFreePath, privateCardPath, enterPrivateCard } from '../shared/adsense-policy.mjs';
import { ADSENSE_DEFAULTS, adsenseInput, adsenseReady } from '../lib/adsense-logic.mjs';
import { startAdSense, adDocumentNeedsReload } from '../shared/adsense-browser.mjs';
const publisher='ca-pub-1234567890123456',slot='1234567890',nonce='e'.repeat(32);
const valid={enabled:true,verification_enabled:true,publisher_id:publisher,slot_id:'',auto_ads_enabled:true,
  marketplace_enabled:false,marketplace_slot_id:'',revision:0,password:' secret password ',reason:'Synthetic reviewed setup',
  confirm_approval:true,confirm_consent:true,confirm_auto_ads:true,confirm_scope:true};
const text=path=>readFile(new URL('../'+path,import.meta.url),'utf8');
for(const [path,kind] of [
  ['/','marketing'],['/features','marketing'],['/pricing/','marketing'],['/app','workspace'],['/cards?game=yugioh','workspace'],
  ['/cards?q=card%20name&ownership=wishlist&page=2','workspace'],['/explore?q=Magic%20card','catalogue'],
  ['/explore/en%3Ademo-1','catalogue'],['/explore/mtg%3Aen%3Ademo','catalogue'],['/explore/yugioh%3Aen%3Ademo','catalogue'],
  ['/marketplace','marketplace'],['/marketplace/?mine=false','marketplace'],['/marketplace?mine=0&order=price_low','marketplace']
])test('explicit ad-capable path: '+path,()=>assert.equal(adsensePageKind(path),kind));
for(const path of [undefined,null,{},'','https://evil.test','//evil.test','/\\evil.test','/explore/%2e%2e/account',
  '/explore/../account','/explore/%252e%252e/account','/explore/%2faccount','/explore/%','/explore/undefined','/explore//en:demo',
  '/app\n','/app#private','/admin/adsense','/admin/platform','/login','/register','/settings','/account','/membership','/pricing?stripe=returned',
  '/forgot-password','/reset-password','/reset-password?token=secret','/privacy','/early-access','/referrals','/battle','/battle/match/abc',
  '/binders','/binders/a','/print/a','/shared/a','/api/ads/adsense','/marketplace/new','/marketplace/inbox','/marketplace/moderation',
  '/marketplace/ab123','/marketplace?mine=true','/marketplace?mine=1','/marketplace?mine=yes','/marketplace?mine=',
  '/marketplace?mine=false&mine=true','/marketplace?%6dine=true','/cards?card=en:demo','/cards?ads=off','/explore?ads=off',
  '/app?next=evil','/features?q=private','/pricing?ref=private','/cards?q=a&q=b','/future-content-page', '/cards/'+'x'.repeat(4096)
])test('private or unrecognised path is ad-free: '+String(path).slice(0,100),()=>assert.equal(adsensePageKind(path),null));
test('all added placement modes start off without disabling legacy manual settings',()=>{
  assert.equal(ADSENSE_DEFAULTS.auto_ads_enabled,false);assert.equal(ADSENSE_DEFAULTS.marketplace_enabled,false);
  assert.equal(ADSENSE_DEFAULTS.marketplace_slot_id,'');assert.equal(adsensePagePlan(ADSENSE_DEFAULTS,'/'),null);
  const old={enabled:true,publisher_id:publisher,slot_id:slot};
  assert.deepEqual(adsensePagePlan(old,'/explore'),{auto_ads:false,slot_id:slot,page_kind:'catalogue'});
  for(const p of ['/','/app','/cards','/marketplace'])assert.equal(adsensePagePlan(old,p),null);
});
test('Auto-only uses the shared publisher loader without a made-up slot',()=>{
  const saved=adsenseInput(valid);assert.equal(adsenseReady(saved),true);assert.equal(saved.slot_id,'');assert.equal(saved.password,valid.password);
  for(const p of ['/','/features','/pricing','/app','/cards','/explore','/marketplace']){
    const plan=adsensePagePlan(saved,p);assert.equal(plan.auto_ads,true);assert.equal(plan.slot_id,'');
  }
});
test('a manual marketplace unit and catalogue unit are independent, with Auto optional',()=>{
  const saved=adsenseInput({...valid,auto_ads_enabled:false,confirm_auto_ads_off:true,marketplace_enabled:true,marketplace_slot_id:slot});
  assert.equal(adsenseReady(saved),true);assert.equal(adsensePagePlan(saved,'/explore'),null);
  assert.deepEqual(adsensePagePlan(saved,'/marketplace'),{auto_ads:false,slot_id:slot,page_kind:'marketplace'});
  assert.equal(adsensePagePlan({...saved,slot_id:'888888'},'/explore').slot_id,'888888');
  assert.equal(adsensePagePlan({...saved,slot_id:'888888'},'/marketplace').slot_id,slot);
});
for(const field of ['confirm_auto_ads','confirm_scope','confirm_approval','confirm_consent'])for(const value of [undefined,false,'true',1])
  test(`Auto activation rejects ${field}=${String(value)}`,()=>assert.throws(()=>adsenseInput({...valid,[field]:value}),e=>e.status===400));
for(const extra of [{auto_ads_enabled:'true'},{marketplace_enabled:1},{marketplace_enabled:true},{marketplace_slot_id:'x<script>'},
  {publisher_id:''},{publisher_id:'pub-1234567890123456'},{auto_ads_enabled:false},{url:'https://evil.test'},{script:'unsafe'},
  {enabled_for_paid:true},{free_only:false},{role:'admin'},{auto_ads_enabled:false,slot_id:slot,confirm_auto_ads_off:false}])
  test('invalid mode configuration rejected '+JSON.stringify(extra),()=>assert.throws(()=>adsenseInput({...valid,...extra}),e=>e.status===400));
test('pausing is possible without repeating activation consent; verification remains separate',()=>{
  const out=adsenseInput({...valid,enabled:false,confirm_auto_ads:false,confirm_scope:false,confirm_consent:false});
  assert.equal(out.enabled,false);assert.equal(out.verification_enabled,true);assert.equal(adsensePagePlan(out,'/'),null);
  for(const key of ['confirm_scope','confirm_auto_ads','confirm_consent'])assert.equal(key in out,false);
});
for(const length of [0,1,3,4,5,6,7,24])test('one stable tile never replaces listings: '+length,()=>{
  const list=Array.from({length},(_,i)=>({id:'item-'+i,name:'Card '+i})),rows=marketplaceAdRows(list);
  assert.equal(rows.filter(r=>r.kind==='ad').length,1);assert.equal(rows.findIndex(r=>r.kind==='ad'),Math.min(6,length));
  assert.deepEqual(rows.filter(r=>r.kind==='sale').map(r=>r.item),list);
  assert.equal(rows.find(r=>r.kind==='ad').key,'cardshelf-market-ad');assert.equal(list.length,length);
});
for(const [w,h,expected] of [[120,140,true],[119,150,false],[450,600,true],[451,600,false],[300,390,true],[300,1201,false],[NaN,300,false],[200,49,false],[200.9,280.8,true]])
  test(`card-sized ad request bounds ${w}x${h}`,()=>assert.equal(!!marketplaceAdSize(w,h),expected));
test('Free marketplace browsing never becomes a generic paid feature or protected-tier grant',()=>{
  const free={allowed:true,tier:'free',reason:'free_account'};assert.equal(freeMarketplaceReader(free),true);
  for(const value of [null,{}, {...free,allowed:false},{...free,tier:'plus'},{...free,tier:'collector'},{...free,reason:'testing_policy'},{...free,reason:'complimentary'}])assert.equal(freeMarketplaceReader(value),false);
});
function harness(){
  let allowed=true,failures=0;const scripts=[],attrs={},space={style:{}},unit={style:{},isConnected:true,
    getBoundingClientRect:()=>({width:260,height:336}),setAttribute:(k,v)=>{attrs[k]=v;},closest:()=>space};
  const win={location:{assign:path=>{win.destination=path;}}},doc={cookie:undefined,getElementById:id=>scripts.find(s=>s.id===id),
    createElement:tag=>({tagName:tag}),head:{appendChild:script=>scripts.push(script)}};
  const start=(value={},target=unit)=>startAdSense(win,doc,target,{eligible:true,publisher_id:publisher,auto_ads:true,slot_id:'',revision:1,...value},nonce,()=>allowed,()=>{failures++;});
  return{win,doc,unit,space,scripts,attrs,start,allow:value=>{allowed=value;},failures:()=>failures};
}
test('Auto needs no ins element and never enqueues a manual unit or forges consent',()=>{
  const h=harness();assert.equal(h.start({},null),true);h.scripts[0].onload();h.scripts[0].onload();
  assert.equal(h.win.adsbygoogle,undefined);assert.equal(h.doc.cookie,undefined);assert.equal(h.win.gtag,undefined);assert.equal(h.scripts.length,1);
});
test('manual marketplace size is inline, has no expanding format and requests only once',()=>{
  const h=harness();assert.equal(h.start({slot_id:slot,page_kind:'marketplace'}),true);
  assert.equal(h.unit.style.width,'100%');assert.equal(h.unit.style.height,'336px');assert.equal(h.space.style.minHeight,'364px');
  assert.equal(h.attrs['data-ad-format'],undefined);assert.equal(h.attrs['data-full-width-responsive'],undefined);
  assert.equal(h.attrs['data-ad-slot'],slot);h.scripts[0].onload();assert.deepEqual(h.win.adsbygoogle,[{}]);
  assert.equal(h.start({slot_id:slot,page_kind:'marketplace'}),false);assert.equal(h.scripts.length,1);
});
test('an undersized mobile slot stays unrequested without scaling the creative',()=>{
  const h=harness();h.unit.getBoundingClientRect=()=>({width:90,height:120});
  assert.equal(h.start({auto_ads:false,slot_id:slot,page_kind:'marketplace'}),false);assert.equal(h.scripts.length,0);
  assert.equal(h.start({slot_id:slot,page_kind:'marketplace'}),true);h.scripts[0].onload();assert.equal(h.win.adsbygoogle,undefined);
});
test('opening private details blocks a pending loader before any private API fetch',()=>{
  const h=harness();assert.equal(enterPrivateCard(h.win,'en:demo-1'),false);assert.equal(h.win.__cardshelfAdSenseBlocked,true);
  assert.equal(h.start(),false);assert.equal(h.scripts.length,0);
});
test('opening private details after Google loaded replaces the whole document',()=>{
  const h=harness();h.start({slot_id:slot});assert.equal(enterPrivateCard(h.win,'en:demo-1'),true);
  assert.equal(h.win.destination,'/cards?ads=off&card=en%3Ademo-1');h.scripts[0].onload();assert.equal(h.win.adsbygoogle,undefined);
});
test('stopped access and detached units cannot make a late display request',()=>{
  for(const stop of [h=>h.allow(false),h=>{h.unit.isConnected=false;},h=>{h.win.__cardshelfAdSenseBlocked=true;}]){
    const h=harness();h.start({slot_id:slot,page_kind:'marketplace'});stop(h);h.scripts[0].onload();assert.equal(h.win.adsbygoogle,undefined);
  }
});
test('a loader error is not retried or converted into an automatic ad refresh',()=>{
  const h=harness();h.start();h.scripts[0].onerror();assert.equal(h.failures(),1);assert.equal(h.start(),false);assert.equal(h.scripts.length,1);
});
for(const input of ['/app','/marketplace?q=dragon&page=2','/cards?ownership=owned#selected','//evil.test','https://evil.test','/\\evil.test'])
  test('security reload destination is ad-free: '+input,()=>{const next=adFreePath(input);assert.ok(next.startsWith('/'));assert.equal(adsensePageKind(next),null);assert.ok(next.includes('ads=off'));});
test('private card link cannot become an arbitrary redirect',()=>{assert.equal(privateCardPath('https://evil.test'),'/cards?ads=off');assert.equal(privateCardPath('mtg:en:test'),'/cards?ads=off&card=mtg%3Aen%3Atest');});
test('leaving any Google-loaded page destroys its document; anchors do not create impressions',()=>{
  for(const path of ['/account','/binders','/battle','/marketplace/inbox','/cards?ads=off','/pricing'])assert.equal(adDocumentNeedsReload(true,path,'/marketplace'),true);
  assert.equal(adDocumentNeedsReload(true,'/features#faq','/features#top'),false);assert.equal(adDocumentNeedsReload(true,'/app','/app'),false);
  assert.equal(adDocumentNeedsReload(false,'/app','/account'),true);assert.equal(adDocumentNeedsReload(false,'/cards?ads=off','/account'),false);
});
test('schema replaces only the old three-column slot check, with opt-in defaults',async()=>{
  const sql=await text('migrations/016_adsense_auto_marketplace.sql');
  assert.match(sql,/auto_ads_enabled boolean NOT NULL DEFAULT false/);assert.match(sql,/marketplace_enabled boolean NOT NULL DEFAULT false/);
  assert.match(sql,/ARRAY\['enabled','publisher_id','slot_id'\]/);assert.match(sql,/IF matches <> 1 THEN/);
  assert.match(sql,/adsense_enabled_modes/);assert.match(sql,/adsense_marketplace_slot/);
  assert.ok(!/DROP\s+TABLE|(?:UPDATE|DELETE\s+FROM|INSERT\s+INTO)\s+(?:app_users|account_\w+|stripe_\w+|collection_entries|binders)/i.test(sql));
});
test('page integration fences private card dialogs and preserves a single keyed ad over filtering',async()=>{
  const cards=await text('app/pages/cards.vue'),market=await text('app/pages/marketplace/index.vue'),component=await text('app/components/AdSenseSlot.vue');
  assert.match(cards,/enterPrivateCard\(window, id\)/);assert.ok(!cards.includes('@select="selected = $event"'));assert.match(cards,/!selected/);
  assert.match(market,/marketplaceAdRows\(data.value\?\.items\)/);assert.match(market,/:manual-allowed="data.items.length >= 4"/);
  assert.match(market,/<div v-if="data" class="market-grid"/);assert.match(market,/:key="row.key"/);
  assert.match(component,/Advertisements/);assert.match(component,/Advertising, not a card for sale/);assert.ok(!/<a\b|<NuxtLink\b|@click/.test(component));
  assert.match(component,/if \(!auth.state.value.loaded\) await auth.refresh\(\)/);
  assert.match(component,/window.location.replace\(adFreePath/);assert.match(component,/setInterval\(visibleCheck, 60000\)/);
});
test('Free view-only marketplace exception does not remove selling or enquiry checks',async()=>{
  const middleware=await text('server/middleware/subscription-access.ts');
  assert.match(middleware,/!freeMarketplaceReader\(access\)/);assert.match(middleware,/needs\('marketplace_sell'\)/);assert.match(middleware,/enquiries\$\/[\s\S]*needs\('marketplace_browse'\)/);
  const endpoint=await text('server/api/marketplace/access.get.ts');assert.match(endpoint,/can_enquire: result.can_browse/);
  const detail=await text('server/api/marketplace/listings/[id].get.ts');assert.match(detail,/listing.can_enquire && access.can_browse/);
});

test('ad-free navigation keeps client routing while eligible Free pages get a new document',async()=>{
  const {adDocumentNeedsReloadForUser:needs}=await import('../shared/adsense-browser.mjs');let calls=0;
  assert.equal(await needs(false,'/cards','/app',false,async()=>{calls++;return {eligible:false};}),false);assert.equal(calls,1);
  assert.equal(await needs(false,'/cards','/app',false,async()=>({eligible:true})),true);
  assert.equal(await needs(false,'/cards','/app',false,async()=>{throw Error('offline');}),false);
  assert.equal(await needs(true,'/account','/cards',false,async()=>{throw Error('Should not query');}),true);
  assert.equal(await needs(false,'/account','/cards',false,async()=>{throw Error('Should not query');}),false);
  assert.equal(await needs(true,'/cards','/cards',true,async()=>{throw Error('Should not query');}),false);
});

test('catalogue preview rows preserve all cards and stable order across result sizes',async()=>{
  const {catalogueAdRows}=await import('../shared/adsense-policy.mjs');
  for(const count of [0,1,6,8,30]){
    const items=Array.from({length:count},(_,i)=>({id:'card-'+i})),original=structuredClone(items),rows=catalogueAdRows(items);
    assert.deepEqual(rows.filter(r=>r.kind==='card').map(r=>r.item),items);
    assert.equal(rows.filter(r=>r.kind==='ad').length,1);assert.equal(rows[Math.min(6,count)].kind,'ad');
    assert.equal(new Set(rows.map(r=>r.key)).size,rows.length);assert.deepEqual(items,original);
  }
});
