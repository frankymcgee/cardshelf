import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { wishlistInput, wishlistChange } from '../lib/wishlist-logic.mjs';
import { printingWishlisted, wishlistRevisions, wishlistDraft } from '../shared/wishlist.mjs';
const p=randomUUID(), other=randomUUID();
const entry=(changes={})=>({printing_id:p,condition:'UNKNOWN',quantity:0,wishlist:false,notes:'',revision:1,...changes});
const input=(changes={})=>({printing_id:p,wishlist:true,revisions:[],...changes});
test('shortcut payload is explicit, revisioned and contains no inventory fields',()=>{
  assert.deepEqual(wishlistInput(input()),input());
  assert.deepEqual(wishlistInput(input({wishlist:false})),input({wishlist:false}));
});
for(const key of ['user_id','card_id','quantity','notes','condition','tier','force','role'])test('wishlist rejects injected '+key,()=>{
  assert.throws(()=>wishlistInput(input({[key]:'injected'})),e=>e.status===400);
});
for(const wishlist of [undefined,null,0,1,'true','false'])test('wishlist rejects non-boolean '+String(wishlist),()=>{
  assert.throws(()=>wishlistInput(input({wishlist})),e=>e.status===400);
});
for(const revisions of [undefined,null,{},'[]',Array(7).fill({condition:'NM',revision:1}),[{condition:'NM',revision:0}],
  [{condition:'NM',revision:'1'}],[{condition:'MINT',revision:1}],[{condition:'NM',revision:1,quantity:10}],
  [{condition:'NM',revision:1},{condition:'NM',revision:2}]])test('reject invalid condition revisions '+JSON.stringify(revisions),()=>{
  assert.throws(()=>wishlistInput(input({revisions})),e=>e.status===400);
});
test('wrong or missing printing identity is rejected',()=>{
  for(const printing_id of [null,undefined,'en:card','../fake'])assert.throws(()=>wishlistInput(input({printing_id})),e=>e.status===400);
});
test('aggregate wished state includes all conditions but only the selected printing',()=>{
  const rows=[entry({condition:'NM',wishlist:true}),entry({printing_id:other,wishlist:true})];
  assert.equal(printingWishlisted(rows,p),true);assert.equal(printingWishlisted(rows,'missing'),false);
  assert.equal(printingWishlisted(undefined,p),false);
});
test('revisions ignore ordering, never expose notes or quantities, and do not mutate input',()=>{
  const rows=[entry({condition:'UNKNOWN',notes:'private',quantity:2}),entry({condition:'NM',revision:3}),entry({printing_id:other})];
  const before=structuredClone(rows),versions=wishlistRevisions(rows,p);
  assert.deepEqual(versions,[{condition:'NM',revision:3},{condition:'UNKNOWN',revision:1}]);
  assert.deepEqual(rows,before);assert.equal(JSON.stringify(versions).includes('private'),false);
  assert.deepEqual(wishlistInput(input({revisions:[...versions].reverse()})).revisions,versions);
});
test('a missing printing wish is added without inferring a copy or a condition',()=>{
  assert.equal(wishlistChange([],wishlistInput(input())),'add');
});
test('a wish in any existing condition makes an add a no-op',()=>{
  const rows=[entry({condition:'LP',quantity:7,wishlist:true,notes:'keep'})];
  const data=wishlistInput(input({revisions:wishlistRevisions(rows,p)}));
  assert.equal(wishlistChange(rows,data),'none');
});
test('removing clears the printing wish irrespective of how many conditions are marked',()=>{
  const rows=[entry({wishlist:true}),entry({condition:'LP',wishlist:true}),entry({condition:'NM'})];
  assert.equal(wishlistChange(rows,wishlistInput(input({wishlist:false,revisions:wishlistRevisions(rows,p)}))),'remove');
});
test('removing an absent wish is a no-op',()=>assert.equal(wishlistChange([],wishlistInput(input({wishlist:false}))),'none'));
for(const changed of ['new condition','removed condition','ownership revision','wishlist revision'])test('stale '+changed+' fails before mutation',()=>{
  const before=[entry()],data=wishlistInput(input({revisions:wishlistRevisions(before,p)}));
  const after=changed==='new condition'?[...before,entry({condition:'LP'})]:changed==='removed condition'?[]:[entry({revision:2})];
  assert.throws(()=>wishlistChange(after,data),e=>e.status===409);
});
test('stale same-state requests do not silently accept a newer revision',()=>{
  const rows=[entry({revision:2,wishlist:true})];
  assert.throws(()=>wishlistChange(rows,wishlistInput(input({revisions:[{condition:'UNKNOWN',revision:1}]}))),e=>e.status===409);
});
test('draft rebasing changes only wishlist and revision, retaining unsaved inputs',()=>{
  const previous=[entry({quantity:2,notes:'saved'})],draft=entry({quantity:12,notes:'unsaved'}),before=structuredClone(draft);
  const next=wishlistDraft(draft,[entry({quantity:2,notes:'saved',revision:2,wishlist:true})],previous);
  assert.deepEqual(next,{...draft,wishlist:true,revision:2});assert.deepEqual(draft,before);
});
test('shortcut cannot bless an ownership form that was already stale before a retry',()=>{
  const draft=entry({quantity:6,notes:'old edit',revision:1});
  assert.deepEqual(wishlistDraft(draft,[entry({revision:3,wishlist:true})],[entry({revision:2,quantity:10})]),draft);
});
test('different-condition drafts are preserved; absence does not manufacture a row revision',()=>{
  const draft=entry({condition:'NM',revision:0,quantity:5,notes:'not saved'});
  assert.deepEqual(wishlistDraft(draft,[entry({wishlist:true})],[]),draft);
  assert.equal(wishlistDraft(undefined,[],[]),undefined);
});
test('server shortcut updates flags only, uses the shared lock and never deletes rows',async()=>{
  const source=await readFile(new URL('../lib/wishlist.mjs',import.meta.url),'utf8');
  assert.ok(source.indexOf('collectionLock(sql, userId)')<source.indexOf('requirePrintingGame(sql, userId'));
  assert.ok(source.includes('wishlistChange(current, data)'));
  assert.match(source,/ON CONFLICT\(user_id,printing_id,condition\) DO UPDATE SET wishlist=true,\s+revision=/);
  assert.doesNotMatch(source,/\bDELETE\s+FROM|SET\s+quantity=|SET\s+notes=|UPDATE\s+(?:binders|binder_slots|account_|stripe_)/i);
});
test('new route retains collection entitlement, authentication, rate limit and body bounds',async()=>{
  const middleware=await readFile(new URL('../server/middleware/subscription-access.ts',import.meta.url),'utf8');
  assert.match(middleware,/path === '\/api\/collection\/wishlist' && method === 'POST'\)\) needs\('collection'\)/);
  const route=await readFile(new URL('../server/api/collection/wishlist.post.ts',import.meta.url),'utf8');
  assert.match(route,/await platformUser\(event\)/);assert.match(route,/await platformBody\(event\)/);
  assert.match(route,/rateLimit\('wishlist:'/);assert.match(route,/private, no-store/);
});
