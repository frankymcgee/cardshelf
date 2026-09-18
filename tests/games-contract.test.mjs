import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {publicPage,safeReturnTo} from '../shared/platform.mjs';
const file=path=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('public lookup and registration do not make private collector routes public',()=>{
  for(const path of ['/explore','/register','/explore/en%3Abase1-4','/explore/mtg%3Aen%3Amtg-uuid','/explore/yugioh:en:ygo-123'])assert.equal(publicPage(path),true,path);
  for(const path of ['/games','/cards','/admin/free-platform','/explore/../admin','/explore/%252e%252e','/explore/mtg:ja:x','/explore/http://evil.test'])assert.equal(publicPage(path),false,path);
  assert.equal(safeReturnTo('/games'),'/games');assert.equal(safeReturnTo('/admin/free-platform'),'/admin/free-platform');assert.equal(safeReturnTo('//evil.test'),'/app');
});
test('ad rendering contains no executable creative or third-party advertising loader',async()=>{
  const source=await file('app/components/SponsorSlot.vue');
  assert.doesNotMatch(source,/v-html|innerHTML|createElement\(['"]script|<iframe|googlesyndication|doubleclick/i);
  assert.match(source,/response\.eligible === true/);assert.match(source,/creative\.value = null/);
  assert.match(source,/ADVERTISEMENT/);assert.match(source,/rel="sponsored noopener noreferrer"/);
});
test('ad metadata and image delivery are private and membership-checked on the server',async()=>{
  const placement=await file('server/api/ads/placement.get.ts'),image=await file('server/api/ads/image.get.ts'),service=await file('lib/free-accounts.mjs');
  assert.match(placement,/advertisement\(await sessionUser/);assert.match(placement,/private, no-store/);
  assert.match(image,/sponsorImage\(await platformUser/);assert.match(image,/private, no-store/);
  assert.match(service,/ensure\(\(await adState\(user\)\)\.eligible/);assert.match(service,/current OR paid_through>now\(\)/);
});
test('provider URLs and background imports do not load any paid API credentials',async()=>{
  for(const name of ['lib/game-provider.mjs','lib/game-provider-logic.mjs','lib/game-transport-logic.mjs']){
    const source=await file(name);assert.doesNotMatch(source,/process\.env\.[A-Z_]*(?:KEY|TOKEN)|Authorization:|api\.justtcg|pricecharting\.com/);
  }
  assert.match(await file('worker/index.mjs'),/job\.kind==='import-game-set'/);
  assert.match(await file('lib/price-worker.mjs'),/refreshGameCard\(card\)/);
});
test('new schema keeps game identities and Free defaults separate from historical access and charges',async()=>{
  const source=(await file('migrations/013_games_free_memberships_ads.sql')).replace(/--[^\n]*/g,'');
  assert.match(source,/DEFAULT 'pokemon'/);assert.match(source,/registration_enabled boolean NOT NULL DEFAULT false/);assert.match(source,/ads_enabled boolean NOT NULL DEFAULT false/);
  assert.match(source,/A binder can contain cards from only its own game/);assert.match(source,/Binder game is immutable/);
  assert.doesNotMatch(source,/(?:UPDATE|DELETE FROM|INSERT INTO|DROP TABLE|TRUNCATE)\s+(?:app_users|account_access_grants|collection_entries|stripe_subscriptions|stripe_connections)\b/i);
});
test('game and ownership edits share the per-user lock with game selection',async()=>{
  for(const name of ['lib/binders.mjs','lib/tracking-binders.mjs','lib/collection.mjs','lib/binder-generation.mjs','lib/binder-appearance.mjs','lib/collection-binders.mjs','lib/game-access.mjs']){
    const source=await file(name);assert.match(source,/collectionLock/,name);assert.match(source,/requireGame|requirePrintingGame/,name);
  }
});
test('cached source validation happens before new responses enter the database cache',async()=>{
  const source=await file('lib/game-provider.mjs');
  assert.ok(source.indexOf('validateProviderPayload(kind,value,data)')<source.indexOf('INSERT INTO game_provider_cache'));
  assert.match(source,/redirect:'error'/);assert.match(source,/maxOutputLength:MAX_JSON/);assert.match(source,/await sleep\(350\)/);
  assert.match(source,/catalogue_artwork/);assert.match(source,/\.webp\(/);assert.doesNotMatch(source,/\.withMetadata\(/);
});
test('Free account creation never treats all old accounts as Free',async()=>{
  const source=await file('lib/free-accounts.mjs');
  assert.match(source,/DELETE FROM account_access_grants WHERE user_id=\$\{user\.id\} AND kind='beta_tester'/);
  assert.ok(source.indexOf('INSERT INTO app_users(name,email,password_hash,role)')<source.indexOf('DELETE FROM account_access_grants'));
  assert.match(source,/INSERT INTO free_accounts\(user_id\) VALUES\(\$\{user\.id\}\)/);
});
