import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { hashPassword, randomToken, digest } from '../../lib/security.mjs';
import { gameRow } from '../helpers/arena-multigame-fixtures.mjs';
const base=process.env.TEST_BASE_URL,dbUrl=process.env.DATABASE_URL;
if(process.env.ALLOW_TEST_DATABASE!=='yes'||!base||!new URL(dbUrl||'http://invalid').pathname.endsWith('_test'))throw Error('Use the disposable _test database only.');
const sql=postgres(dbUrl,{max:4}),accounts=[],sets=[];
async function request(path,{user,method='GET',body}={}){
  const response=await fetch(base+path,{method,headers:{Origin:process.env.APP_ORIGIN||base,'X-Requested-With':'cardshelf',...(user?{Cookie:'cardshelf_session='+user.token}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return {status:response.status,data:await response.json()};
}
async function account(){const id=randomUUID(),token=randomToken();accounts.push(id);await sql`INSERT INTO app_users(id,name,email,password_hash,role) VALUES(${id},'Multi-game fixture',${id+'@example.test'},${await hashPassword('Disposable multigame password 123')},'admin')`;await sql`INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(${digest(token)},${id},now()+interval '1 hour')`;await sql`INSERT INTO account_tier_overrides(user_id,tier,reason) VALUES(${id},'collector','Multi-game fixture')`;return {id,token};}
async function seed(game){
  const suffix=randomUUID().replaceAll('-',''),set=`${game}:en:test-${suffix}`;sets.push(set);
  await sql`INSERT INTO card_sets(id,provider_id,game,language,name,card_count) VALUES(${set},${'test-'+suffix},${game},'en','Multi-game fixture',20)`;
  const rows=game==='yugioh'?Array.from({length:14},(_,i)=>({row:gameRow(game,'Normal '+i+' '+suffix),quantity:i===13?1:3})):
    [{row:gameRow(game,'Forest',{arena_data:{types:['Land'],supertypes:['Basic']},row:{id:`mtg:en:forest-${suffix}`,category:'Basic Land — Forest'}}),quantity:24},...Array.from({length:9},(_,i)=>({row:gameRow(game,'Creature '+i+' '+suffix),quantity:4}))];
  for(const {row:r} of rows)await sql`INSERT INTO cards(id,provider_id,set_id,game,language,local_id,name,category,raw_data) VALUES(${r.id},${r.id.split(':').at(-1)},${set},${game},'en','1',${r.name},${r.category},${sql.json(r.raw_data)})`;
  return {set,cards:rows.map(({row,quantity})=>({card_id:row.id,quantity}))};
}
await test('multi-game Arena persistence, private matches and catalogue contracts',async t=>{
  const previous=await sql`SELECT * FROM arena_settings`;
  try{
    await sql`DELETE FROM arena_settings`;await sql`INSERT INTO arena_settings(enabled) VALUES(true)`;
    const owner=await account(),guest=await account(),fixtures={yugioh:await seed('yugioh'),mtg:await seed('mtg')},decks={};
    for(const game of ['yugioh','mtg'])await t.test(game+' catalogue, imports and saved deck',async()=>{
      const fixture=fixtures[game];
      const filters=await request('/api/arena/catalogue/filters?game='+game,{user:owner});assert.equal(filters.status,200);assert.ok(filters.data.sets.some(s=>s.id===fixture.set));assert.ok(filters.data.sets.every(s=>s.id.startsWith(game+':')));
      const catalogue=await request('/api/arena/catalogue?game='+game+'&supported=1&set='+fixture.set,{user:owner});assert.equal(catalogue.status,200);assert.equal(catalogue.data.items.length,fixture.cards.length);assert.ok(catalogue.data.items.every(r=>r.supported&&r.card.game===game));
      const exported=JSON.stringify({format:'cardshelf-arena-deck',version:1,game,title:'Multi-game deck',cards:fixture.cards});
      const preview=await request('/api/arena/decks/preview-import',{user:owner,method:'POST',body:{game,text:exported}});assert.equal(preview.status,200);assert.equal(preview.data.validation.playable,true);
      const body={game,title:'Multi-game deck',cards:fixture.cards,revision:0,request_id:randomUUID()};
      const saved=await request('/api/arena/decks',{user:owner,method:'POST',body});assert.equal(saved.status,200,JSON.stringify(saved.data));assert.equal(saved.data.game,game);assert.equal(saved.data.validation.playable,true);decks[game]=saved.data;
      assert.equal((await request('/api/arena/decks',{user:owner,method:'POST',body})).data.id,saved.data.id);
      const foreign=await request('/api/arena/decks/'+saved.data.id,{user:guest});assert.equal(foreign.status,404);
      const mixed=await request('/api/arena/decks',{user:owner,method:'POST',body:{...body,game:game==='mtg'?'yugioh':'mtg',request_id:randomUUID()}});assert.equal(mixed.status,400);
    });
    for(const game of ['yugioh','mtg'])await t.test(game+' practice snapshots use its own engine and preserve retry privacy',async()=>{
      const deck=decks[game],body={mode:'practice',deck_id:deck.id,deck_revision:deck.revision,alias:'Player',opponent:'mirror',request_id:randomUUID()};
      let result=await request('/api/arena/matches',{user:owner,method:'POST',body});assert.equal(result.status,200,JSON.stringify(result.data));assert.equal(result.data.game,game);assert.equal(result.data.table.game,game);assert.match(result.data.version,new RegExp('^'+game+'-'));
      const match=result.data;assert.equal((await request('/api/arena/matches',{user:owner,method:'POST',body})).data.id,match.id);
      assert.deepEqual(match.table.players[1].hand,[]);assert.equal(match.table.players[1].deck,undefined);
      assert.equal((await request('/api/arena/matches/'+match.id,{user:guest})).status,404);
      const action={revision:match.revision,request_id:randomUUID(),action:{type:'autoplay'}};
      result=await request('/api/arena/matches/'+match.id+'/actions',{user:owner,method:'POST',body:action});assert.equal(result.status,200,JSON.stringify(result.data));
      const retry=await request('/api/arena/matches/'+match.id+'/actions',{user:owner,method:'POST',body:action});assert.equal(retry.data.revision,result.data.revision);
      if(result.data.status==='active')assert.equal((await request('/api/arena/matches/'+match.id+'/actions',{user:owner,method:'POST',body:{revision:result.data.revision,request_id:randomUUID(),action:{type:'concede'}}})).status,200);
    });
    await t.test('private tables reject a guest deck from another game and events pin a chosen game',async()=>{
      const host=decks.mtg;
      let result=await request('/api/arena/matches',{user:owner,method:'POST',body:{mode:'pvp',alias:'Host',deck_id:host.id,deck_revision:host.revision,request_id:randomUUID()}});assert.equal(result.status,200);const id=result.data.id;
      result=await request('/api/arena/matches/'+id+'/actions',{user:owner,method:'POST',body:{revision:result.data.revision,request_id:randomUUID(),action:{type:'invite'}}});assert.equal(result.status,200);
      const foreign=await request('/api/arena/decks',{user:guest,method:'POST',body:{game:'yugioh',title:'Guest',cards:fixtures.yugioh.cards,revision:0,request_id:randomUUID()}});
      const join=await request('/api/arena/join',{user:guest,method:'POST',body:{code:result.data.invite_code,alias:'Guest',deck_id:foreign.data.id,deck_revision:foreign.data.revision,request_id:randomUUID()}});assert.equal(join.status,422);
      const event=await request('/api/arena/tournaments',{user:owner,method:'POST',body:{game:'mtg',title:'Magic event',description:'Fixture',capacity:2,request_id:randomUUID()}});assert.equal(event.status,200);assert.equal(event.data.game,'mtg');
    });
  }finally{
    if(accounts.length){await sql`DELETE FROM arena_tournaments WHERE created_by IN ${sql(accounts)}`;await sql`DELETE FROM app_users WHERE id IN ${sql(accounts)}`;}
    for(const set of sets){await sql`DELETE FROM cards WHERE set_id=${set}`;await sql`DELETE FROM card_sets WHERE id=${set}`;}
    await sql`DELETE FROM arena_settings`;if(previous.length)await sql`INSERT INTO arena_settings ${sql(previous)}`;await sql.end();
  }
});
