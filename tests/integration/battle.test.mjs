// The assisted HTTP surface has intentionally retired. Pure legacy engine tests
// remain; these regressions verify the replacement contract and archived data.
import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import postgres from 'postgres';import {hashPassword,randomToken,digest} from '../../lib/security.mjs';
const base=process.env.TEST_BASE_URL,url=process.env.DATABASE_URL;
if(process.env.ALLOW_TEST_DATABASE!=='yes'||!base||!new URL(url||'http://invalid').pathname.endsWith('_test'))throw Error('Use a disposable _test database.');
const sql=postgres(url,{max:4}),origin=process.env.APP_ORIGIN||base,users=[];
async function request(path,user=null,method='GET',body=undefined,extra={}){const r=await fetch(base+path,{method,redirect:'manual',headers:{Origin:origin,'X-Requested-With':'cardshelf',...(user?{Cookie:user.cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json'}),...extra},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,headers:r.headers,text:await r.text()};}
await test('retired assisted battle HTTP routes preserve data and point to Arena',async t=>{
 let admin,player,deck,match,old=[];
 async function account(role){const id=randomUUID(),token=randomToken();users.push(id);await sql`INSERT INTO app_users(id,name,email,password_hash,role) VALUES(${id},'Retirement test',${id+'@example.test'},${await hashPassword('Retirement fixture password 123')},${role})`;await sql`INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(${digest(token)},${id},now()+interval '1 hour')`;return {id,cookie:'cardshelf_session='+token};}
 try{
  admin=await account('admin');player=await account('user');old=await sql`SELECT * FROM battle_settings`;
  await sql`INSERT INTO battle_settings(singleton,enabled) VALUES(true,true) ON CONFLICT(singleton) DO UPDATE SET enabled=true`;
  await sql`INSERT INTO battle_access(user_id,granted_by) VALUES(${player.id},${admin.id})`;
  [deck]=await sql`INSERT INTO battle_decks(user_id,game,title,cards,create_request_id,create_hash) VALUES(${player.id},'pokemon','Archived deck','[]',${randomUUID()},${'a'.repeat(64)}) RETURNING *`;
  [match]=await sql`INSERT INTO battle_matches(host_id,game,host_alias,host_deck,state,create_request_id,create_hash) VALUES(${player.id},'pokemon','Archived player','{}',${sql.json({private:'ARCHIVED_PRIVATE_STATE'})},${randomUUID()},${'b'.repeat(64)}) RETURNING *`;
  await t.test('old page URLs redirect without sharing old match IDs or invitation queries',async()=>{
   for(const path of ['/battle','/battle/decks/new','/battle/matches/'+match.id+'?invite=private']){const r=await request(path,player);assert.equal(r.status,302);assert.equal(r.headers.get('location'),'/arena');assert.match(r.headers.get('cache-control'),/no-store/);}
   assert.equal((await request('/admin/battle',admin)).headers.get('location'),'/admin/arena');
  });
  await t.test('retired APIs still require a session and administrator role',async()=>{
   assert.equal((await request('/api/battle')).status,401);assert.equal((await request('/api/admin/battle')).status,401);assert.equal((await request('/api/admin/battle',player)).status,403);
  });
  await t.test('even an approved player or admin gets HTTP 410, not hidden archived state',async()=>{
   for(const path of ['/api/battle','/api/battle/decks','/api/battle/matches/'+match.id]){const r=await request(path,player);assert.equal(r.status,410);assert.match(r.headers.get('content-type'),/json/);assert.ok(!r.text.includes('ARCHIVED_PRIVATE_STATE'));assert.match(r.text,/retired/);}
   assert.equal((await request('/api/admin/battle',admin)).status,410);
  });
  await t.test('old mutation endpoints cannot create decks, toggle settings or execute actions',async()=>{
   for(const [path,user,method] of [['/api/battle/decks',player,'POST'],['/api/battle/decks/'+deck.id,player,'DELETE'],['/api/battle/matches/'+match.id+'/actions',player,'POST'],['/api/admin/battle/settings',admin,'POST']])assert.equal((await request(path,user,method,{})).status,410);
   assert.deepEqual((await sql`SELECT * FROM battle_decks WHERE id=${deck.id}`)[0],deck);assert.deepEqual((await sql`SELECT * FROM battle_matches WHERE id=${match.id}`)[0],match);
   assert.equal((await sql`SELECT enabled FROM battle_settings WHERE singleton`)[0].enabled,true);
  });
  await t.test('retired mutation requests cannot bypass existing origin checks',async()=>assert.equal((await request('/api/battle/decks',player,'POST',{}, {Origin:'https://evil.test'})).status,403));
  await t.test('the new arena route remains available separately and approval alone grants nothing',async()=>{
   assert.equal((await request('/arena',player)).status,200);const r=await request('/api/arena/status',player);assert.equal(r.status,200);assert.equal(JSON.parse(r.text).allowed,false);
  });
 }finally{
  await sql`DELETE FROM battle_settings`;if(old.length)await sql`INSERT INTO battle_settings ${sql(old)}`;
  if(users.length)await sql`DELETE FROM app_users WHERE id IN ${sql(users)}`;await sql.end();
 }
});
