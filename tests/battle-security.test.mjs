import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { publicPage } from '../shared/platform.mjs';
import { adsenseCataloguePath } from '../lib/adsense-logic.mjs';
const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');
test('battle and deck screens are private routes, not public lookup or ad placements',()=>{
  for(const p of ['/battle','/battle/decks/new','/battle/matches/abc','/admin/battle']){assert.equal(publicPage(p),false);assert.equal(adsenseCataloguePath(p),false);}
});
test('battle migration adds isolated tables without rewriting ownership, passwords, tiers or subscriptions',async()=>{
  const s=await read('migrations/015_battle_beta.sql');assert.ok(!/^\s*(?:ALTER|DROP|TRUNCATE|DELETE\s+FROM|UPDATE|INSERT\s+INTO)\s/im.test(s.replace(/--[^\n]*/g,'')));assert.match(s,/enabled boolean NOT NULL DEFAULT false/);assert.match(s,/UNIQUE \(user_id,request_id\)/);
});
test('battle API checks real sessions and disables shared response caches',async()=>{
  for(const file of ['server/api/battle/index.get.ts','server/api/battle/[...action].ts','server/api/admin/battle/index.get.ts','server/api/admin/battle/settings.post.ts']){const s=await read(file);assert.match(s,/platformUser\(event/);assert.match(s,/private, no-store/);}
});
test('battle access is explicit, not purchased or inferred from a testing membership',async()=>{
  const s=await read('lib/battle/access.mjs');assert.match(s,/battle_access/);assert.match(s,/verifyPassword/);assert.match(s,/pg_advisory_xact_lock_shared/);assert.ok(!/account_access_grants|plan_code|STRIPE|stripeRequest/.test(s));
});
test('live game persistence stores authoritative state under a row lock and checks exact revisions before mutations',async()=>{
  const s=await read('lib/battle/matches.mjs');assert.match(s,/FOR UPDATE/);assert.match(s,/row\.revision===o\.revision/);assert.match(s,/request_hash===requestHash/);assert.match(s,/battleView\(row.state,seat\)/);assert.match(s,/row.host_id===userId\|\|row.guest_id===userId/);
});
test('battle modules contain no external provider requests, financial calls or inventory writes',async()=>{
  const files=['lib/battle/access.mjs','lib/battle/decks.mjs','lib/battle/matches.mjs','lib/battle/engine.mjs','lib/battle/adapters/pokemon-table.mjs'];
  for(const file of files){const s=await read(file);assert.ok(!/\bfetch\s*\(|stripeRequest|squareRequest/.test(s));assert.ok(!/\b(?:UPDATE|INSERT INTO|DELETE FROM)\s+(?:collection_entries|binders|account_memberships|stripe_subscriptions)\b/i.test(s));}
});
test('playmat receives no deck snapshots, raw state or invite hash through its participant projection',async()=>{
  const s=await read('lib/battle/matches.mjs'),part=s.slice(s.indexOf('function project'),s.indexOf('async function limitMatches'));assert.ok(!part.includes('...row'));assert.ok(!part.includes('invite_hash'));assert.ok(!part.includes('cards:'));assert.match(part,/validation:deck.validation/);
});
test('battle browser uses no persistent storage or ad widgets and stops polling on navigation',async()=>{
  const s=await read('app/pages/battle/matches/[id].vue');assert.ok(!/localStorage|sessionStorage|AdSenseSlot|SponsorSlot|console\.log/.test(s));assert.match(s,/clearInterval/);assert.match(s,/document.hidden/);assert.match(s,/result.revision >= data.value.revision/);assert.match(s,/request_id: crypto.randomUUID/);
});
test('all battle pages explicitly request non-indexing and use the existing private client-rendered shell',async()=>{
  const cfg=await read('nuxt.config.ts');assert.match(cfg,/'\/battle': \{ ssr: false \}/);assert.match(cfg,/'\/battle\/\*\*': \{ ssr: false \}/);
  for(const p of ['app/pages/battle/index.vue','app/pages/battle/decks/[id].vue','app/pages/battle/matches/[id].vue','app/pages/admin/battle.vue'])assert.match(await read(p),/robots: 'noindex, nofollow'/);
});

test('unexpected database errors are not logged with private state or request parameters',async()=>{
  const s=await read('server/utils/battle-api.ts');assert.match(s,/error instanceof AppError/);assert.ok(!/console\.error\([^;]*[,][^;]*error/s.test(s));
  for(const p of ['server/api/battle/index.get.ts','server/api/battle/[...action].ts','server/api/admin/battle/index.get.ts','server/api/admin/battle/settings.post.ts'])assert.match(await read(p),/battleResult\(async/);
});
