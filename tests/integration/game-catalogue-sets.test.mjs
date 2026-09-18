// Disposable PostgreSQL + production HTTP + the actual page's setup handlers.
// Seed only the provider cache. No catalogue import worker or external provider runs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {db,closeDatabase} from '../../lib/db.mjs';
import {hashPassword,randomToken,digest} from '../../lib/security.mjs';
import {hashText,normaliseGameSets} from '../../lib/game-provider-logic.mjs';
import {createCataloguePage} from '../helpers/game-catalogue-page.mjs';

const base=process.env.TEST_BASE_URL,database=process.env.DATABASE_URL;
if(process.env.ALLOW_TEST_DATABASE!=='yes'||!base||
  !new URL(database||'http://invalid').pathname.endsWith('_test'))throw new Error('Use a disposable _test database only.');
const sql=db(),origin=process.env.APP_ORIGIN||base;
const users=[randomUUID(),randomUUID()],tokens=[randomToken(),randomToken()];
const suffix=randomUUID().replaceAll('-',''),magicCode='S'+suffix.slice(0,8).toUpperCase();
const fixtures={
  yugioh:[{set_name:'Synthetic Starter '+suffix,set_code:'SYN',num_of_cards:2,tcg_date:'2020-01-01'},
    {set_name:'Synthetic Reprint '+suffix,set_code:'SYN',num_of_cards:1}],
  mtg:{data:[{name:'Synthetic Magic '+suffix,code:magicCode,totalSetSize:3,releaseDate:'2020-01-01'},
    {name:'Synthetic Online Only',code:'SNO',totalSetSize:1,isOnlineOnly:true}]}
};
const kinds={yugioh:'ygo-sets',mtg:'mtg-sets'};
const cacheKeys=Object.values(kinds).map(kind=>kind+':'+hashText(''));
async function cache(game,value){
  const key=kinds[game]+':'+hashText('');
  await sql`INSERT INTO game_provider_cache(cache_key,payload_gzip) VALUES(${key},${gzipSync(JSON.stringify(value))})
    ON CONFLICT(cache_key) DO UPDATE SET payload_gzip=excluded.payload_gzip,fetched_at=now()`;
}
async function request(path,{user=0,method='GET',body,headers={}}={}){
  const response=await fetch(base+path,{method,redirect:'manual',headers:{
    Origin:origin,'X-Requested-With':'cardshelf',...(user===null?{}:{Cookie:'cardshelf_session='+tokens[user]}),
    ...(body===undefined?{}:{'Content-Type':'application/json'}),...headers
  },body:body===undefined?undefined:JSON.stringify(body)});
  const text=await response.text();let data;try{data=JSON.parse(text);}catch{data=text;}
  return {status:response.status,data,headers:response.headers};
}
async function pageApi(path,options={}){
  const query=options.query?'?'+new URLSearchParams(options.query):'';
  const result=await request(path+query,options);
  assert.match(result.headers.get('content-type')??'',/application\/json/,'Catalogue routes must return JSON.');
  if(result.status!==200)throw new Error(result.data?.message||result.data?.statusMessage||'Catalogue HTTP '+result.status);
  return result.data;
}
async function catalogueCounts(){
  return (await sql`SELECT (SELECT count(*)::integer FROM cards) AS cards,
    (SELECT count(*)::integer FROM card_sets) AS sets,
    (SELECT count(*)::integer FROM collection_entries) AS entries`)[0];
}

await test('additional-game set API matches the page consumer and keeps queue safeguards',async t=>{
  let originalCache=[];
  try{
    originalCache=await sql`SELECT * FROM game_provider_cache WHERE cache_key IN ${sql(cacheKeys)}`;
    const passwordHash=await hashPassword('Synthetic catalogue contract password 123');
    for(const [i,id] of users.entries()){
      await sql`INSERT INTO app_users(id,name,email,password_hash,role)
        VALUES(${id},'Catalogue contract',${'catalogue-'+id+'@example.test'},${passwordHash},${i===0?'admin':'user'})`;
      await sql`INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(${digest(tokens[i])},${id},now()+interval '1 hour')`;
    }
    for(const game of ['yugioh','mtg'])await cache(game,fixtures[game]);
    await t.test('only an authenticated administrator may load or queue additional-game sets',async()=>{
      for(const game of ['yugioh','mtg']){
        const path='/api/admin/game-catalogue/sets?game='+game;
        assert.equal((await request(path,{user:null})).status,401);
        assert.equal((await request(path,{user:1})).status,403);
      }
      assert.equal((await request('/api/admin/game-catalogue/import',{user:1,method:'POST',body:{}})).status,403);
      assert.equal((await request('/api/admin/game-catalogue/import',{method:'POST',body:{},headers:{Origin:'https://evil.test'}})).status,403);
    });
    for(const game of ['yugioh','mtg'])await t.test(game+' cached array populates the form and queues the selected identity exactly once',async()=>{
      const counts=await catalogueCounts();
      const response=await request('/api/admin/game-catalogue/sets?game='+game);
      assert.equal(response.status,200);assert.ok(Array.isArray(response.data));
      const expected=normaliseGameSets(game,fixtures[game]);assert.deepEqual(response.data,expected);
      // Pass the real HTTP response through the page, not just another normaliser.
      const page=createCataloguePage(pageApi);page.game.value=game;await page.load();
      assert.equal(page.error.value,'');assert.equal(page.loading.value,false);
      assert.equal(page.sets.value.length,expected.length);assert.equal(page.visible.value.length,expected.length);
      const selected=expected.at(-1);page.query.value=selected.name;
      assert.equal(page.visible.value.length,1);assert.equal(page.visible.value[0].code,selected.code);
      page.selected.value=selected.code;page.confirmed.value=true;await page.queue();
      assert.equal(page.error.value,'');assert.ok(page.job.value);
      const id=page.job.value;
      const [job]=await sql`SELECT id,kind,scope_key,payload,status FROM jobs WHERE id=${id}`;
      assert.equal(job.kind,'import-game-set');assert.equal(job.status,'queued');
      assert.equal(job.scope_key,'import-game:'+game+':'+selected.code);
      assert.deepEqual(job.payload,{game,code:selected.code});
      await page.queue();assert.equal(page.error.value,'');assert.equal(page.job.value,id);
      assert.match(page.notices.at(-1),/already queued/i);
      assert.equal((await sql`SELECT count(*)::integer AS n FROM jobs WHERE scope_key=${job.scope_key}`)[0].n,1);
      assert.deepEqual(await catalogueCounts(),counts,'Listing/queuing must not change card ownership or import cards synchronously.');
    });
    await t.test('a valid provider list with no supported Magic sets stays an empty array',async()=>{
      await cache('mtg',{data:[{name:'Synthetic Online Only',code:'SNO',totalSetSize:1,isOnlineOnly:true}]});
      const response=await request('/api/admin/game-catalogue/sets?game=mtg');assert.equal(response.status,200);assert.deepEqual(response.data,[]);
      const page=createCataloguePage(pageApi);page.game.value='mtg';await page.load();
      assert.equal(page.error.value,'');assert.equal(page.sets.value.length,0);assert.equal(page.visible.value.length,0);
      await cache('mtg',fixtures.mtg);
    });
    await t.test('an invalid cached provider response is reported without replacing the last valid list',async()=>{
      const page=createCataloguePage(pageApi);await page.load();assert.equal(page.sets.value.length,2);
      await cache('yugioh',{error:'Synthetic invalid provider response'});
      assert.equal((await request('/api/admin/game-catalogue/sets?game=yugioh')).status,502);
      await page.load();assert.ok(page.error.value);assert.equal(page.loading.value,false);
      assert.equal(page.sets.value.length,2);assert.equal(page.visible.value.length,2);
      await cache('yugioh',fixtures.yugioh);await page.load();assert.equal(page.error.value,'');
    });
    await t.test('confirmation and catalogue membership are still required before a job is created',async()=>{
      const [{n:before}]=await sql`SELECT count(*)::integer AS n FROM jobs WHERE user_id=${users[0]}`;
      const code=normaliseGameSets('yugioh',fixtures.yugioh)[0].code;
      assert.equal((await request('/api/admin/game-catalogue/import',{method:'POST',body:{game:'yugioh',code,confirm_provider_terms:false}})).status,400);
      assert.equal((await request('/api/admin/game-catalogue/import',{method:'POST',body:{game:'yugioh',code:'not-a-listed-set',confirm_provider_terms:true}})).status,404);
      assert.equal((await sql`SELECT count(*)::integer AS n FROM jobs WHERE user_id=${users[0]}`)[0].n,before);
    });
    await t.test('unsupported game requests remain explicit JSON errors',async()=>{
      const response=await request('/api/admin/game-catalogue/sets?game=unsupported');
      assert.equal(response.status,400);assert.match(response.headers.get('content-type'),/application\/json/);
    });
  }finally{
    try{
      await sql`DELETE FROM jobs WHERE user_id IN ${sql(users)}`;
      await sql`DELETE FROM app_users WHERE id IN ${sql(users)}`;
      await sql`DELETE FROM game_provider_cache WHERE cache_key IN ${sql(cacheKeys)}`;
      if(originalCache.length)await sql`INSERT INTO game_provider_cache ${sql(originalCache)}`;
    }finally{await closeDatabase();}
  }
});
