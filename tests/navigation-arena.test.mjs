import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PRIMARY_NAVIGATION,COLLECTION_LINKS,MORE_GROUPS,ADMIN_LINKS,ADMIN_ENTRY,ADMIN_GROUPS,activeNavigation,administrationLinks,navigationMatches} from '../shared/navigation.mjs';
import {retiredBattleRoute} from '../shared/legacy-battle.mjs';
import {arenaPaidTier} from '../shared/arena.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('five primary destinations replace eight tabs without removing existing tools',()=>{
 assert.deepEqual(PRIMARY_NAVIGATION.map(n=>n.id),['home','collection','market','arena','more']);
 const links=[...PRIMARY_NAVIGATION.filter(n=>n.to),...COLLECTION_LINKS,...MORE_GROUPS.flatMap(g=>g.links),...ADMIN_LINKS].map(n=>n.to);
 for(const path of ['/app','/cards','/binders','/marketplace','/games','/arena','/settings','/account','/membership','/referrals','/explore','/','/admin/platform','/admin/memberships','/admin/integrations/stripe','/admin/free-platform','/admin/game-catalogue','/admin/passwords','/admin/adsense','/admin/arena'])assert.ok(links.includes(path),path);
 assert.equal(links.some(path=>path==='/battle'||path==='/admin/battle'),false);
});
for(const [path,group] of [['/app','home'],['/app/','home'],['/cards?set=en:one','collection'],['/cards/one','collection'],['/binders/new','collection'],['/games','collection'],['/explore/en:one','collection'],['/marketplace/inbox','market'],['/arena/matches/a','arena'],['/arena/decks/new','arena'],['/admin/arena','more'],['/membership','more'],['/referrals','more'],['/cardshelf','more']])test('correct navigation group for '+path,()=>assert.equal(activeNavigation(path),group));
for(const role of [undefined,null,'user','collector','plus','complimentary','Admin',''])test('administration links hidden from role '+role,()=>assert.deepEqual(administrationLinks(role),[]));
test('administrator enters the grouped hub through one navigation card',()=>{assert.equal(administrationLinks('admin'),ADMIN_ENTRY);assert.equal(ADMIN_ENTRY.length,1);assert.equal(ADMIN_ENTRY[0].to,'/admin');assert.deepEqual(ADMIN_GROUPS.flatMap(g=>g.links).map(l=>l.to).sort(),ADMIN_LINKS.map(l=>l.to).sort());});
test('exact page matching does not activate root for every page',()=>{assert.equal(navigationMatches('/cards','/'),false);assert.equal(navigationMatches('/cards-other','/cards'),false);assert.equal(navigationMatches('/cards/123','/cards'),true);});
for(const path of ['/battle','/battle/','/battle/decks/new','/battle/matches/123?token=private','/%62attle//matches/123'])test('retired page redirects to arena without leaking prior match IDs: '+path,()=>assert.deepEqual(retiredBattleRoute(path),{kind:'page',admin:false,to:'/arena'}));
for(const path of ['/api/battle','/api/battle/cards','/api/battle/matches/123/actions','/api/%62attle/join'])test('retired API classification: '+path,()=>assert.deepEqual(retiredBattleRoute(path),{kind:'api',admin:false,to:'/arena'}));
for(const path of ['/arena','/api/arena/legacy/123','/battlefield','/admin/arena','/api/battlefield','/api/%2562attle','/api/battle%5cdecks'])test('not a retired route: '+path,()=>assert.equal(retiredBattleRoute(path),null));
test('old administrator route points only at new arena administration',()=>assert.deepEqual(retiredBattleRoute('/admin/battle?invite=x'),{kind:'page',admin:true,to:'/admin/arena'}));
test('retired middleware authenticates and rejects API operations without reading archived state',()=>{
 const s=read('server/middleware/zz-retired-battle.ts');assert.match(s,/platformUser\(event, route.admin\)/);assert.match(s,/statusCode: 410/);assert.match(s,/private, no-store/);assert.ok(!/UPDATE |DELETE |INSERT |SELECT |fetch\(/.test(s));
});
test('popup uses native modal semantics, scroll containment and role-filtered cards',()=>{
 const s=read('app/components/NavigationSheet.vue');for(const phrase of ['showModal()','@cancel.prevent','aria-labelledby','overscroll-behavior:contain','min-height:0','administrationLinks(props.role)','onBeforeUnmount','watch(() => route.fullPath'])assert.ok(s.includes(phrase),phrase);
});
test('sidebar and mobile nav share the same configuration and preserve ad boundaries',()=>{
 const s=read('app/layouts/default.vue');assert.equal((s.match(/v-for="item in PRIMARY_NAVIGATION"/g)||[]).length,2);assert.ok(!s.includes('/admin/battle'));assert.match(s,/SponsorSlot v-if="route.path === '\/app' \|\| route.path === '\/cards'"/);assert.ok(s.includes("auth.state.value.user?.role"));assert.ok(s.includes('repeat(5,minmax(0,1fr))'));
});
const now=Date.parse('2026-09-20T00:00:00Z');
test('explicit Complimentary gets the same Arena entitlement without a paid period',()=>assert.deepEqual(arenaPaidTier({override:{tier:'complimentary',expires_at:null}},now),{tier:'complimentary',reason:'complimentary'}));
for(const expires_at of ['2026-09-19T00:00:00Z','2026-09-20T00:00:00Z','bad-date'])test('expired/invalid Complimentary assignment fails closed: '+expires_at,()=>assert.equal(arenaPaidTier({override:{tier:'complimentary',expires_at}},now),null));
test('removing an assignment falls back to independently verified Live entitlement only',()=>{
 const subscriptions=[{environment:'production',paid_through:'2026-10-01T00:00:00Z',offer_snapshot:{plan_code:'plus'}}];
 assert.equal(arenaPaidTier({override:{tier:'inherit'},subscriptions},now).tier,'plus');assert.equal(arenaPaidTier({override:{tier:'inherit'}},now),null);
});
test('Complimentary assignment never changes shared billing or collection code',()=>{assert.ok(!read('shared/arena.mjs').includes('stripeRequest'));assert.ok(!read('lib/arena/access.mjs').includes('UPDATE account_tier_overrides'));});
