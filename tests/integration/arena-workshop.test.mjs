import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { hashPassword, randomToken, digest } from '../../lib/security.mjs';
const base=process.env.TEST_BASE_URL, dbUrl=process.env.DATABASE_URL;
if(process.env.ALLOW_TEST_DATABASE!=='yes'||!base||!new URL(dbUrl||'http://invalid').pathname.endsWith('_test'))throw Error('Use the disposable _test database only.');
const sql=postgres(dbUrl,{max:4}),suffix=randomUUID().replaceAll('-',''),set='en:workshop-'+suffix,ids=[];
const basic=set+'-basic',energy=set+'-energy',variant=set+'-variant',bad=set+'-bad';
async function request(path,{user,method='GET',body}={}) {
 const r=await fetch(base+path,{method,headers:{Origin:process.env.APP_ORIGIN||base,'X-Requested-With':'cardshelf',...(user?{Cookie:'cardshelf_session='+user.token}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};
}
await test('Arena workshop catalogue, import review and duplicate drafts',async t=>{
 const old=await sql`SELECT * FROM arena_settings`;let owner,other,free,deck;
 async function account(tier){const id=randomUUID(),token=randomToken();ids.push(id);await sql`INSERT INTO app_users(id,name,email,password_hash) VALUES(${id},'Workshop tester',${id+'@example.test'},${await hashPassword('Disposable workshop password 123')})`;await sql`INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(${digest(token)},${id},now()+interval '1 hour')`;if(tier)await sql`INSERT INTO account_tier_overrides(user_id,tier,reason) VALUES(${id},${tier},'Workshop fixture')`;return {id,token};}
 const pokemon={category:'Pokemon',stage:'Basic',hp:100,types:['Fire'],retreat:1,attacks:[{name:'Tackle',damage:30,cost:['Colorless']}]},basicEnergy={category:'Energy',energyType:'Basic',effect:'Basic Energy'},unsupported={...pokemon,abilities:[{type:'Ability',name:'Unavailable',effect:'Unknown future effect.'}]};
 async function card(id,name,raw){await sql`INSERT INTO cards(id,provider_id,set_id,game,language,local_id,name,category,raw_data) VALUES(${id},${id.slice(3)},${set},'pokemon','en',${id.split('-').at(-1)},${name},${raw.category},${sql.json(raw)})`;}
 const exported=(cards=[{card_id:basic,quantity:4},{card_id:energy,quantity:56}])=>JSON.stringify({format:'cardshelf-arena-deck',version:1,game:'pokemon',title:'Imported contender',cards});
 const preview=(text,selections,user=owner)=>request('/api/arena/decks/preview-import',{user,method:'POST',body:{text,...(selections?{selections}:{})}});
 const catalogue=query=>request('/api/arena/catalogue?set='+encodeURIComponent(set)+'&'+query,{user:owner});
 try{
  await sql`DELETE FROM arena_settings`;await sql`INSERT INTO arena_settings(enabled) VALUES(true)`;
  owner=await account('collector');other=await account('plus');free=await account(null);
  await sql`INSERT INTO card_sets(id,provider_id,game,language,name,card_count) VALUES(${set},${set.slice(3)},'pokemon','en','Workshop fixture',140)`;
  await card(basic,'Workshop Basic '+suffix,pokemon);await card(energy,'Fire Energy',basicEnergy);await card(variant,'Workshop Basic '+suffix,pokemon);await card(bad,'AA unsupported '+suffix,unsupported);
  for(let i=0;i<61;i++)await card(set+'-bad'+i,'AA unsupported '+String(i).padStart(3,'0'),unsupported);
  for(let i=0;i<61;i++)await card(set+'-ok'+i,'ZZ supported '+String(i).padStart(3,'0'),pokemon);
  const [printing]=await sql`INSERT INTO printings(card_id,key,label,source) VALUES(${basic},'normal','Normal','tcgdex') RETURNING id`;
  await sql`INSERT INTO collection_entries(user_id,printing_id,condition,quantity,wishlist,notes) VALUES(${owner.id},${printing.id},'NM',2,true,'Private workshop note')`;
  await t.test('new endpoints require authentication and Arena entitlement',async()=>{
   assert.equal((await request('/api/arena/catalogue/filters')).status,401);
   assert.equal((await request('/api/arena/catalogue/filters',{user:free})).status,403);
   assert.equal((await preview(exported(),undefined,free)).status,403);
  });
  await t.test('supported filtering happens before pagination across the full catalogue',async()=>{
   const first=await catalogue('supported=1');assert.equal(first.status,200,JSON.stringify(first.data));assert.equal(first.data.items.length,60);assert.equal(first.data.has_more,true);assert.ok(first.data.items.every(c=>c.supported));
   const second=await catalogue('supported=1&page=2');assert.equal(second.data.items.length,4);assert.equal(second.data.has_more,false);
   const joined=[...first.data.items,...second.data.items];assert.equal(new Set(joined.map(r=>r.card.id)).size,64);assert.ok(joined.some(r=>r.card.id===basic));
   const unfiltered=await catalogue('supported=0');assert.ok(unfiltered.data.items.every(r=>!r.supported));
  });
  await t.test('kind, type, stage, set and owned filters combine without leaking collection details',async()=>{
   const r=await catalogue('supported=1&kind=pokemon&type=Fire&stage=Basic&owned=1');assert.equal(r.data.items.length,1);assert.equal(r.data.items[0].card.id,basic);assert.equal(r.data.items[0].owned_quantity,2);assert.ok(!JSON.stringify(r.data).includes('Private workshop note'));assert.ok(!JSON.stringify(r.data).includes('raw_data'));
   const e=await catalogue('supported=1&kind=energy&type=Fire');assert.equal(e.data.items.length,1);assert.equal(e.data.items[0].card.id,energy);
   assert.equal((await catalogue('type=Injected')).status,400);assert.equal((await catalogue('page=-1')).status,400);
   const filters=await request('/api/arena/catalogue/filters',{user:owner});assert.ok(filters.data.sets.some(s=>s.id===set));assert.ok(filters.data.types.includes('Fire'));
  });
  await t.test('review imports resolve authoritative catalogue cards without saving',async()=>{
   const before=await sql`SELECT count(*) AS n FROM arena_decks WHERE user_id=${owner.id}`;
   const r=await preview(exported());assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(r.data.complete,true);assert.equal(r.data.validation.playable,true);assert.equal(r.data.cards.length,2);assert.equal(r.data.cards[0].card.name,'Workshop Basic '+suffix);
   assert.deepEqual(await sql`SELECT count(*) AS n FROM arena_decks WHERE user_id=${owner.id}`,before);
   const repeated=await preview('2 '+basic+'\n2 '+basic);assert.equal(repeated.data.cards.length,1);assert.equal(repeated.data.cards[0].quantity,4);
  });
  await t.test('ambiguous names require a matching printing and never select silently',async()=>{
   const text='4 Workshop Basic '+suffix;const r=await preview(text);assert.equal(r.data.complete,false);assert.equal(r.data.rows[0].status,'ambiguous');assert.equal(r.data.rows[0].candidates.length,2);assert.deepEqual(r.data.cards,[]);
   const chosen=await preview(text,[{line:1,card_id:variant}]);assert.equal(chosen.data.complete,true);assert.equal(chosen.data.cards[0].card.id,variant);
   const unrelated=await preview(text,[{line:1,card_id:energy}]);assert.equal(unrelated.data.complete,false);assert.equal(unrelated.data.rows[0].status,'missing');
  });
  await t.test('missing and unsupported entries remain visible and block apply',async()=>{
   const r=await preview('1 '+bad+'\n1 en:missing-card');assert.equal(r.data.complete,false);assert.deepEqual(r.data.rows.map(r=>r.status),['unsupported','missing']);assert.deepEqual(r.data.cards,[]);
   assert.equal((await preview('61 '+energy)).status,400);assert.equal((await preview(exported([{card_id:'ja:demo-1',quantity:1}]))).status,400);
  });
  await t.test('copied decks use normal private reads and idempotent creates',async()=>{
   const body={title:'Original',revision:0,request_id:randomUUID(),cards:[{card_id:basic,quantity:4},{card_id:energy,quantity:56}]};
   const saved=await request('/api/arena/decks',{user:owner,method:'POST',body});assert.equal(saved.status,200,JSON.stringify(saved.data));deck=saved.data;
   assert.equal((await request('/api/arena/decks/'+deck.id,{user:other})).status,404);
   const copy={...body,title:'Original (copy)',request_id:randomUUID()};const created=await request('/api/arena/decks',{user:owner,method:'POST',body:copy});assert.equal(created.status,200);assert.notEqual(created.data.id,deck.id);assert.equal(created.data.revision,1);
   assert.equal((await request('/api/arena/decks',{user:owner,method:'POST',body:copy})).data.id,created.data.id);
   const original=await request('/api/arena/decks/'+deck.id,{user:owner});assert.equal(original.data.title,'Original');assert.equal(original.data.revision,1);
   const list=await request('/api/arena/decks',{user:owner});const item=list.data.decks.find(d=>d.id===deck.id);assert.equal(item.validation.playable,true);assert.equal(item.preview[0].kind,'pokemon');assert.equal(item.groups.find(g=>g.kind==='energy').count,56);
  });
  await t.test('changed catalogue support is reflected immediately and unavailable saved cards can be reviewed safely',async()=>{
   await sql`UPDATE cards SET raw_data=${sql.json(unsupported)} WHERE id=${basic}`;
   const found=await catalogue('supported=1&owned=1');assert.equal(found.data.items.length,0);
   const view=await request('/api/arena/decks/'+deck.id,{user:owner});assert.equal(view.status,200);assert.equal(view.data.validation.playable,false);assert.equal(view.data.cards[0].supported,false);assert.match(view.data.cards[0].reason,/Ability/);
   const start=await request('/api/arena/matches',{user:owner,method:'POST',body:{mode:'pvp',alias:'Tester',deck_id:deck.id,deck_revision:deck.revision,request_id:randomUUID()}});assert.equal(start.status,422);
   const entry=(await sql`SELECT quantity,notes FROM collection_entries WHERE user_id=${owner.id}`)[0];assert.equal(entry.quantity,2);assert.equal(entry.notes,'Private workshop note');
  });
 }finally{if(ids.length)await sql`DELETE FROM app_users WHERE id IN ${sql(ids)}`;await sql`DELETE FROM printings WHERE card_id IN (SELECT id FROM cards WHERE set_id=${set})`;await sql`DELETE FROM cards WHERE set_id=${set}`;await sql`DELETE FROM card_sets WHERE id=${set}`;await sql`DELETE FROM arena_settings`;if(old.length)await sql`INSERT INTO arena_settings ${sql(old)}`;await sql.end();}
});
