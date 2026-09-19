// HTTP + PostgreSQL regression tests. Run only against the disposable CI database.
// Uses synthetic local catalogue rows; never calls a card or payment provider.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { hashPassword, randomToken, digest } from '../../lib/security.mjs';
import { wishlistRevisions } from '../../shared/wishlist.mjs';
const base=process.env.TEST_BASE_URL, database=process.env.DATABASE_URL;
if(process.env.ALLOW_TEST_DATABASE!=='yes'||!base||!new URL(database||'http://invalid').pathname.endsWith('_test'))throw new Error('Use a disposable _test database only.');
const sql=postgres(database,{max:4}),origin=process.env.APP_ORIGIN||base;
await test('selected-printing wishlist shortcut preserves ownership, conditions and access',async t=>{
  const suffix=randomUUID().replaceAll('-',''),users=Array.from({length:5},()=>randomUUID()),tokens=users.map(()=>randomToken());
  const [owner,other,collector,plus,free]=users,sets=[],cards=[],printings=[];
  const oldControls=await sql`SELECT * FROM stripe_billing_controls`;
  let normal,holo,mtg,ygo,binder;
  async function request(path,{method='GET',body,user=0,headers={}}={}){
    const r=await fetch(base+path,{method,redirect:'manual',headers:{Origin:origin,'X-Requested-With':'cardshelf',
      ...(user===null?{}:{Cookie:'cardshelf_session='+tokens[user]}),...(body===undefined?{}:{'Content-Type':'application/json'}),...headers},
      body:body===undefined?undefined:JSON.stringify(body)});
    assert.match(r.headers.get('content-type')||'',/application\/json/,path+' must remain a JSON endpoint');
    return {status:r.status,data:await r.json(),headers:r.headers};
  }
  const entries=(printing,userId=owner)=>sql`SELECT printing_id,condition,quantity,wishlist,notes,revision
    FROM collection_entries WHERE user_id=${userId} AND printing_id=${printing} ORDER BY condition`;
  async function wish(printing,wishlist,user=0,overrides={}){
    const rows=await entries(printing,users[user]);
    return request('/api/collection/wishlist',{method:'POST',user,body:{printing_id:printing,wishlist,revisions:wishlistRevisions(rows,printing),...overrides}});
  }
  try{
    const hash=await hashPassword('Wishlist fixture password 123');
    for(const [i,id] of users.entries()){
      await sql`INSERT INTO app_users(id,email,name,password_hash) VALUES(${id},${'wishlist-'+suffix+'-'+i+'@example.test'},'Wishlist fixture',${hash})`;
      await sql`INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(${digest(tokens[i])},${id},now()+interval '1 hour')`;
    }
    for(const game of ['pokemon','mtg','yugioh']){
      const prefix=game==='pokemon'?'en:':game+':en:',setId=prefix+'wish-'+suffix,cardId=setId+'-1';sets.push(setId);cards.push(cardId);
      await sql`INSERT INTO card_sets(id,provider_id,language,game,name) VALUES(${setId},${'wish-'+suffix},'en',${game},'Wishlist fixture set')`;
      await sql`INSERT INTO cards(id,provider_id,set_id,language,game,local_id,name) VALUES(${cardId},${'wish-'+suffix+'-1'},${setId},'en',${game},'1','Wishlist fixture card')`;
      const source={pokemon:'tcgdex',mtg:'mtgjson',yugioh:'ygoprodeck'}[game];
      const [p]=await sql`INSERT INTO printings(card_id,key,label,source) VALUES(${cardId},'normal','Normal',${source}) RETURNING id`;printings.push(p.id);
      if(game==='pokemon'){
        normal=p.id;const [q]=await sql`INSERT INTO printings(card_id,key,label,source) VALUES(${cardId},'holo','Holo','tcgdex') RETURNING id`;holo=q.id;printings.push(q.id);
      }else if(game==='mtg')mtg=p.id;else ygo=p.id;
    }
    [binder]=await sql`INSERT INTO binders(user_id,title,columns,rows,page_count,binder_type,share_token)
      VALUES(${owner},'Wishlist untouched tracker',2,2,1,'tracking',${randomToken()}) RETURNING *`;
    await sql`INSERT INTO binder_slots(binder_id,position,printing_id,is_collected) VALUES(${binder.id},0,${holo},false)`;
    await sql`INSERT INTO collection_entries(user_id,printing_id,condition,quantity,wishlist,notes)
      VALUES(${owner},${normal},'NM',3,false,'Normal copies stay owned')`;
    await t.test('route requires authentication, same origin and bounded JSON',async()=>{
      const body={printing_id:holo,wishlist:true,revisions:[]};
      assert.equal((await request('/api/collection/wishlist',{method:'POST',user:null,body})).status,401);
      assert.equal((await request('/api/collection/wishlist',{method:'POST',body,headers:{Origin:'https://evil.test'}})).status,403);
      assert.equal((await request('/api/collection/wishlist',{method:'POST',body,headers:{'Content-Type':'text/plain'}})).status,415);
      assert.equal((await request('/api/collection/wishlist',{method:'POST',body:{...body,padding:'x'.repeat(17000)}})).status,413);
      assert.equal((await entries(holo)).length,0);
    });
    await t.test('adding the selected Holo creates a zero-copy Not assessed wish only',async()=>{
      const r=await wish(holo,true);assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(r.data.printing_id,holo);assert.equal(r.data.wishlist,true);
      assert.deepEqual(r.data.entries,[{printing_id:holo,condition:'UNKNOWN',quantity:0,wishlist:true,notes:'',revision:1}]);
      assert.match(r.headers.get('cache-control'),/no-store/);
      const [n]=await entries(normal);assert.equal(n.quantity,3);assert.equal(n.wishlist,false);assert.equal(n.notes,'Normal copies stay owned');
      const [slot]=await sql`SELECT * FROM binder_slots WHERE binder_id=${binder.id}`;assert.equal(slot.is_collected,false);
      assert.deepEqual((await sql`SELECT * FROM binders WHERE id=${binder.id}`)[0],binder);
    });
    await t.test('reloading and the existing catalogue Wishlist filter see the saved wish',async()=>{
      const r=await request('/api/cards/'+encodeURIComponent(cards[0]));assert.equal(r.status,200);assert.ok(r.data.entries.some(e=>e.printing_id===holo&&e.wishlist));
      const list=await request('/api/catalogue?game=pokemon&ownership=wishlist&set='+encodeURIComponent(sets[0]));
      assert.equal(list.status,200);assert.equal(list.data.total,1);assert.equal(list.data.items[0].id,cards[0]);assert.equal(list.data.items[0].quantity,3);
    });
    await t.test('repeating the current desired state is a no-op, not another entry or revision',async()=>{
      const before=await entries(holo);assert.equal((await wish(holo,true)).status,200);assert.deepEqual(await entries(holo),before);
    });
    await t.test('adding a wish to an owned Unknown row preserves its quantity and notes',async()=>{
      assert.equal((await wish(holo,false)).status,200);
      await sql`UPDATE collection_entries SET quantity=2,notes='Owned Unknown copies',revision=revision+1 WHERE user_id=${owner} AND printing_id=${holo}`;
      const before=await entries(holo);assert.equal((await wish(holo,true)).status,200);const after=await entries(holo);
      assert.equal(after[0].quantity,before[0].quantity);assert.equal(after[0].notes,before[0].notes);assert.equal(after[0].revision,before[0].revision+1);
    });
    await t.test('removal clears all selected-printing condition wishes atomically without deleting rows',async()=>{
      await sql`INSERT INTO collection_entries(user_id,printing_id,condition,quantity,wishlist,notes) VALUES
        (${owner},${holo},'NM',5,true,'Near mint notes'),(${owner},${holo},'LP',1,true,'Played notes'),(${owner},${holo},'HP',0,false,'Keep reminder')`;
      const before=await entries(holo),r=await wish(holo,false);assert.equal(r.status,200);assert.equal(r.data.wishlist,false);
      const after=await entries(holo);assert.equal(after.length,before.length);
      for(const e of before){const saved=after.find(n=>n.condition===e.condition);assert.equal(saved.quantity,e.quantity);assert.equal(saved.notes,e.notes);assert.equal(saved.wishlist,false);assert.equal(saved.revision,e.revision+(e.wishlist?1:0));}
      assert.equal((await entries(normal))[0].revision,1);
    });
    await t.test('stale ownership revisions reject a shortcut before it changes any wish',async()=>{
      const old=await entries(holo);
      await sql`UPDATE collection_entries SET quantity=9,revision=revision+1 WHERE user_id=${owner} AND printing_id=${holo} AND condition='NM'`;
      const before=await entries(holo),r=await wish(holo,true,0,{revisions:wishlistRevisions(old,holo)});
      assert.equal(r.status,409);assert.deepEqual(await entries(holo),before);
    });
    await t.test('concurrent clicks cannot overwrite each other or duplicate ownership',async()=>{
      const before=await entries(holo),body={printing_id:holo,wishlist:true,revisions:wishlistRevisions(before,holo)};
      const results=await Promise.all([request('/api/collection/wishlist',{method:'POST',body}),request('/api/collection/wishlist',{method:'POST',body})]);
      assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
      const after=await entries(holo);assert.equal(after.length,before.length);
      assert.equal(after.reduce((n,e)=>n+e.quantity,0),before.reduce((n,e)=>n+e.quantity,0));
    });
    await t.test('users can only change their own wishlist and cannot inject ownership or another account',async()=>{
      const before=await entries(holo);
      for(const extra of [{user_id:other},{quantity:99},{notes:'overwrite'},{condition:'NM'},{role:'admin'}])assert.equal((await wish(holo,false,0,extra)).status,400);
      assert.deepEqual(await entries(holo),before);
      const r=await wish(holo,true,1);assert.equal(r.status,200);assert.equal(r.data.entries[0].quantity,0);assert.equal(r.data.entries[0].notes,'');
      assert.deepEqual(await entries(holo),before);assert.equal((await wish(randomUUID(),true)).status,404);
    });
    await t.test('the same shortcut supports imported Magic and Yu-Gi-Oh printings',async()=>{
      for(const p of [mtg,ygo]){const r=await wish(p,true);assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(r.data.wishlist,true);assert.equal(r.data.entries[0].quantity,0);}
    });
    await t.test('existing collection permissions still apply to Collector, Pro, Free and testers',async()=>{
      await sql`DELETE FROM account_access_grants WHERE user_id IN (${collector},${plus},${free})`;
      await sql`INSERT INTO account_tier_overrides(user_id,tier,reason) VALUES(${collector},'collector','Wishlist fixture'),(${plus},'plus','Wishlist fixture')`;
      await sql`INSERT INTO free_accounts(user_id) VALUES(${free})`;
      await sql`UPDATE account_memberships SET plan_code='free' WHERE user_id=${free}`;
      await sql`DELETE FROM stripe_billing_controls`;
      await sql`INSERT INTO stripe_billing_controls(environment,subscriptions_enabled,enforcement_enabled) VALUES('production',false,true)`;
      assert.equal((await wish(normal,true,2)).status,403);assert.equal((await wish(normal,true,4)).status,403);
      assert.equal((await wish(normal,true,3)).status,200);assert.equal((await wish(normal,true,0)).status,200);
      assert.equal((await sql`SELECT kind FROM account_access_grants WHERE user_id=${owner}`)[0].kind,'beta_tester');
      assert.equal((await sql`SELECT count(*)::integer AS n FROM stripe_subscriptions WHERE user_id IN ${sql(users)}`)[0].n,0);
    });
  }finally{
    await sql`DELETE FROM stripe_billing_controls`;
    if(oldControls.length)await sql`INSERT INTO stripe_billing_controls ${sql(oldControls)}`;
    await sql`DELETE FROM app_users WHERE id IN ${sql(users)}`;
    if(printings.length)await sql`DELETE FROM printings WHERE id IN ${sql(printings)}`;
    if(cards.length)await sql`DELETE FROM cards WHERE id IN ${sql(cards)}`;
    if(sets.length)await sql`DELETE FROM card_sets WHERE id IN ${sql(sets)}`;
    await sql.end();
  }
});
