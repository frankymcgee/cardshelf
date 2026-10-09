// Real HTTP and a disposable PostgreSQL database; all catalogue records below
// are synthetic fixtures, never external publisher downloads or production data.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { hashPassword, randomToken, digest } from '../../lib/security.mjs';
import { compileArenaCard } from '../../lib/arena/cards.mjs';
import { ARENA_VERSION, LEGACY_ARENA_VERSION, LEGACY_RULES_ARENA_VERSION } from '../../shared/arena.mjs';
import { readyFixture, row as cardRow, take, trainer } from '../helpers/arena-fixtures.mjs';
import { applyArenaAction } from '../../lib/arena/engine.mjs';
const base=process.env.TEST_BASE_URL,url=process.env.DATABASE_URL;
if(process.env.ALLOW_TEST_DATABASE!=='yes'||!base||!new URL(url||'http://invalid').pathname.endsWith('_test'))throw Error('Use a disposable _test database.');
const sql=postgres(url,{max:4}),origin=process.env.APP_ORIGIN||base,users=[];
const suffix=randomUUID().replaceAll('-',''),setId='en:arena-expansion-'+suffix;
const cardIds=[setId+'-1',setId+'-2',setId+'-3'];
async function request(path,{user,method='GET',body}={}) {
  const response=await fetch(base+'/api/arena/'+path,{method,redirect:'manual',headers:{Origin:origin,'X-Requested-With':'cardshelf',...(user?{Cookie:user.cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});
  const text=await response.text();let data;try{data=JSON.parse(text);}catch{data=text;}return {status:response.status,data};
}
await test('Arena expansion: genuine saved practice decks and retained lobby engines',async t=>{
  let old=[],host,guest,outsider,own,alternative,foreign;
  async function account(name){const id=randomUUID(),token=randomToken();users.push(id);
    await sql`INSERT INTO app_users(id,name,email,password_hash) VALUES(${id},${name},${id+'@example.test'},${await hashPassword('Synthetic arena expansion account 123')})`;
    await sql`INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(${digest(token)},${id},now()+interval '1 hour')`;
    await sql`INSERT INTO account_tier_overrides(user_id,tier,reason) VALUES(${id},'collector','Synthetic expansion test')`;
    return {id,cookie:'cardshelf_session='+token};
  }
  const entries=()=>[{card_id:cardIds[0],quantity:4},{card_id:cardIds[1],quantity:56}];
  async function save(user,title){const r=await request('decks',{user,method:'POST',body:{title,cards:entries(),revision:0,request_id:randomUUID()}});assert.equal(r.status,200,JSON.stringify(r.data));return r.data;}
  const body=(extra={})=>({mode:'practice',deck_id:own.id,deck_revision:own.revision,alias:'Collector',request_id:randomUUID(),...extra});
  async function act(user,id,action){const current=await request('matches/'+id,{user});assert.equal(current.status,200,JSON.stringify(current.data));const r=await request('matches/'+id+'/actions',{user,method:'POST',body:{revision:current.data.revision,request_id:randomUUID(),action}});assert.equal(r.status,200,JSON.stringify(r.data));return r.data;}
  async function create(extra={}){const r=await request('matches',{user:host,method:'POST',body:body(extra)});assert.equal(r.status,200,JSON.stringify(r.data));return r.data;}
  async function stored(id){return (await sql`SELECT * FROM arena_matches WHERE id=${id}`)[0];}
  function profile(name,raw){const r=compileArenaCard({...cardRow(raw),name});assert.equal(r.supported,true,r.reason);return r.card;}
  // Direct state injection is limited to the explicitly disposable _test DB.
  // There is no fixture/debug endpoint in the application or deployed platform.
  async function persistFixture(state){const match=await create({opponent:'mirror'}),r=await stored(match.id);
    await sql`UPDATE arena_matches SET mode='pvp',guest_id=${guest.id},guest_alias='Synthetic rules guest',engine_version=${state.version},state=${sql.json(state)},host_deck=${sql.json({...r.host_deck,cards:state.originalDecks[0]})},guest_deck=${sql.json({...r.guest_deck,cards:state.originalDecks[1]})} WHERE id=${match.id}`;
    return match.id;
  }
  try {
    old=await sql`SELECT * FROM arena_settings`;await sql`DELETE FROM arena_settings`;await sql`INSERT INTO arena_settings(singleton,enabled) VALUES(true,true)`;
    host=await account('Expansion host');guest=await account('Expansion guest');outsider=await account('Expansion outsider');
    await sql`INSERT INTO card_sets(id,provider_id,game,language,name,card_count) VALUES(${setId},${'arena-expansion-'+suffix},'pokemon','en','Synthetic expansion fixtures',3)`;
    const raw=[{category:'Pokemon',stage:'Basic',hp:100,types:['Fire'],retreat:1,attacks:[{name:'Fixture attack',cost:['Colorless'],damage:30}]},{category:'Energy',energyType:'Basic'},{category:'Trainer',trainerType:'Tool',effect:'The Pokemon this card is attached to gets +20 HP.'}];
    const names=['Synthetic expansion Basic','Fire Energy','Synthetic expansion Cape'];
    for(let i=0;i<3;i++)await sql`INSERT INTO cards(id,provider_id,set_id,game,language,local_id,name,category,raw_data) VALUES(${cardIds[i]},${suffix+'-'+i},${setId},'pokemon','en',${String(i+1)},${names[i]},${raw[i].category},${sql.json(raw[i])})`;
    own=await save(host,'My selected deck');foreign=await save(outsider,'Private opponent deck');
    await t.test('default matched practice discloses its genuine-card mirror fallback',async()=>{
      const match=await create(),row=await stored(match.id);
      assert.equal(match.version,ARENA_VERSION);assert.equal(match.opponent_deck.selection,'matched');assert.equal(match.opponent_deck.source,'mirror');
      assert.match(match.opponent_deck.reason,/No comparable supported saved deck/);
      assert.deepEqual(row.guest_deck.cards,row.host_deck.cards);assert.ok(row.guest_deck.cards.every(({card})=>card.id.startsWith('en:')&&!card.training));
      assert.deepEqual(match.table.players[1].hand,[]);assert.equal('cards' in match.opponent_deck,false);
      await act(host,match.id,{type:'concede'});
    });
    alternative=await save(host,'Comparable saved deck');
    await t.test('matched and chosen opponents use immutable snapshots of private owned decks',async()=>{
      const matched=await create({opponent:'matched'});assert.equal(matched.opponent_deck.source,'saved');assert.equal(matched.opponent_deck.title,alternative.title);await act(host,matched.id,{type:'concede'});
      const payload=body({opponent:'saved',opponent_deck_id:alternative.id,opponent_deck_revision:alternative.revision});
      const first=await request('matches',{user:host,method:'POST',body:payload});assert.equal(first.status,200,JSON.stringify(first.data));const before=await stored(first.data.id);
      const retry=await request('matches',{user:host,method:'POST',body:payload});assert.equal(retry.data.id,first.data.id);assert.equal(retry.data.revision,first.data.revision);
      assert.equal((await request('matches',{user:host,method:'POST',body:{...payload,opponent:'mirror',opponent_deck_id:undefined,opponent_deck_revision:undefined}})).status,409);
      const edited=await request('decks/'+alternative.id,{user:host,method:'PUT',body:{title:'Edited after snapshot',cards:entries(),revision:alternative.revision,request_id:randomUUID()}});assert.equal(edited.status,200);alternative=edited.data;
      assert.deepEqual((await stored(first.data.id)).guest_deck,before.guest_deck);
      assert.equal((await request('matches/'+first.data.id,{user:outsider})).status,404);
      await act(host,first.data.id,{type:'concede'});
    });
    await t.test('chosen opponent access, revision and mode fields are enforced',async()=>{
      for(const [extra,status] of [
        [{opponent:'saved',opponent_deck_id:foreign.id,opponent_deck_revision:foreign.revision},404],
        [{opponent:'saved',opponent_deck_id:alternative.id,opponent_deck_revision:alternative.revision-1},409],
        [{opponent:'saved'},400],
        [{opponent:'mirror',opponent_deck_id:alternative.id,opponent_deck_revision:alternative.revision},400],
        [{mode:'pvp',opponent:'mirror'},400]
      ])assert.equal((await request('matches',{user:host,method:'POST',body:body(extra)})).status,status,JSON.stringify(extra));
      assert.equal((await request('matches',{user:host,method:'POST',body:{mode:'tutorial',training:true,alias:'Training',opponent:'mirror',request_id:randomUUID()}})).status,400);
      const match=await create({opponent:'mirror'});assert.equal(match.opponent_deck.selection,'mirror');assert.equal(match.opponent_deck.source,'mirror');await act(host,match.id,{type:'concede'});
    });
    await t.test('a pre-upgrade waiting lobby joins, starts and continues under its original engine',async()=>{
      const guestDeck=await save(guest,'Legacy-compatible guest deck'),match=await create({mode:'pvp'}),row=await stored(match.id);
      const catalogue=await sql`SELECT * FROM cards WHERE id IN ${sql(cardIds)}`;
      const legacyCards=entries().map(entry=>({card:compileArenaCard(catalogue.find(card=>card.id===entry.card_id),LEGACY_ARENA_VERSION).card,quantity:entry.quantity}));
      await sql`UPDATE arena_matches SET engine_version=${LEGACY_ARENA_VERSION},host_deck=${sql.json({...row.host_deck,cards:legacyCards})} WHERE id=${match.id}`;
      const invited=await act(host,match.id,{type:'invite'});
      const expandedDeck=await request('decks',{user:guest,method:'POST',body:{title:'Expanded-only guest deck',cards:[{card_id:cardIds[0],quantity:4},{card_id:cardIds[1],quantity:52},{card_id:cardIds[2],quantity:4}],revision:0,request_id:randomUUID()}});
      assert.equal(expandedDeck.status,200,JSON.stringify(expandedDeck.data));
      const rejected=await request('join',{user:guest,method:'POST',body:{code:invited.invite_code,deck_id:expandedDeck.data.id,deck_revision:expandedDeck.data.revision,alias:'Expanded guest',request_id:randomUUID()}});
      assert.equal(rejected.status,422,'An old lobby cannot accept a newly supported Tool through the new compiler.');
      assert.equal((await stored(match.id)).status,'waiting');
      const joined=await request('join',{user:guest,method:'POST',body:{code:invited.invite_code,deck_id:guestDeck.id,deck_revision:guestDeck.revision,alias:'Legacy guest',request_id:randomUUID()}});
      assert.equal(joined.status,200,JSON.stringify(joined.data));assert.equal(joined.data.version,LEGACY_ARENA_VERSION);
      const afterJoin=await stored(match.id);assert.ok(afterJoin.guest_deck.cards.every(({card})=>card.compiler===LEGACY_ARENA_VERSION));
      await act(host,match.id,{type:'approve'});await act(host,match.id,{type:'ready'});await act(guest,match.id,{type:'ready'});
      const started=await act(host,match.id,{type:'start'});assert.equal(started.table.version,LEGACY_ARENA_VERSION);
      const setup=started.table.legal.find(move=>move.action.type==='setup'&&move.action.zone==='active');assert.ok(setup);
      const moved=await act(host,match.id,setup.action);assert.equal(moved.table.version,LEGACY_ARENA_VERSION);
      await act(host,match.id,{type:'concede'});
    });
    await t.test('database and state version mismatches refuse reads and mutations without changing snapshots',async()=>{
      const match=await create({opponent:'mirror'});await sql`UPDATE arena_matches SET engine_version=${LEGACY_ARENA_VERSION} WHERE id=${match.id}`;
      const before=await stored(match.id);assert.equal((await request('matches/'+match.id,{user:host})).status,409);
      const r=await request('matches/'+match.id+'/actions',{user:host,method:'POST',body:{revision:before.revision,request_id:randomUUID(),action:{type:'concede'}}});assert.equal(r.status,409);
      const after=await stored(match.id);assert.deepEqual(after.state,before.state);assert.equal(after.revision,before.revision);
      await sql`UPDATE arena_matches SET engine_version=${ARENA_VERSION} WHERE id=${match.id}`;await act(host,match.id,{type:'concede'});
    });
    await t.test('v4 private Ability costs persist across authenticated reloads and preserve shared VSTAR use',async()=>{
      const s=readyFixture(),source=s.players[0].active;source.card=profile('Synthetic VSTAR',{stage:'VSTAR',evolveFrom:'Synthetic V',abilities:[{type:'Ability',name:'Star Draw',effect:"You must discard an Energy card from your hand in order to use this Ability. During your turn, you may draw 2 cards. (You can't use more than 1 VSTAR Power in a game.)"}]});
      const energy=take(s,0,c=>c.card.kind==='energy'),id=await persistFixture(s),started=await act(host,id,{type:'ability',card:source.id,index:0});
      assert.equal(started.table.prompt.kind,'ability_discard');assert.equal(started.table.players[0].vstar_used,true);
      const before=await stored(id),reloaded=await request('matches/'+id,{user:host}),other=await request('matches/'+id,{user:guest});
      assert.deepEqual(reloaded.data.table.prompt,started.table.prompt);assert.equal(other.data.table.prompt,null);assert.equal(other.data.table.players[0].vstar_used,true);assert.equal(JSON.stringify(other.data).includes(energy.id),false);assert.equal((await request('matches/'+id,{user:outsider})).status,404);
      const payload={revision:before.revision,request_id:randomUUID(),action:{type:'choose',choices:[energy.id]}};
      const first=await request('matches/'+id+'/actions',{user:host,method:'POST',body:payload}),retry=await request('matches/'+id+'/actions',{user:host,method:'POST',body:payload});
      assert.equal(first.status,200,JSON.stringify(first.data));assert.deepEqual(retry.data,first.data);assert.equal(first.data.table.prompt,null);assert.equal(first.data.table.players[0].vstar_used,true);assert.equal(first.data.table.players[0].discard.length,1);
      const rejected=await request('matches/'+id+'/actions',{user:host,method:'POST',body:{revision:before.revision,request_id:randomUUID(),action:{type:'end_turn'}}});assert.equal(rejected.status,409);assert.equal((await stored(id)).revision,before.revision+1);
      const again=await request('matches/'+id+'/actions',{user:host,method:'POST',body:{revision:first.data.revision,request_id:randomUUID(),action:{type:'ability',card:source.id,index:0}}});assert.equal(again.status,409);await act(host,id,{type:'concede'});
    });
    await t.test('v4 Lost Zone persists as public data while recovery only searches the discard pile',async()=>{
      const s=readyFixture(),prism=take(s,0,()=>true);prism.card=profile('Synthetic draw ◇',{category:'Trainer',trainerType:'Item',effect:'Draw 2 cards.'});const id=await persistFixture(s);
      const after=await act(host,id,{type:'trainer',card:prism.id});assert.equal(after.table.players[0].lost_zone.length,1);assert.equal(after.table.players[0].lost_zone[0].card.name,'Synthetic draw ◇');assert.equal(after.table.players[0].discard.length,0);
      const saved=await stored(id),other=await request('matches/'+id,{user:guest});assert.equal(saved.state.players[0].lostZone[0].owner,0);assert.equal(other.data.table.players[0].lost_zone[0].card.name,'Synthetic draw ◇');assert.deepEqual(other.data.table.players[0].hand,[]);await act(host,id,{type:'concede'});
    });
    await t.test('v4 cross-player Tool ownership returns to its original owner after a persisted removal',async()=>{
      let s=readyFixture();s.players[1].active.card=profile('Synthetic EX',{suffix:'EX'});const gear=take(s,0,()=>true);gear.card=profile('Head Ringer Team Flare Hyper Gear',{category:'Trainer',trainerType:'Tool',effect:"The attacks of the Pokemon this card is attached to cost Colorless more. When this card is removed from a Pokemon for any reason, put this card in its owner's discard pile."});
      s=applyArenaAction(s,0,{type:'trainer',card:gear.id,target:s.players[1].active.id});s.turn=1;s.turnNumber++;const remove=trainer(s,1,{kind:'discard_tools',side:'own',count:'all'}),id=await persistFixture(s);
      const after=await act(guest,id,{type:'trainer',card:remove.id});assert.equal(after.table.players[1].active.tools.length,0);assert.ok(after.table.players[0].discard.some(u=>u.card.name==='Head Ringer Team Flare Hyper Gear'));assert.equal(after.table.players[1].discard.some(u=>u.card.name==='Head Ringer Team Flare Hyper Gear'),false);
      const persisted=await stored(id);assert.equal(persisted.state.players[0].discard.find(u=>u.card.name==='Head Ringer Team Flare Hyper Gear').owner,0);await act(host,id,{type:'concede'});
    });
    await t.test('v4 Fossil viewed cards remain private while a paused bottom-deck decision is reloaded',async()=>{
      const s=readyFixture(),fossil=take(s,0,()=>true);fossil.card=profile('Helix Fossil Omanyte',{category:'Trainer',trainerType:'Item',effect:'Look at the bottom 7 cards of your deck. You may reveal an Omanyte you find there and put it onto your Bench. Shuffle the other cards back into your deck.'});
      const id=await persistFixture(s),started=await act(host,id,{type:'trainer',card:fossil.id});assert.equal(started.table.prompt.kind,'fossil_search');assert.equal(started.table.prompt.looked_at.length,7);
      const reloaded=await request('matches/'+id,{user:host}),other=await request('matches/'+id,{user:guest});assert.deepEqual(reloaded.data.table.prompt,started.table.prompt);assert.equal(other.data.table.prompt,null);
      for(const u of started.table.prompt.looked_at)assert.equal(JSON.stringify(other.data).includes(u.id),false);
      const after=await act(host,id,{type:'choose',choices:[]});assert.equal(after.table.prompt,null);assert.equal((await stored(id)).state.players[0].resolving.length,0);await act(host,id,{type:'concede'});
    });
    await t.test('v4 Checkup orders persist for the next player and finish all steps before the turn draw',async()=>{
      const s=readyFixture();s.players[0].active.card=profile('Checkup healer',{abilities:[{type:'Ability',name:'Checkup recovery',effect:'During Pokemon Checkup, heal 20 damage from this Pokemon.'}]});s.players[0].active.damage=30;s.players[0].active.conditions.poison=true;
      const id=await persistFixture(s),started=await act(host,id,{type:'end_turn'});assert.equal(started.table.prompt,null);assert.equal(started.table.waiting_for,1);
      const reloaded=await request('matches/'+id,{user:guest});assert.equal(reloaded.data.table.prompt.kind,'checkup_order');assert.equal(reloaded.data.table.players[0].active.damage,30);
      const heal=reloaded.data.table.prompt.options.find(o=>o.id!=='conditions'),afterHeal=await act(guest,id,{type:'choose',choices:[heal.id]});assert.equal(afterHeal.table.players[0].active.damage,10);assert.equal(afterHeal.table.prompt.kind,'checkup_order');
      const after=await act(guest,id,{type:'choose',choices:['conditions']});assert.equal(after.table.players[0].active.damage,20);assert.equal(after.table.turn,1);assert.equal(after.table.prompt,null);assert.equal((await stored(id)).state.turn,1);await act(host,id,{type:'concede'});
    });
    await t.test('an in-progress v3 private decision continues under v3 without acquiring v4 fields',async()=>{
      let s=readyFixture();take(s,0,c=>c.card.kind==='energy','discard');const c=trainer(s,0,{kind:'recover',filter:'energy',count:2,optional:true});
      s=JSON.parse(JSON.stringify(s).replaceAll(ARENA_VERSION,LEGACY_RULES_ARENA_VERSION));s=applyArenaAction(s,0,{type:'trainer',card:c.id});const id=await persistFixture(s),before=await request('matches/'+id,{user:host});
      assert.equal(before.data.version,LEGACY_RULES_ARENA_VERSION);assert.equal(before.data.table.prompt.min,1);assert.equal('vstar_used' in before.data.table.players[0],false);assert.equal('lost_zone' in before.data.table.players[0],false);
      const after=await act(host,id,{type:'choose',choices:[before.data.table.prompt.options[0].id]});assert.equal(after.table.version,LEGACY_RULES_ARENA_VERSION);assert.equal((await stored(id)).state.version,LEGACY_RULES_ARENA_VERSION);await act(host,id,{type:'concede'});
    });
    await t.test('practice never changes collections, subscriptions or saved deck card lists',async()=>{
      assert.equal((await sql`SELECT user_id FROM collection_entries WHERE user_id IN ${sql(users)}`).length,0);
      assert.equal((await sql`SELECT id FROM stripe_subscriptions WHERE user_id IN ${sql(users)}`).length,0);
      assert.deepEqual((await sql`SELECT cards FROM arena_decks WHERE id=${own.id}`)[0].cards,entries());
    });
  } finally {
    await sql`DELETE FROM arena_settings`;if(old.length)await sql`INSERT INTO arena_settings ${sql(old)}`;
    if(users.length)await sql`DELETE FROM app_users WHERE id IN ${sql(users)}`;
    await sql`DELETE FROM cards WHERE id IN ${sql(cardIds)}`;await sql`DELETE FROM card_sets WHERE id=${setId}`;await sql.end();
  }
});
