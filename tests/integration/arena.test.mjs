// Real HTTP + PostgreSQL tests against a disposable database. Synthetic cards only.
// No live Stripe, catalogue API, email, advertising or publisher artwork is contacted.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { hashPassword, randomToken, digest } from '../../lib/security.mjs';
import { cpuAction } from '../../lib/arena/bot.mjs';
const base=process.env.TEST_BASE_URL,url=process.env.DATABASE_URL;
if(process.env.ALLOW_TEST_DATABASE!=='yes'||!base||!new URL(url||'http://invalid').pathname.endsWith('_test'))throw Error('Use a disposable _test database.');
const sql=postgres(url,{max:4}),origin=process.env.APP_ORIGIN||base,password='Arena integration administrator password 123';
const suffix=randomUUID().replaceAll('-',''),setId='en:arena-'+suffix,cardIds=[setId+'-1',setId+'-2',setId+'-3'],users=[];
async function request(path,{user,method='GET',body,headers={}}={}) {
  const r=await fetch(base+path,{method,redirect:'manual',headers:{Origin:origin,'X-Requested-With':'cardshelf',...(user?{Cookie:user.cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json'}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
  const text=await r.text();let data;try{data=JSON.parse(text);}catch{data=text;}return {status:r.status,data,headers:r.headers};
}
await test('automated arena: paid eligibility, private decks, multiplayer, CPU and tutorial',async t=>{
  let old=[],admin,host,guest,outsider,free,tester,comp,hostDeck,guestDeck,match,code,practice,tutorial;
  async function account(name,role='user',tier=null){const id=randomUUID(),token=randomToken();users.push(id);
    await sql`INSERT INTO app_users(id,name,email,password_hash,role) VALUES(${id},${name},${id+'@example.test'},${await hashPassword(password)},${role})`;
    await sql`INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(${digest(token)},${id},now()+interval '1 hour')`;
    if(tier)await sql`INSERT INTO account_tier_overrides(user_id,tier,reason) VALUES(${id},${tier},'Synthetic arena entitlement')`;
    return {id,cookie:'cardshelf_session='+token,token};
  }
  async function settings(enabled){const current=await request('/api/admin/arena',{user:admin});assert.equal(current.status,200);const r=await request('/api/admin/arena/settings',{user:admin,method:'POST',body:{enabled,revision:current.data.revision,password,reason:'Synthetic arena test',confirm_rules:true,confirm_rights:true}});assert.equal(r.status,200,JSON.stringify(r.data));return r;}
  const deckBody=()=>({title:'Arena synthetic deck',revision:0,request_id:randomUUID(),cards:[{card_id:cardIds[0],quantity:4},{card_id:cardIds[1],quantity:56}]});
  async function current(user=host,id=match.id){const r=await request('/api/arena/matches/'+id,{user});assert.equal(r.status,200,JSON.stringify(r.data));return r.data;}
  async function act(user,action,id=match.id){const before=await current(user,id),r=await request('/api/arena/matches/'+id+'/actions',{user,method:'POST',body:{revision:before.revision,request_id:randomUUID(),action}});assert.equal(r.status,200,JSON.stringify(r.data));return r.data;}
  try {
    old=await sql`SELECT * FROM arena_settings`;await sql`DELETE FROM arena_settings`;
    admin=await account('Arena administrator','admin');host=await account('Collector player','user','collector');guest=await account('Plus player','user','plus');outsider=await account('Third administrator','admin','collector');tester=await account('Old beta tester');comp=await account('Complimentary','user','complimentary');free=await account('Free member');await sql`DELETE FROM account_access_grants WHERE user_id=${free.id}`;await sql`INSERT INTO free_accounts(user_id) VALUES(${free.id})`;
    await sql`INSERT INTO card_sets(id,provider_id,game,language,name,card_count) VALUES(${setId},${'arena-'+suffix},'pokemon','en','Arena synthetic set',3)`;
    const raw=[{category:'Pokemon',stage:'Basic',hp:100,types:['Fire'],retreat:1,attacks:[{name:'Synthetic tackle',damage:30,cost:['Colorless']}]},{category:'Energy',energyType:'Basic',effect:'Basic Energy'},{category:'Pokemon',stage:'Basic',hp:100,types:['Fire'],retreat:1,abilities:[{name:'Unsupported ability',effect:'A future effect.'}],attacks:[{name:'Tackle',damage:10,cost:[]}]}];
    for(let i=0;i<3;i++)await sql`INSERT INTO cards(id,provider_id,set_id,game,language,local_id,name,category,raw_data) VALUES(${cardIds[i]},${'arena-'+suffix+'-'+i},${setId},'pokemon','en',${String(i+1)},${i===1?'Fire Energy':i===0?'Arena Synthetic Basic':'Arena Unsupported Basic'},${raw[i].category},${sql.json(raw[i])})`;
    const [printing]=await sql`INSERT INTO printings(card_id,key,label,source) VALUES(${cardIds[0]},'normal','Normal','tcgdex') RETURNING id`;
    await sql`INSERT INTO collection_entries(user_id,printing_id,condition,quantity,wishlist,notes) VALUES(${host.id},${printing.id},'NM',2,true,'Arena must not edit this entry')`;
    await t.test('new route families are authenticated JSON, not HTML fallbacks',async()=>{
      for(const path of ['/api/arena/status','/api/arena/decks','/api/arena/catalogue','/api/arena/matches','/api/admin/arena']){const r=await request(path);assert.equal(r.status,401,path);assert.match(r.headers.get('content-type'),/json/);}
      assert.equal((await request('/api/admin/arena',{user:host})).status,403);
    });
    await t.test('the arena starts disabled even for eligible paid tiers',async()=>{const r=await request('/api/arena/status',{user:host});assert.equal(r.data.enabled,false);assert.equal(r.data.allowed,false);assert.equal(r.data.tier,'collector');assert.equal((await request('/api/arena/decks',{user:host})).status,403);});
    await t.test('activation requires administrator role, password, explicit acknowledgement and same origin',async()=>{
      const body={enabled:true,revision:0,password,reason:'Synthetic activation',confirm_rules:true,confirm_rights:true};
      assert.equal((await request('/api/admin/arena/settings',{user:host,method:'POST',body})).status,403);
      assert.equal((await request('/api/admin/arena/settings',{user:admin,method:'POST',body:{...body,password:'wrong'}})).status,403);
      assert.equal((await request('/api/admin/arena/settings',{user:admin,method:'POST',body:{...body,confirm_rules:false}})).status,400);
      assert.equal((await request('/api/admin/arena/settings',{user:admin,method:'POST',body,headers:{Origin:'https://evil.test'}})).status,403);
      await settings(true);
    });
    await t.test('Free, old tester and unassigned administrators do not bypass the subscription gate',async()=>{
      for(const user of [free,tester,admin]){const status=await request('/api/arena/status',{user});assert.equal(status.status,200);assert.equal(status.data.allowed,false);assert.equal((await request('/api/arena/decks',{user})).status,403);assert.equal((await request('/api/arena/matches',{user,method:'POST',body:{mode:'tutorial',training:true,alias:'Blocked',request_id:randomUUID()}})).status,403);}
      for(const user of [host,guest,comp])assert.equal((await request('/api/arena/status',{user})).data.allowed,true);
    });
    await t.test('Complimentary can save a deck and play a tutorial without payment or a beta approval',async()=>{
      const before=await sql`SELECT * FROM account_tier_overrides WHERE user_id=${comp.id}`;
      const deck=await request('/api/arena/decks',{user:comp,method:'POST',body:deckBody()});assert.equal(deck.status,200,JSON.stringify(deck.data));
      const r=await request('/api/arena/matches',{user:comp,method:'POST',body:{mode:'tutorial',training:true,alias:'Complimentary player',request_id:randomUUID()}});assert.equal(r.status,200,JSON.stringify(r.data));
      assert.deepEqual(r.data.table.players[1].hand,[]);
      const step=await act(comp,{type:'autoplay'},r.data.id);assert.ok(step.revision>r.data.revision);
      assert.deepEqual(await sql`SELECT * FROM account_tier_overrides WHERE user_id=${comp.id}`,before);
      assert.equal((await sql`SELECT id FROM stripe_subscriptions WHERE user_id=${comp.id}`).length,0);
      const [stored]=await sql`SELECT state,revision FROM arena_matches WHERE id=${r.data.id}`;
      await sql`UPDATE account_tier_overrides SET tier='inherit' WHERE user_id=${comp.id}`;
      assert.equal((await request('/api/arena/matches/'+r.data.id,{user:comp})).status,403);
      assert.deepEqual((await sql`SELECT state,revision FROM arena_matches WHERE id=${r.data.id}`)[0],stored);
      await sql`UPDATE account_tier_overrides SET tier='complimentary' WHERE user_id=${comp.id}`;
      assert.equal((await request('/api/arena/matches/'+r.data.id,{user:comp})).status,200);
    });
    await t.test('catalogue compilation exposes unsupported effects and no private notes',async()=>{
      const r=await request('/api/arena/catalogue?q=Arena',{user:host});assert.equal(r.status,200);const unsupported=r.data.items.find(c=>c.card.id===cardIds[2]);assert.equal(unsupported.supported,false);assert.match(unsupported.reason,/ability/i);assert.ok(!JSON.stringify(r.data).includes('Arena must not edit this entry'));assert.ok(r.data.items.every(c=>!Object.hasOwn(c,'raw_data')));
    });
    await t.test('saved deck creates are idempotent and both subscription tiers can save',async()=>{
      const body=deckBody(),r=await request('/api/arena/decks',{user:host,method:'POST',body});assert.equal(r.status,200,JSON.stringify(r.data));hostDeck=r.data;assert.equal(hostDeck.validation.playable,true);
      assert.equal((await request('/api/arena/decks',{user:host,method:'POST',body})).data.id,hostDeck.id);
      assert.equal((await request('/api/arena/decks',{user:host,method:'POST',body:{...body,title:'Different intent'}})).status,409);
      const g=await request('/api/arena/decks',{user:guest,method:'POST',body:deckBody()});assert.equal(g.status,200);guestDeck=g.data;
    });
    await t.test('unsupported effects, foreign card IDs and overfilled decks cannot be saved',async()=>{
      const body=deckBody();assert.equal((await request('/api/arena/decks',{user:host,method:'POST',body:{...body,cards:[{card_id:cardIds[2],quantity:4},{card_id:cardIds[1],quantity:56}]}})).status,422);
      for(const patch of [{user_id:guest.id},{cards:[{card_id:'ja:demo-1',quantity:1}]},{cards:[{card_id:cardIds[1],quantity:61}]}])assert.equal((await request('/api/arena/decks',{user:host,method:'POST',body:{...body,...patch}})).status,400);
    });
    await t.test('saved decks cannot be read or edited by another player or third administrator',async()=>{
      for(const user of [guest,outsider])assert.equal((await request('/api/arena/decks/'+hostDeck.id,{user})).status,404);
      assert.equal((await request('/api/arena/decks/'+hostDeck.id,{user:guest,method:'PUT',body:{...deckBody(),revision:hostDeck.revision}})).status,409);
    });
    await t.test('concurrent deck saves preserve revision checks',async()=>{
      const body={...deckBody(),revision:hostDeck.revision};const results=await Promise.all(['First','Second'].map(title=>request('/api/arena/decks/'+hostDeck.id,{user:host,method:'PUT',body:{...body,title}})));assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);hostDeck=(await request('/api/arena/decks/'+hostDeck.id,{user:host})).data;
    });
    await t.test('private match creation snapshots the deck and is safe to retry',async()=>{
      const body={mode:'pvp',deck_id:hostDeck.id,deck_revision:hostDeck.revision,alias:'Host',request_id:randomUUID()},r=await request('/api/arena/matches',{user:host,method:'POST',body});assert.equal(r.status,200,JSON.stringify(r.data));match=r.data;assert.equal(match.status,'waiting');assert.equal((await request('/api/arena/matches',{user:host,method:'POST',body})).data.id,match.id);
      assert.equal('host_deck' in match,false);assert.equal('host_id' in match,false);
    });
    await t.test('invitation is hashed, one-use, not included in ordinary polling or public routes',async()=>{
      const r=await act(host,{type:'invite'});code=r.invite_code;assert.match(code,/^[a-f0-9]{48}$/);const [saved]=await sql`SELECT invite_hash FROM arena_matches WHERE id=${match.id}`;assert.equal(saved.invite_hash,digest(code));assert.equal('invite_code' in await current(),false);
      assert.equal((await request('/api/arena/matches/'+match.id,{user:outsider})).status,404);
    });
    await t.test('joining requires a paid tier, a matching saved deck and host approval',async()=>{
      const body={code,deck_id:guestDeck.id,deck_revision:guestDeck.revision,alias:'Guest',request_id:randomUUID()};
      assert.equal((await request('/api/arena/join',{user:free,method:'POST',body})).status,403);
      const r=await request('/api/arena/join',{user:guest,method:'POST',body});assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(r.data.status,'approval');assert.equal(r.data.table,null);assert.equal('host_deck' in r.data,false);assert.equal((await request('/api/arena/join',{user:guest,method:'POST',body})).data.id,match.id);
      await act(host,{type:'approve'});
    });
    await t.test('both players must ready up; stale concurrent lobby changes cannot overwrite',async()=>{
      const before=await current(),path='/api/arena/matches/'+match.id+'/actions';const results=await Promise.all([host,guest].map(user=>request(path,{user,method:'POST',body:{revision:before.revision,request_id:randomUUID(),action:{type:'ready'}}})));assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
      const latest=await current();if(!latest.host_ready)await act(host,{type:'ready'});if(!latest.guest_ready)await act(guest,{type:'ready'});await act(host,{type:'start'});
    });
    await t.test('changing the saved deck after joining does not alter a match snapshot',async()=>{
      const [before]=await sql`SELECT host_deck FROM arena_matches WHERE id=${match.id}`;const body={...deckBody(),title:'Changed outside game',revision:hostDeck.revision};assert.equal((await request('/api/arena/decks/'+hostDeck.id,{user:host,method:'PUT',body})).status,200);assert.deepEqual((await sql`SELECT host_deck FROM arena_matches WHERE id=${match.id}`)[0].host_deck,before.host_deck);
    });
    await t.test('server state, hidden cards, deck order and invite hashes are absent from both player responses',async()=>{
      const [saved]=await sql`SELECT state FROM arena_matches WHERE id=${match.id}`;
      for(const [user,seat]of [[host,0],[guest,1]]){const r=await current(user),json=JSON.stringify(r);assert.match((await request('/api/arena/matches/'+match.id,{user})).headers.get('cache-control'),/private, no-store/);assert.equal('state' in r,false);assert.equal('invite_hash' in r,false);assert.equal('originalDecks' in r.table,false);assert.deepEqual(r.table.players[1-seat].hand,[]);for(const card of [...saved.state.players[1-seat].hand,...saved.state.players[1-seat].deck])assert.ok(!json.includes(card.id));}
    });
    await t.test('an applied setup move is not applied twice when its response is retried',async()=>{
      // A lone mulligan waits until the other player locks their opening field.
      // Exercise replay using the player who actually has a Basic to place.
      let before,move,user,seat;
      for(const [candidate,index] of [[host,0],[guest,1]]){const view=await current(candidate),legal=view.table.legal.find(m=>m.action.type==='setup'&&m.action.zone==='active');if(legal){before=view;move=legal;user=candidate;seat=index;break;}}
      assert.ok(move,'At least one player must have a Basic after shared mulligans.');
      const body={revision:before.revision,request_id:randomUUID(),action:move.action},path='/api/arena/matches/'+match.id+'/actions';const r=await request(path,{user,method:'POST',body});assert.equal(r.status,200);const again=await request(path,{user,method:'POST',body});assert.equal(again.status,200);assert.equal(again.data.revision,r.data.revision);assert.equal(again.data.replayed,true);assert.equal(again.data.table.players[seat].hand_count,r.data.table.players[seat].hand_count);assert.deepEqual(again.data.table,r.data.table);
      assert.equal((await request(path,{user,method:'POST',body:{...body,action:{type:'concede'}}})).status,409);
    });
    await t.test('CPU controls and arbitrary manual counters cannot be used to cheat a PvP game',async()=>{
      const before=await current(),path='/api/arena/matches/'+match.id+'/actions';assert.equal((await request(path,{user:host,method:'POST',body:{revision:before.revision,request_id:randomUUID(),action:{type:'autoplay'}}})).status,403);
      assert.equal((await request(path,{user:host,method:'POST',body:{revision:before.revision,request_id:randomUUID(),action:{type:'counters',damage:900}}})).status,400);assert.equal((await current()).revision,before.revision);
    });
    await t.test('expired opponent access blocks normal play, preserves state and is recoverable on renewal',async()=>{
      const before=await current();await sql`UPDATE account_tier_overrides SET expires_at=now()-interval '1 second' WHERE user_id=${guest.id}`;
      assert.equal((await request('/api/arena/matches/'+match.id,{user:guest})).status,403);
      // Entitlement is checked before gameplay legality, even if the host is
      // waiting for a lone mulligan and has no setup move of their own yet.
      const action=before.table.legal[0]?.action||{type:'end_turn'};assert.equal((await request('/api/arena/matches/'+match.id+'/actions',{user:host,method:'POST',body:{revision:before.revision,request_id:randomUUID(),action}})).status,403);
      await sql`UPDATE account_tier_overrides SET expires_at=NULL WHERE user_id=${guest.id}`;assert.equal((await current()).revision,before.revision);
    });
    await t.test('two authenticated player clients can complete automatic setup and attacks to a server-declared result',async()=>{
      let finished=false;for(let n=0;n<200&&!finished;n++){let acted=false;for(const user of [host,guest]){const v=await current(user);if(v.status==='finished'){finished=true;break;}const a=cpuAction(v.table);if(a){await act(user,a);acted=true;}}assert.ok(finished||acted,'Game stalled without a legal action or prompt.');}
      assert.equal(finished,true);assert.equal((await current()).table.phase,'finished');
    });
    await t.test('practice and tutorial require no imported deck and never expose the CPU hand',async()=>{
      for(const mode of ['practice','tutorial']){const r=await request('/api/arena/matches',{user:host,method:'POST',body:{mode,training:true,alias:'Training collector',difficulty:'easy',request_id:randomUUID()}});assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(r.data.own_deck.training,true);assert.deepEqual(r.data.table.players[1].hand,[]);if(mode==='practice')practice=r.data;else tutorial=r.data;}
    });
    await t.test('Auto play drives a practice game to a result using the same server rules',async()=>{
      let result=practice;for(let i=0;i<100&&result.status!=='finished';i++)result=await act(host,{type:'autoplay'},practice.id);assert.equal(result.status,'finished');assert.ok(result.table.result===0||result.table.result===1);assert.deepEqual(result.table.players[1].hand,[]);
    });
    await t.test('session revocation blocks the next table read without deleting it',async()=>{
      await sql`DELETE FROM sessions WHERE token_hash=${digest(host.token)}`;assert.equal((await request('/api/arena/matches/'+tutorial.id,{user:host})).status,401);await sql`INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(${digest(host.token)},${host.id},now()+interval '1 hour')`;assert.equal((await current(host,tutorial.id)).status,'active');
    });
    await t.test('global pause freezes access but retains all match state and decks',async()=>{
      const [before]=await sql`SELECT state FROM arena_matches WHERE id=${tutorial.id}`;await settings(false);assert.equal((await request('/api/arena/matches/'+tutorial.id,{user:host})).status,403);await settings(true);assert.deepEqual((await sql`SELECT state FROM arena_matches WHERE id=${tutorial.id}`)[0].state,before.state);
    });
    await t.test('games cannot write quantities, wishlist, notes, billing or original deck records',async()=>{
      const [entry]=await sql`SELECT quantity,wishlist,notes FROM collection_entries WHERE user_id=${host.id} AND printing_id=${printing.id}`;assert.equal(entry.quantity,2);assert.equal(entry.wishlist,true);assert.equal(entry.notes,'Arena must not edit this entry');assert.equal((await sql`SELECT id FROM stripe_subscriptions WHERE user_id IN ${sql(users)}`).length,0);
    });
    await t.test('arena documents are private, non-indexable and do not load advertising',async()=>{
      for(const path of ['/arena','/arena/decks/new','/arena/matches/'+tutorial.id,'/admin/arena']){const r=await request(path,{user:host});assert.equal(r.status,200);assert.match(r.headers.get('x-robots-tag'),/noindex/);assert.ok(!String(r.data).includes('adsbygoogle.js'));assert.ok(!String(r.data).includes('originalDecks'));}
    });
  }finally{
    await sql`DELETE FROM arena_settings`;if(old.length)await sql`INSERT INTO arena_settings ${sql(old)}`;
    if(users.length)await sql`DELETE FROM app_users WHERE id IN ${sql(users)}`;
    await sql`DELETE FROM printings WHERE card_id IN ${sql(cardIds)}`;await sql`DELETE FROM cards WHERE id IN ${sql(cardIds)}`;await sql`DELETE FROM card_sets WHERE id=${setId}`;await sql.end();
  }
});
