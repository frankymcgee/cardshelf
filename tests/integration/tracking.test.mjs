// Synthetic fixtures only. Never point this suite at the running collection database.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import postgres from 'postgres';
import { digest, randomToken } from '../../lib/security.mjs';
import { appearanceDefaults } from '../../shared/appearance.mjs';
import { cardsDue } from '../../lib/prices.mjs';
import { closeDatabase } from '../../lib/db.mjs';
const url = process.env.TEST_BASE_URL;
if (process.env.ALLOW_TEST_DATABASE !== 'yes' || !url || !new URL(process.env.DATABASE_URL || 'http://invalid').pathname.endsWith('_test'))
  throw new Error('Tracking tests require ALLOW_TEST_DATABASE=yes and a disposable _test database.');
const sql = postgres(process.env.DATABASE_URL, { max: 3 });
const owner = randomUUID(), other = randomUUID(), token = randomToken(), otherToken = randomToken();
const setProvider = 'track-' + randomUUID(), setId = 'en:' + setProvider;
const ids = [1,2,3].map(n => 'en:' + setProvider + '-' + n);
const prints = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
let tracker, detailed;
async function request(path, { method = 'GET', body, session = token, headers = {} } = {}) {
  const response = await fetch(url + '/api/' + path, { method, headers: { Origin: process.env.APP_ORIGIN || url,
    'X-Requested-With': 'cardshelf', ...(session ? { Cookie: 'cardshelf_session=' + session } : {}),
    ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: response.status, data };
}
const state = async () => (await request('binders/' + tracker)).data;
const command = (b, collected = true, position = 0) => ({ request_id: randomUUID(), revision: b.revision, position,
  printing_id: b.slots.find(s => s.position === position).printing_id, collected });
const mark = (body, options = {}) => request('binders/' + tracker + '/tracking', { method: 'POST', body, ...options });
const generateOptions = { title: 'Tracking test', columns: 3, rows: 3, set_ids: [setId], selection: 'designs', binder_type: 'tracking' };
async function generate(options = generateOptions, requestId = randomUUID()) {
  const preview = await request('binders/generate/preview', { method: 'POST', body: options });
  assert.equal(preview.status, 200, JSON.stringify(preview.data));
  const body = { ...options, request_id: requestId, preview_token: preview.data.token };
  const result = await request('binders/generate', { method: 'POST', body });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  return { result: result.data, body, preview: preview.data };
}
await test('tracking binders, quick marks and preserved tester access', async t => {
  try {
    await sql`INSERT INTO app_users(id,email,name,password_hash) VALUES
      (${owner},${owner+'@test.invalid'},'Tracker owner','not-a-login'),(${other},${other+'@test.invalid'},'Other tracker','not-a-login')`;
    await sql`INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(${digest(token)},${owner},now()+interval '1 hour'),(${digest(otherToken)},${other},now()+interval '1 hour')`;
    await sql`INSERT INTO card_sets(id,provider_id,language,name,series,card_count) VALUES(${setId},${setProvider},'en','Synthetic tracking set','Tracking tests',3)`;
    for (const [i,id] of ids.entries()) await sql`INSERT INTO cards(id,provider_id,set_id,language,local_id,name)
      VALUES(${id},${id.slice(3)},${setId},'en',${String(i+1)},${'Synthetic Tracker '+(i+1)})`;
    await sql`INSERT INTO printings(id,card_id,key,label,source) VALUES
      (${prints[0]},${ids[0]},'normal','Normal','tcgdex'),(${prints[1]},${ids[0]},'reverse','Reverse Holo','tcgdex'),
      (${prints[2]},${ids[1]},'holo','Holo','tcgdex'),(${prints[3]},${ids[2]},'normal','Normal','tcgdex')`;
    await sql`INSERT INTO collection_entries(user_id,printing_id,condition,quantity,notes) VALUES(${owner},${prints[0]},'LP',2,'Existing inventory remains unchanged')`;
    const before = await sql`SELECT printing_id,condition,quantity,notes,revision FROM collection_entries WHERE user_id=${owner}`;
    await t.test('migration keeps older layouts and draft prices intact', async () => {
      const schema = 'tracking_migration_' + randomUUID().replaceAll('-','');
      try {
        await sql.unsafe(`CREATE SCHEMA "${schema}"`);
        await sql.begin(async tx => {
          await tx.unsafe(`SET LOCAL search_path TO "${schema}"`);
          await tx.unsafe("CREATE TABLE binders(id uuid PRIMARY KEY,title text,color text); CREATE TABLE binder_slots(binder_id uuid,position integer,printing_id uuid); CREATE TABLE membership_plans(code text,name text,description text,state text,revision integer,updated_at timestamptz,monthly_price_minor integer)");
          await tx`INSERT INTO binders VALUES(${randomUUID()},'Retain me','#876543')`;
          await tx`INSERT INTO binder_slots VALUES(${randomUUID()},0,${randomUUID()})`;
          await tx`INSERT INTO membership_plans VALUES('plus','My custom name','My edited description','draft',7,now(),2345)`;
          await tx.unsafe(await readFile(new URL('../../migrations/005_tracking_binders.sql',import.meta.url),'utf8'));
          const [b] = await tx`SELECT * FROM binders`;
          assert.equal(b.title,'Retain me');assert.equal(b.color,'#876543');assert.equal(b.binder_type,'collection');
          assert.equal((await tx`SELECT * FROM binder_slots`)[0].is_collected,false);
          const [p] = await tx`SELECT * FROM membership_plans`;assert.equal(p.description,'My edited description');assert.equal(p.revision,7);assert.equal(p.monthly_price_minor,2345);
        });
      } finally { await sql.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); }
    });
    await t.test('old create requests keep full collection binder behaviour', async () => {
      const response = await request('binders', { method:'POST',body:{title:'Original type',columns:3,rows:3,page_count:1,color:'#876543'} });
      assert.equal(response.status,200);detailed=response.data.id;assert.equal(response.data.binder_type,'collection');assert.equal(response.data.color,'#876543');
    });
    await t.test('generation creates tracking checklists with no owned cards inferred', async () => {
      const generated = await generate(); tracker=generated.result.binders[0].id;
      assert.equal(generated.preview.binder_type,'tracking');assert.equal(generated.preview.owned_slots,0);
      const b = await state();assert.equal(b.binder_type,'tracking');assert.equal(b.slots.length,3);assert.ok(b.slots.every(s=>s.is_collected===false));assert.equal(b.progress.collected,0);
      assert.equal(b.slots[0].owned,undefined);
      const replay=await request('binders/generate',{method:'POST',body:generated.body});assert.equal(replay.status,200);assert.equal(replay.data.replayed,true);assert.equal(replay.data.binders[0].id,tracker);
    });
    await t.test('unauthenticated, cross-origin and other-owner changes are rejected', async () => {
      const body=command(await state());assert.equal((await mark(body,{session:null})).status,401);
      assert.equal((await mark(body,{headers:{Origin:'https://other.invalid'}})).status,403);
      assert.equal((await mark(body,{session:otherToken})).status,404);
    });
    await t.test('invalid boolean, unknown printing and oversized body cannot change marks', async () => {
      const body=command(await state());assert.equal((await mark({...body,collected:'true'})).status,400);
      assert.equal((await mark({...body,printing_id:randomUUID()})).status,409);
      assert.equal((await mark({...body,position:99})).status,400);
      assert.equal((await mark({...body,junk:'x'.repeat(2500)})).status,413);
      assert.equal((await state()).progress.collected,0);
    });
    let first;
    await t.test('one quick mark persists and updates progress without touching inventory', async () => {
      first=command(await state());const r=await mark(first);assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(r.data.is_collected,true);assert.equal(r.data.progress.collected,1);assert.equal(r.data.progress.percent,33);
      const b=await state();assert.equal(b.slots[0].is_collected,true);assert.equal(b.revision,first.revision+1);
      assert.deepEqual(await sql`SELECT printing_id,condition,quantity,notes,revision FROM collection_entries WHERE user_id=${owner}`,before);
    });
    await t.test('retry of the same request does not create another update', async () => {
      const beforeRevision=(await state()).revision;
      const r=await mark(first);assert.equal(r.status,200);assert.equal(r.data.replayed,true);assert.equal(r.data.revision,beforeRevision);
      assert.equal((await sql`SELECT count(*)::integer AS n FROM binder_tracking_requests WHERE binder_id=${tracker} AND request_id=${first.request_id}`)[0].n,1);
    });
    await t.test('a collected card can be marked missing; an old retry does not undo it', async () => {
      const r=await mark(command(await state(),false));assert.equal(r.status,200);assert.equal(r.data.is_collected,false);
      const old=await mark(first);assert.equal(old.status,200);assert.equal(old.data.is_collected,false);assert.equal(old.data.progress.collected,0);
      assert.equal((await mark({...first,collected:false})).status,409);
    });
    await t.test('new stale edits fail instead of overwriting a later mark', async () => {
      const b=await state(),stale=command(b,false);assert.equal((await mark(command(b,true))).status,200);
      assert.equal((await mark(stale)).status,409);assert.equal((await state()).slots[0].is_collected,true);
    });
    await t.test('same-state saves are no-ops, not inventory increments', async () => {
      const b=await state(),r=await mark(command(b,true));assert.equal(r.status,200);assert.equal(r.data.revision,b.revision);
    });
    await t.test('concurrent different updates resolve to success and conflict', async () => {
      const b=await state();const results=await Promise.all([mark(command(b,false,0)),mark(command(b,true,1))]);
      assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
    });
    await t.test('concurrent identical requests replay safely', async () => {
      const b=await state(),body=command(b,!b.slots[0].is_collected);const results=await Promise.all([mark(body),mark(body)]);
      assert.deepEqual(results.map(r=>r.status),[200,200]);assert.equal(results.filter(r=>r.data.replayed).length,1);
    });
    await t.test('fixed tracking layouts reject replacing, moving and clearing targets', async () => {
      const b=await state();
      for(const body of [{action:'clear',target:0},{action:'swap',source:0,target:1},{action:'place',target:0,printing_id:prints[1]}]) {
        const r=await request('binders/'+tracker+'/slots',{method:'POST',body:{...body,revision:b.revision}});assert.ok([400,409].includes(r.status));
      }
      assert.equal((await state()).slots[0].printing_id,b.slots[0].printing_id);
    });
    await t.test('blank tracking binders accept new checklist targets in empty pockets', async () => {
      const response=await request('binders',{method:'POST',body:{title:'Blank tracker',binder_type:'tracking',columns:2,rows:2,page_count:1}});assert.equal(response.status,200);const id=response.data.id;
      const r=await request('binders/'+id+'/slots',{method:'POST',body:{action:'place',target:0,printing_id:prints[1],revision:1}});assert.equal(r.status,200);
      const b=(await request('binders/'+id)).data;assert.equal(b.slots[0].is_collected,false);
      assert.equal((await request('binders/'+id+'/slots',{method:'POST',body:{action:'place',target:1,printing_id:prints[1],revision:b.revision}})).status,409);
    });
    await t.test('tracking has no theme or valuation endpoint; detailed binders retain both', async () => {
      const b=await state();
      assert.equal((await request('binders/'+tracker+'/appearance',{method:'PATCH',body:{revision:b.revision,appearance:appearanceDefaults()}})).status,400);
      assert.equal((await request('prices/summary?binder_id='+tracker)).status,400);
      assert.equal((await request('binders/'+detailed+'/appearance',{method:'PATCH',body:{revision:1,appearance:appearanceDefaults()}})).status,200);
      assert.equal((await request('prices/summary?binder_id='+detailed)).status,200);
      assert.equal((await request('binders/'+detailed+'/tracking',{method:'POST',body:command(b)})).status,400);
    });
    await t.test('tracking metadata edits preserve layout and cannot convert binder type', async () => {
      const b=await state(),body={...b,title:'Renamed checklist'};
      const r=await request('binders/'+tracker,{method:'PATCH',body});assert.equal(r.status,200);assert.equal(r.data.binder_type,'tracking');
      assert.equal((await request('binders/'+tracker,{method:'PATCH',body:{...body,revision:r.data.revision,binder_type:'collection'}})).status,400);
      assert.equal((await request('binders/'+tracker,{method:'PATCH',body:{...body,revision:r.data.revision,color:'#eeeeee'}})).status,400);
    });
    await t.test('only deliberate tracking shares expose checklist progress', async () => {
      const b=await state();const response=await request('binders/'+tracker+'/share',{method:'POST',body:{revision:b.revision,enabled:true}});assert.equal(response.status,200);
      const publicPath='shared/'+response.data.share_token,r=await request(publicPath,{session:null});assert.equal(r.status,200);
      assert.equal(r.data.binder_type,'tracking');assert.equal(r.data.tracking_selection,'designs');assert.equal(r.data.user_id,undefined);assert.equal(r.data.generation,undefined);
      for(const slot of r.data.slots) { assert.equal(typeof slot.is_collected,'boolean');for(const key of ['quantity','notes','user_id','owned','condition'])assert.equal(key in slot,false); }
      assert.equal((await request(publicPath+'/tracking',{method:'POST',session:null,body:command(b)})).status,401);
      const off=await request('binders/'+tracker+'/share',{method:'POST',body:{revision:response.data.revision,enabled:false}});assert.equal(off.status,200);assert.equal((await request(publicPath,{session:null})).status,404);
    });
    await t.test('list progress and reloading agree with the saved checklist', async () => {
      const b=await state(),list=await request('binders');const item=list.data.find(x=>x.id===tracker);assert.equal(item.collected,b.progress.collected);assert.equal(item.filled,3);
    });
    await t.test('tracking-only cards do not trigger scheduled pricing work', async () => {
      const due=await cardsDue();assert.ok(due.some(c=>c.id===ids[0]));assert.ok(!due.some(c=>c.id===ids[1]||c.id===ids[2]));
    });
    await t.test('Collector Plus generation remains available to testers', async () => {
      const result=await generate({...generateOptions,binder_type:'collection',title:'Detailed test',owned_only:true});assert.equal(result.result.binders[0].binder_type,'collection');
      const b=(await request('binders/'+result.result.binders[0].id)).data;assert.equal(b.slots.length,1);assert.equal(b.slots[0].owned,true);
    });
    await t.test('subscription status cannot lock out a tester or silently change records', async () => {
      await sql`UPDATE account_memberships SET plan_code='collector',subscription_status='past_due' WHERE user_id=${owner}`;
      const member=await request('account/membership');assert.equal(member.status,200);assert.equal(member.data.access.allowed,true);assert.equal(member.data.access.payment_required,false);assert.equal(member.data.access.expires_at,null);
      assert.ok(member.data.access.features.some(f=>f.code==='tracking_binders'));assert.ok(member.data.access.features.some(f=>f.code==='prices'));
      assert.equal((await request('prices/summary?binder_id='+detailed)).status,200);
      const b=await state();assert.equal((await mark(command(b,!b.slots[0].is_collected))).status,200);
      assert.deepEqual(await sql`SELECT printing_id,condition,quantity,notes,revision FROM collection_entries WHERE user_id=${owner}`,before);
    });
    await t.test('tracking binder deletion removes its marks, not inventory or accounts', async () => {
      const b=await state();const r=await request('binders/'+tracker,{method:'DELETE',body:{revision:b.revision,confirm_title:b.title}});assert.equal(r.status,200);
      assert.equal((await sql`SELECT count(*)::integer AS n FROM binder_tracking_requests WHERE binder_id=${tracker}`)[0].n,0);
      assert.deepEqual(await sql`SELECT printing_id,condition,quantity,notes,revision FROM collection_entries WHERE user_id=${owner}`,before);
    });
  } finally {
    await sql`DELETE FROM app_users WHERE id IN (${owner},${other})`;
    await sql`DELETE FROM binder_generation_requests WHERE user_id=${owner}`;
    await sql`DELETE FROM printings WHERE card_id IN ${sql(ids)}`;
    await sql`DELETE FROM cards WHERE set_id=${setId}`;await sql`DELETE FROM card_sets WHERE id=${setId}`;
    await sql.end();await closeDatabase();
  }
});
