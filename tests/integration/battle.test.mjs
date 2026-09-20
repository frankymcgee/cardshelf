// Disposable PostgreSQL + built application HTTP tests. All cards are synthetic.
// No card provider, advertisement, email or financial service is contacted.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { hashPassword, randomToken, digest } from '../../lib/security.mjs';
const base=process.env.TEST_BASE_URL,dbUrl=process.env.DATABASE_URL;
if(process.env.ALLOW_TEST_DATABASE!=='yes'||!base||!new URL(dbUrl||'http://invalid').pathname.endsWith('_test'))throw new Error('Use only a disposable _test database.');
const sql=postgres(dbUrl,{max:4}),origin=process.env.APP_ORIGIN||base,ids=[],cards=[];
const password='Synthetic battle admin password 123',suffix=randomUUID().replaceAll('-','');
const setId='en:battle-'+suffix;
async function request(path,{user,method='GET',body,headers={}}={}) {
  const r=await fetch(base+path,{method,redirect:'manual',headers:{Origin:origin,'X-Requested-With':'cardshelf',...(user?{Cookie:user.cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json'}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
  const t=await r.text();let data;try{data=JSON.parse(t);}catch{data=t;}return {status:r.status,data,headers:r.headers};
}
await test('private battle beta: access, saved decks, two-player state and concealed information',async t=>{
  let oldSettings=[],admin,host,guest,outsider,unapproved,settings,hostDeck,guestDeck,match,invitation;
  async function account(name,role='user'){
    const id=randomUUID(),token=randomToken();ids.push(id);
    await sql`INSERT INTO app_users(id,name,email,password_hash,role) VALUES(${id},${name},${'battle-'+id+'@example.test'},${await hashPassword(password)},${role})`;
    await sql`INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(${digest(token)},${id},now()+interval '1 hour')`;
    return {id,cookie:'cardshelf_session='+token,token};
  }
  async function settingsChange(change){
    settings=(await request('/api/admin/battle',{user:admin})).data;
    const r=await request('/api/admin/battle/settings',{user:admin,method:'POST',body:{revision:settings.settings.revision,password,reason:'Synthetic private battle test',...change}});
    assert.equal(r.status,200,JSON.stringify(r.data));settings=r.data;return r;
  }
  const deckBody=()=>({title:'Synthetic deck',game:'pokemon',revision:0,request_id:randomUUID(),cards:[{card_id:cards[0],quantity:4},{card_id:cards[1],quantity:56}]});
  async function current(user=host){const r=await request('/api/battle/matches/'+match.id,{user});assert.equal(r.status,200,JSON.stringify(r.data));return r.data;}
  async function action(user,a){const before=await current(user),body={revision:before.revision,request_id:randomUUID(),action:a};const r=await request('/api/battle/matches/'+match.id+'/actions',{user,method:'POST',body});assert.equal(r.status,200,JSON.stringify(r.data));return r.data;}
  try {
    oldSettings=await sql`SELECT * FROM battle_settings`;await sql`DELETE FROM battle_settings`;
    admin=await account('Battle admin','admin');host=await account('Host account');guest=await account('Guest account');outsider=await account('Unseated administrator','admin');unapproved=await account('Not approved');
    // Legacy manual playback now also requires explicit Collector-tier entitlement.
    // These assignments are test-only; no payment or production setting is created.
    for(const user of [host,guest,outsider])await sql`INSERT INTO account_tier_overrides(user_id,tier,reason) VALUES(${user.id},'collector','Synthetic battle entitlement')`;
    await sql`INSERT INTO card_sets(id,provider_id,game,language,name,card_count) VALUES(${setId},${'battle-'+suffix},'pokemon','en','Synthetic battle set',2)`;
    for(const [i,category] of ['Pokemon','Energy'].entries()){
      const id=setId+'-'+i;cards.push(id);
      await sql`INSERT INTO cards(id,provider_id,set_id,game,language,local_id,name,category,raw_data)
        VALUES(${id},${'battle-'+suffix+'-'+i},${setId},'pokemon','en',${String(i)},${'Synthetic '+category},${category},${sql.json({category,...(i===0?{stage:'Basic',hp:100,attacks:[{name:'Synthetic move',damage:'10',effect:'Manual test only'}]}:{energyType:'Basic'}),pricing:{private_marker:'NOT_A_BATTLE_FIELD'}})})`;
      await sql`INSERT INTO printings(card_id,key,label,source) VALUES(${id},'normal','Normal','tcgdex')`;
    }
    await t.test('battle endpoints are authenticated JSON and disabled by default, even for administrators',async()=>{
      for(const path of ['/api/battle','/api/battle/decks','/api/battle/cards','/api/admin/battle']){const r=await request(path);assert.equal(r.status,401,path);assert.match(r.headers.get('content-type'),/json/);}
      const r=await request('/api/battle',{user:admin});assert.equal(r.status,200);assert.equal(r.data.allowed,false);assert.equal(r.data.enabled,false);
      assert.equal((await request('/api/battle/decks',{user:admin})).status,403);
      assert.equal((await request('/api/admin/battle',{user:host})).status,403);
    });
    await t.test('activation requires role, password, origin and both acknowledgements',async()=>{
      const body={revision:0,password,reason:'Synthetic activation',enabled:true,confirm_assisted:true,confirm_rights:true};
      for(const patch of [{password:'wrong'},{confirm_assisted:false},{confirm_rights:false},{enabled:'true'},{role:'admin'}])assert.ok([400,403].includes((await request('/api/admin/battle/settings',{user:admin,method:'POST',body:{...body,...patch}})).status));
      assert.equal((await request('/api/admin/battle/settings',{user:host,method:'POST',body})).status,403);
      assert.equal((await request('/api/admin/battle/settings',{user:admin,method:'POST',body,headers:{Origin:'https://evil.test'}})).status,403);
      assert.equal((await sql`SELECT * FROM battle_settings`).length,0);
      await settingsChange({enabled:true,confirm_assisted:true,confirm_rights:true});
    });
    await t.test('existing tester grants do not imply battle access; explicit approval changes no membership',async()=>{
      const before=await sql`SELECT * FROM account_access_grants WHERE user_id IN ${sql([host.id,guest.id])} ORDER BY user_id`;
      assert.equal((await request('/api/battle',{user:host})).data.allowed,false);
      await settingsChange({user_id:host.id,approved:true});await settingsChange({user_id:guest.id,approved:true});
      assert.deepEqual(await sql`SELECT * FROM account_access_grants WHERE user_id IN ${sql([host.id,guest.id])} ORDER BY user_id`,before);
      assert.equal((await request('/api/battle',{user:host})).data.allowed,true);assert.equal((await request('/api/battle',{user:unapproved})).data.allowed,false);
    });
    await t.test('legacy approvals do not bypass the new paid-tier requirement',async()=>{
      await settingsChange({user_id:unapproved.id,approved:true});
      const blocked=await request('/api/battle',{user:unapproved});assert.equal(blocked.data.approved,true);assert.equal(blocked.data.entitled,false);assert.equal(blocked.data.allowed,false);
      assert.equal((await request('/api/battle/decks',{user:unapproved})).status,403);
      await settingsChange({user_id:unapproved.id,approved:false});
    });
    await t.test('catalogue lookup returns safe English Pokémon text and own ownership only',async()=>{
      const [p]=await sql`SELECT id FROM printings WHERE card_id=${cards[0]}`;
      await sql`INSERT INTO collection_entries(user_id,printing_id,condition,quantity,notes) VALUES(${host.id},${p.id},'NM',3,'PRIVATE_BATTLE_COLLECTION_NOTE')`;
      const a=await request('/api/battle/cards?q=Synthetic&owned=1',{user:host});assert.equal(a.status,200);assert.ok(a.data.items.some(c=>c.id===cards[0]&&c.owned_quantity===3));assert.ok(a.data.items.every(c=>c.id.startsWith('en:')));
      assert.ok(!JSON.stringify(a.data).includes('PRIVATE_BATTLE_COLLECTION_NOTE'));assert.ok(!JSON.stringify(a.data).includes('NOT_A_BATTLE_FIELD'));
      const b=await request('/api/battle/cards?q=Synthetic&owned=1',{user:guest});assert.equal(b.data.items.some(c=>c.id===cards[0]),false);
    });
    await t.test('saved deck drafts are private, revisioned and create requests are retry safe',async()=>{
      const body=deckBody(),a=await request('/api/battle/decks',{user:host,method:'POST',body});assert.equal(a.status,200,JSON.stringify(a.data));hostDeck=a.data;assert.equal(hostDeck.validation.playable,true);
      const b=await request('/api/battle/decks',{user:host,method:'POST',body});assert.equal(b.data.id,hostDeck.id);
      assert.equal((await request('/api/battle/decks',{user:host,method:'POST',body:{...body,title:'Changed intent'}})).status,409);
      const c=await request('/api/battle/decks',{user:guest,method:'POST',body:deckBody()});assert.equal(c.status,200);guestDeck=c.data;
      assert.equal((await request('/api/battle/decks/'+hostDeck.id,{user:guest})).status,404);
      assert.equal((await request('/api/battle/decks/'+hostDeck.id,{user:outsider})).status,404);
    });
    await t.test('invalid deck fields, foreign games and overfilled decks cannot change saved data',async()=>{
      const body=deckBody();for(const change of [{game:'mtg'},{user_id:guest.id},{cards:[{card_id:cards[0],quantity:61}]},{cards:[{card_id:'ja:demo-1',quantity:4}]}])assert.equal((await request('/api/battle/decks',{user:host,method:'POST',body:{...body,...change}})).status,400);
      assert.equal((await sql`SELECT count(*)::integer AS n FROM battle_decks WHERE user_id=${host.id}`)[0].n,1);
    });
    await t.test('two saves based on one deck revision cannot overwrite each other',async()=>{
      const body={...deckBody(),revision:hostDeck.revision};const results=await Promise.all(['First','Second'].map(title=>request('/api/battle/decks/'+hostDeck.id,{user:host,method:'PUT',body:{...body,title}})));
      assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);hostDeck=(await request('/api/battle/decks/'+hostDeck.id,{user:host})).data;
    });
    await t.test('private lobby creation is idempotent and stores only an invitation hash',async()=>{
      const body={deck_id:hostDeck.id,deck_revision:hostDeck.revision,alias:'Host alias',request_id:randomUUID(),confirm_assisted:true};
      const r=await request('/api/battle/matches',{user:host,method:'POST',body});assert.equal(r.status,200,JSON.stringify(r.data));match=r.data;invitation=r.data.invite_code;assert.match(invitation,/^[a-f0-9]{32}$/);
      const [stored]=await sql`SELECT invite_hash,host_deck FROM battle_matches WHERE id=${match.id}`;assert.notEqual(stored.invite_hash,invitation);assert.equal(stored.invite_hash,digest(invitation));
      const again=await request('/api/battle/matches',{user:host,method:'POST',body});assert.equal(again.data.id,match.id);assert.equal('invite_code' in again.data,false);
      assert.equal((await request('/api/battle/matches',{user:host,method:'POST',body:{...body,alias:'Changed'}})).status,409);
      assert.equal((await request('/api/battle/matches/'+match.id,{user:outsider})).status,404);
    });
    await t.test('unauthorized and cross-origin joins cannot claim a seat',async()=>{
      const body={deck_id:guestDeck.id,deck_revision:guestDeck.revision,alias:'Guest alias',request_id:randomUUID(),invite_code:invitation,confirm_assisted:true};
      assert.equal((await request('/api/battle/join',{user:unapproved,method:'POST',body})).status,403);
      assert.equal((await request('/api/battle/join',{user:guest,method:'POST',body,headers:{Origin:'https://evil.test'}})).status,403);
      assert.equal((await sql`SELECT guest_id FROM battle_matches WHERE id=${match.id}`)[0].guest_id,null);
    });
    await t.test('joining remains pending host approval and never discloses the opponent deck',async()=>{
      const body={deck_id:guestDeck.id,deck_revision:guestDeck.revision,alias:'Guest alias',request_id:randomUUID(),invite_code:invitation,confirm_assisted:true};
      const r=await request('/api/battle/join',{user:guest,method:'POST',body});assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(r.data.status,'approval');assert.equal(r.data.table,null);assert.equal('host_deck' in r.data,false);assert.equal('invite_hash' in r.data,false);
      assert.equal((await request('/api/battle/join',{user:guest,method:'POST',body})).data.id,match.id);
      const b=await current(guest);assert.equal((await request('/api/battle/matches/'+match.id+'/actions',{user:guest,method:'POST',body:{revision:b.revision,request_id:randomUUID(),action:{type:'start'}}})).status,409);
    });
    await t.test('saved-deck changes do not rewrite joined match snapshots',async()=>{
      const [before]=await sql`SELECT host_deck FROM battle_matches WHERE id=${match.id}`;
      const body={...deckBody(),title:'Edited after joining',revision:hostDeck.revision};assert.equal((await request('/api/battle/decks/'+hostDeck.id,{user:host,method:'PUT',body})).status,200);
      assert.deepEqual((await sql`SELECT host_deck FROM battle_matches WHERE id=${match.id}`)[0].host_deck,before.host_deck);
    });
    await t.test('approved players both consent before the host starts a game',async()=>{
      await action(host,{type:'approve'});await action(host,{type:'ready'});await action(guest,{type:'ready'});
      const r=await action(host,{type:'start'});assert.equal(r.status,'active');assert.equal(r.table.phase,'setup');
      for(const s of ['host','guest']){assert.equal(r.table.players[s].hand_count,7);assert.equal(r.table.players[s].deck_count,53);}
      assert.match((await request('/api/battle/matches/'+match.id,{user:host})).headers.get('cache-control'),/no-store/);
    });
    await t.test('a third administrator cannot read hidden state or mutate the match',async()=>{
      assert.equal((await request('/api/battle/matches/'+match.id,{user:outsider})).status,404);
      assert.equal((await request('/api/battle/matches/'+match.id+'/actions',{user:outsider,method:'POST',body:{revision:1,request_id:randomUUID(),action:{type:'concede'}}})).status,404);
    });
    await t.test('opening setup, mulligans and six hidden prizes complete through HTTP',async()=>{
      let r=await current();await action(r.table.coin_winner==='host'?host:guest,{type:'choose_first',first:'host'});
      for(const [who,user] of [['host',host],['guest',guest]]){
        r=await current(user);let tries=0;
        while(!r.table.players[who].hand.some(c=>c.card.stage==='Basic')){assert.ok(++tries<100,'A Basic must eventually appear in this synthetic deck.');r=await action(user,{type:'mulligan'});}
        await action(user,{type:'move',token:r.table.players[who].hand.find(c=>c.card.stage==='Basic').token,to:'active'});
        await action(user,{type:'setup_ready'});
      }
      r=await current();assert.equal(r.table.phase,'playing');assert.equal(r.table.players.host.prize_count,6);assert.equal(r.table.players.guest.prize_count,6);
    });
    await t.test('response projection excludes all opponent hand/deck/prize tokens and raw state',async()=>{
      const [stored]=await sql`SELECT state FROM battle_matches WHERE id=${match.id}`;
      for(const [reader,hidden] of [[host,'guest'],[guest,'host']]){const r=await current(reader),json=JSON.stringify(r);assert.equal('state' in r,false);assert.equal('host_id' in r,false);assert.equal('guest_id' in r,false);assert.equal('host_deck' in r,false);
        for(const zone of ['hand','deck','prizes'])for(const c of stored.state.players[hidden][zone])assert.ok(!json.includes(c.token));
      }
    });
    await t.test('replayed draws apply once and concurrent stale actions produce an explicit conflict',async()=>{
      const before=await current(),body={revision:before.revision,request_id:randomUUID(),action:{type:'draw',count:1}};
      const path='/api/battle/matches/'+match.id+'/actions';const first=await request(path,{user:host,method:'POST',body});assert.equal(first.status,200);const again=await request(path,{user:host,method:'POST',body});assert.equal(again.status,200);assert.equal(again.data.revision,first.data.revision);assert.equal(again.data.table.players.host.hand_count,before.table.players.host.hand_count+1);
      assert.equal((await request(path,{user:host,method:'POST',body:{...body,action:{type:'draw',count:2}}})).status,409);
      const latest=await current();const results=await Promise.all([host,guest].map(user=>request(path,{user,method:'POST',body:{revision:latest.revision,request_id:randomUUID(),action:{type:'coin'}}})));assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
    });
    await t.test('forged random results and arbitrary state cannot enter the persisted game',async()=>{
      const before=await current(),r=await request('/api/battle/matches/'+match.id+'/actions',{user:host,method:'POST',body:{revision:before.revision,request_id:randomUUID(),action:{type:'coin',result:'heads'}}});assert.equal(r.status,400);assert.equal((await current()).revision,before.revision);
    });
    await t.test('session revocation blocks the next poll without deleting match state',async()=>{
      await sql`DELETE FROM sessions WHERE token_hash=${digest(guest.token)}`;
      assert.equal((await request('/api/battle/matches/'+match.id,{user:guest})).status,401);
      await sql`INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(${digest(guest.token)},${guest.id},now()+interval '1 hour')`;
      assert.equal((await current(guest)).status,'active');
    });
    await t.test('access revocation freezes normal play but permits the approved opponent to concede',async()=>{
      await settingsChange({user_id:guest.id,approved:false});assert.equal((await request('/api/battle/matches/'+match.id,{user:guest})).status,403);
      const before=await current(),r=await request('/api/battle/matches/'+match.id+'/actions',{user:host,method:'POST',body:{revision:before.revision,request_id:randomUUID(),action:{type:'coin'}}});assert.equal(r.status,403);
      const ended=await action(host,{type:'concede'});assert.equal(ended.status,'finished');assert.equal(ended.table.result,'guest');assert.deepEqual(ended.table.players.guest.hand,[]);
      await settingsChange({user_id:guest.id,approved:true});
    });
    await t.test('global pause retains decks and match results and blocks reads until enabled again',async()=>{
      const [before]=await sql`SELECT state FROM battle_matches WHERE id=${match.id}`;await settingsChange({enabled:false});
      assert.equal((await request('/api/battle/matches/'+match.id,{user:host})).status,403);assert.equal((await request('/api/battle/decks',{user:host})).status,403);
      await settingsChange({enabled:true,confirm_assisted:true,confirm_rights:true});assert.deepEqual((await sql`SELECT state FROM battle_matches WHERE id=${match.id}`)[0].state,before.state);assert.equal((await current()).status,'finished');
    });
    await t.test('deleting a saved deck preserves match snapshots, original quantities and wishlist state',async()=>{
      hostDeck=(await request('/api/battle/decks/'+hostDeck.id,{user:host})).data;
      assert.equal((await request('/api/battle/decks/'+hostDeck.id,{user:host,method:'DELETE',body:{revision:hostDeck.revision,confirm_title:hostDeck.title}})).status,200);
      assert.equal((await current()).status,'finished');const [entry]=await sql`SELECT e.quantity,e.notes FROM collection_entries e JOIN printings p ON p.id=e.printing_id WHERE e.user_id=${host.id} AND p.card_id=${cards[0]}`;assert.equal(entry.quantity,3);assert.equal(entry.notes,'PRIVATE_BATTLE_COLLECTION_NOTE');
      assert.equal((await sql`SELECT count(*)::integer AS n FROM stripe_subscriptions WHERE user_id IN ${sql(ids)}`)[0].n,0);
    });
    await t.test('battle documents are non-indexable and do not include hidden state or AdSense loader',async()=>{
      for(const path of ['/battle','/battle/decks/new','/battle/matches/'+match.id]){const r=await request(path,{user:host});assert.equal(r.status,200);assert.match(r.headers.get('x-robots-tag'),/noindex/);assert.ok(!String(r.data).includes('adsbygoogle.js'));assert.ok(!String(r.data).includes('NOT_A_BATTLE_FIELD'));}
    });
  } finally {
    await sql`DELETE FROM battle_settings`;if(oldSettings.length)await sql`INSERT INTO battle_settings ${sql(oldSettings)}`;
    if(ids.length)await sql`DELETE FROM app_users WHERE id IN ${sql(ids)}`;
    if(cards.length){await sql`DELETE FROM printings WHERE card_id IN ${sql(cards)}`;await sql`DELETE FROM cards WHERE id IN ${sql(cards)}`;}
    await sql`DELETE FROM card_sets WHERE id=${setId}`;await sql.end();
  }
});
