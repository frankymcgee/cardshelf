// Run after api.test.mjs against the disposable CI database only.
// No external catalogue, advertising or billing service is contacted.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import postgres from 'postgres';
import {hashPassword,randomToken,digest} from '../../lib/security.mjs';
import {closeDatabase} from '../../lib/db.mjs';
import {storeGameCard} from '../../lib/game-catalogue.mjs';
const base=process.env.TEST_BASE_URL,dbUrl=process.env.DATABASE_URL;
if(process.env.ALLOW_TEST_DATABASE!=='yes'||!base||!new URL(dbUrl||'http://invalid').pathname.endsWith('_test'))throw new Error('Use a disposable _test database only.');
const sql=postgres(dbUrl,{max:4}),origin=process.env.APP_ORIGIN||base;
async function request(path,{cookie,method='GET',body,headers={}}={}){
  const response=await fetch(base+path,{method,redirect:'manual',headers:{Origin:origin,'X-Requested-With':'cardshelf',...(cookie?{Cookie:cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json'}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
  const type=response.headers.get('content-type')||'';
  let data;if(type.startsWith('image/'))data=Buffer.from(await response.arrayBuffer());else{const text=await response.text();try{data=JSON.parse(text);}catch{data=text;}}
  return {status:response.status,data,headers:response.headers,cookie:response.headers.get('set-cookie')?.split(';')[0]};
}
await test('multi-game access, public reference data and Free-only sponsorship',async t=>{
  const suffix=randomUUID().replaceAll('-',''),ids=[],setIds=[],cardIds=[];
  const password='Synthetic integration password 123';let admin,collector,pro,tester,freeUser,freeCookie,settings,oldSettings=[];
  let pokemonPrinting,mtgPrinting,ygoPrinting,binder,choice;
  async function user(kind){
    const id=randomUUID(),email=kind+'-'+suffix+'@example.test',token=randomToken();ids.push(id);
    await sql`INSERT INTO app_users(id,name,email,password_hash,role) VALUES(${id},${kind},${email},${await hashPassword(password)},${kind==='admin'?'admin':'user'})`;
    await sql`INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(${digest(token)},${id},now()+interval '1 hour')`;
    if(['collector','pro'].includes(kind)){
      await sql`DELETE FROM account_access_grants WHERE user_id=${id}`;
      await sql`INSERT INTO account_tier_overrides(user_id,tier,reason) VALUES(${id},${kind==='pro'?'plus':'collector'},'Synthetic test assignment')`;
    }
    return {id,email,cookie:'cardshelf_session='+token};
  }
  const sponsorFixture=Object.freeze({sponsor_name:'Synthetic Sponsor',sponsor_text:'An explicitly labelled advertisement.',
    sponsor_url:'https://example.com/sponsor',sponsor_cta:'Read more',sponsor_image_alt:'Synthetic banner',confirm_sponsor:true});
  function settingsBody(changes={}){
    // Preserve the saved blank/disabled defaults. Tests that enable ads must
    // explicitly supply a complete reviewed creative AFTER the saved settings.
    const body={registration_enabled:false,ads_enabled:false,...settings,...changes,password,
      revision:settings?.revision??0,reason:'Integration test setting'};
    delete body.has_image;delete body.updated_at;
    return body;
  }
  async function saveSettings(changes={}){
    const result=await request('/api/admin/free-platform/settings',{method:'POST',cookie:admin.cookie,body:settingsBody(changes)});
    assert.equal(result.status,200,JSON.stringify(result.data));settings=result.data;return result;
  }
  try{
    oldSettings=await sql`SELECT * FROM free_platform_settings`;await sql`DELETE FROM free_platform_settings`;
    admin=await user('admin');collector=await user('collector');pro=await user('pro');tester=await user('tester');
    for(const [game,source,key] of [['pokemon','tcgdex','normal'],['mtg','mtgjson','normal'],['yugioh','ygoprodeck','rarity-demo']]){
      const setId=(game==='pokemon'?'en:':game+':en:')+'multi-'+suffix,cardId=setId+'-1';setIds.push(setId);cardIds.push(cardId);
      await sql`INSERT INTO card_sets(id,provider_id,game,language,name,card_count) VALUES(${setId},${game+'-'+suffix},${game},'en',${'Synthetic '+game+' set'},1)`;
      await sql`INSERT INTO cards(id,provider_id,set_id,game,language,local_id,name,raw_data) VALUES(${cardId},${game+'-'+suffix+'-1'},${setId},${game},'en','1',${'Synthetic '+game+' card'},${sql.json({public_text:'Public rules text',private_field:'DO_NOT_EXPOSE'})})`;
      const [p]=await sql`INSERT INTO printings(card_id,key,label,source) VALUES(${cardId},${key},'Synthetic printing',${source}) RETURNING id`;
      if(game==='pokemon')pokemonPrinting=p.id;if(game==='mtg')mtgPrinting=p.id;if(game==='yugioh')ygoPrinting=p.id;
    }
    await t.test('migration defaults preserve existing Pokémon records and protected tester grants',async()=>{
      const [old]=await sql`SELECT game FROM cards WHERE id='en:demo-1'`;assert.equal(old.game,'pokemon');
      assert.equal((await sql`SELECT kind FROM account_access_grants WHERE user_id=${tester.id}`)[0].kind,'beta_tester');
      const plans=await sql`SELECT code,state,monthly_price_minor FROM membership_plans WHERE code='free'`;assert.equal(plans[0].state,'free');assert.equal(plans[0].monthly_price_minor,0);
    });
    await t.test('new administrative and account routes are protected JSON, not HTML fallbacks',async()=>{
      for(const path of ['/api/admin/free-platform','/api/account/games','/api/admin/game-catalogue/sets?game=mtg']){
        const result=await request(path);assert.equal(result.status,401,path);assert.match(result.headers.get('content-type'),/json/);
      }
      assert.equal((await request('/api/admin/free-platform',{cookie:tester.cookie})).status,403);
      assert.equal((await request('/api/admin/free-platform/image',{cookie:tester.cookie})).status,403);
    });
    await t.test('public lookup covers every game with no identity or collection disclosure',async()=>{
      await sql`INSERT INTO collection_entries(user_id,printing_id,condition,quantity,notes) VALUES(${pro.id},${mtgPrinting},'NM',2,${'PRIVATE_NOTE_'+suffix})`;
      for(const [i,game] of ['pokemon','mtg','yugioh'].entries()){
        const r=await request('/api/public/catalogue?game='+game+'&q=Synthetic');assert.equal(r.status,200);assert.ok(r.data.items.every(c=>c.game===game));assert.ok(r.data.items.some(c=>c.id===cardIds[i]));
        const card=await request('/api/public/catalogue/cards/'+encodeURIComponent(cardIds[i]),{cookie:pro.cookie});assert.equal(card.status,200);
        for(const key of ['entries','user_id','quantity','notes','raw_data','share_token'])assert.equal(key in card.data,false,key);
        assert.ok(!JSON.stringify(card.data).includes('DO_NOT_EXPOSE'));assert.equal(card.data.rules_text,'Public rules text');
      }
    });
    await t.test('free public price reads remain available without the pricing entitlement',async()=>{
      const [c]=await sql`SELECT * FROM cards WHERE id=${cardIds[2]}`;
      await storeGameCard({...c,printings:[{key:'rarity-demo',label:'Synthetic printing',source:'ygoprodeck',metadata:{}}],pricing:{quotes:[],references:[{source:'Cardmarket',provider:'ygoprodeck',variant:'all-printings',currency:'EUR',metric:'lowestAcrossPrintings',amount:3,source_updated_at:null,approximate:true}]}});
      const r=await request('/api/public/catalogue/cards/'+encodeURIComponent(c.id)+'/prices');assert.equal(r.status,200);assert.equal(r.data.references[0].amount,3);assert.equal(r.data.printings[0].estimate.approximate,true);
    });
    await t.test('registration and sponsorship start disabled',async()=>{
      assert.deepEqual((await request('/api/public/free-registration')).data,{enabled:false});
      assert.equal((await request('/api/public/register',{method:'POST',body:{name:'User',email:'closed-'+suffix+'@example.test',password,consent:true}})).status,403);
      settings=(await request('/api/admin/free-platform',{cookie:admin.cookie})).data;assert.equal(settings.ads_enabled,false);assert.equal(settings.registration_enabled,false);
    });
    await t.test('only an authenticated password-confirmed administrator can change Free configuration',async()=>{
      assert.equal((await request('/api/admin/free-platform/settings',{method:'POST',cookie:tester.cookie,body:{}})).status,403);
      assert.equal((await request('/api/admin/free-platform/settings',{method:'POST',cookie:admin.cookie,headers:{Origin:'https://evil.test'},body:{}})).status,403);
      const denied=await request('/api/admin/free-platform/settings',{method:'POST',cookie:admin.cookie,body:{registration_enabled:false,ads_enabled:false,revision:0,reason:'Wrong-password test',password:'incorrect password'}});assert.equal(denied.status,403);
      const before=await sql`SELECT * FROM stripe_billing_controls`;
      await saveSettings({registration_enabled:true});assert.deepEqual(await sql`SELECT * FROM stripe_billing_controls`,before);
      assert.equal(settings.ads_enabled,false);
      for(const field of ['sponsor_name','sponsor_text','sponsor_url'])assert.equal(settings[field],'');
    });
    await t.test('Free registration creates only a new non-tester account and cannot select privileges',async()=>{
      const email='registered-'+suffix+'@example.test',body={name:'New Free collector',email,password,consent:true};
      assert.equal((await request('/api/public/register',{method:'POST',body:{...body,role:'admin'}})).status,400);
      const r=await request('/api/public/register',{method:'POST',body});assert.equal(r.status,200,JSON.stringify(r.data));
      [freeUser]=await sql`SELECT id,email,role FROM app_users WHERE lower(email)=${email}`;ids.push(freeUser.id);assert.equal(freeUser.role,'user');
      assert.equal((await sql`SELECT * FROM account_access_grants WHERE user_id=${freeUser.id}`).length,0);
      assert.equal((await sql`SELECT plan_code FROM account_memberships WHERE user_id=${freeUser.id}`)[0].plan_code,'free');
      const pending=await request('/api/login',{method:'POST',body:{email,password}});assert.equal(pending.data.user,null);assert.equal(pending.data.pending.scope,'email_verification');
      // Dedicated verification tests cover the real mail/token path. Continue
      // this feature suite with an explicitly verified synthetic fixture.
      await sql`UPDATE app_users SET email_verified_at=now(),email_verification_required=false WHERE id=${freeUser.id}`;
      const login=await request('/api/login',{method:'POST',body:{email,password}});assert.equal(login.status,200);freeCookie=login.cookie;
      const state=(await request('/api/account/membership',{cookie:freeCookie})).data;assert.equal(state.access.tier,'free');assert.deepEqual(state.access.features,[]);assert.equal(state.access.payment_required,false);
      assert.equal((await request('/api/public/register',{method:'POST',body:{...body,email:tester.email}})).status,409);
      assert.equal((await sql`SELECT kind FROM account_access_grants WHERE user_id=${tester.id}`)[0].kind,'beta_tester');
    });
    await t.test('Free cannot mutate private collections but can read public data and export retained records',async()=>{
      assert.equal((await request('/api/binders',{method:'POST',cookie:freeCookie,body:{title:'Blocked',binder_type:'tracking',columns:3,rows:3,page_count:1}})).status,403);
      assert.equal((await request('/api/account/games',{method:'POST',cookie:freeCookie,body:{game:'pokemon',revision:0,confirm_read_only:true}})).status,403);
      assert.equal((await request('/api/collection',{method:'PUT',cookie:freeCookie,body:{printing_id:pokemonPrinting,condition:'NM',quantity:1,wishlist:false,notes:'',revision:0}})).status,403);
      assert.equal((await request('/api/prices/summary',{cookie:freeCookie})).status,403,'private value history follows the prices entitlement');
      assert.equal((await request('/api/public/catalogue/cards/'+encodeURIComponent(cardIds[2])+'/prices',{cookie:freeCookie})).status,200);
      assert.equal((await request('/api/collection/export?format=json',{cookie:freeCookie})).status,200);
    });
    for(const [label,invalid] of [
      ['empty sponsor name',{sponsor_name:''}],['empty sponsor message',{sponsor_text:''}],
      ['empty sponsor destination',{sponsor_url:''}],['missing consent',{confirm_sponsor:undefined}],
      ['declined consent',{confirm_sponsor:false}],['non-boolean consent',{confirm_sponsor:'true'}]
    ])await t.test('ad activation rejects '+label+' without changing settings or delivery',async()=>{
      const before=await request('/api/admin/free-platform',{cookie:admin.cookie});assert.equal(before.status,200);settings=before.data;
      const result=await request('/api/admin/free-platform/settings',{method:'POST',cookie:admin.cookie,
        body:settingsBody({...sponsorFixture,ads_enabled:true,...invalid})});
      assert.equal(result.status,400,JSON.stringify(result.data));assert.match(result.headers.get('content-type'),/json/);
      assert.match(result.data.message,/Review the sponsor/);
      const after=await request('/api/admin/free-platform',{cookie:admin.cookie});assert.equal(after.status,200);assert.deepEqual(after.data,before.data);
      assert.equal(after.data.ads_enabled,false);assert.equal(after.data.registration_enabled,true);
      assert.deepEqual((await request('/api/ads/placement?placement=overview',{cookie:freeCookie})).data,{eligible:false});
      assert.equal((await request('/api/ads/image',{cookie:freeCookie})).status,404);
    });
    await t.test('ads appear only for explicit Free accounts and never contain private settings',async()=>{
      await saveSettings({...sponsorFixture,ads_enabled:true});
      assert.equal(settings.ads_enabled,true);assert.equal(settings.registration_enabled,true);
      for(const field of ['sponsor_name','sponsor_text','sponsor_url','sponsor_cta','sponsor_image_alt'])assert.equal(settings[field],sponsorFixture[field]);
      const r=await request('/api/ads/placement?placement=overview',{cookie:freeCookie});assert.equal(r.status,200);assert.equal(r.data.eligible,true);assert.equal(r.data.creative.sponsor,'Synthetic Sponsor');assert.match(r.headers.get('cache-control'),/no-store/);
      for(const cookie of [undefined,admin.cookie,collector.cookie,pro.cookie,tester.cookie])assert.deepEqual((await request('/api/ads/placement?placement=catalogue',{cookie})).data,{eligible:false});
      for(const field of ['password','updated_by','registration_enabled','sponsor_image'])assert.ok(!Object.hasOwn(r.data.creative,field));
      assert.equal((await request('/api/ads/placement?placement=private-messages',{cookie:freeCookie})).status,400);
    });
    await t.test('sponsor uploads are local re-encoded images with the same Free-only delivery check',async()=>{
      // Establish this test's own ad state; a failed earlier assertion must not
      // turn an intentional disabled-image 404 into a misleading upload failure.
      const current=await request('/api/admin/free-platform',{cookie:admin.cookie});assert.equal(current.status,200);settings=current.data;
      await saveSettings({...sponsorFixture,ads_enabled:true});
      const {default:sharp}=await import('sharp');const bytes=await sharp({create:{width:4,height:4,channels:3,background:{r:1,g:2,b:3}}}).png().toBuffer();
      const upload=await request('/api/admin/free-platform/image',{method:'POST',cookie:admin.cookie,body:{password,revision:settings.revision,image_base64:bytes.toString('base64')}});
      assert.equal(upload.status,200,JSON.stringify(upload.data));settings=upload.data;
      const image=await request('/api/ads/image',{cookie:freeCookie});assert.equal(image.status,200);assert.equal(image.headers.get('content-type'),'image/webp');assert.match(image.headers.get('cache-control'),/no-store/);
      assert.equal((await sharp(image.data).metadata()).format,'webp');
      assert.equal((await request('/api/ads/image',{cookie:pro.cookie})).status,404);assert.equal((await request('/api/ads/image')).status,401);
      assert.equal((await request('/api/admin/free-platform/image',{cookie:admin.cookie})).status,200);
    });
    await t.test('assigning Pro or Complimentary stops ads without creating billing',async()=>{
      await sql`INSERT INTO account_tier_overrides(user_id,tier,reason) VALUES(${freeUser.id},'plus','Synthetic upgrade')`;
      assert.deepEqual((await request('/api/ads/placement?placement=overview',{cookie:freeCookie})).data,{eligible:false});
      await sql`UPDATE account_tier_overrides SET tier='complimentary' WHERE user_id=${freeUser.id}`;
      assert.deepEqual((await request('/api/ads/placement?placement=overview',{cookie:freeCookie})).data,{eligible:false});
      assert.equal((await sql`SELECT id FROM stripe_subscriptions WHERE user_id=${freeUser.id}`).length,0);
      await sql`DELETE FROM account_tier_overrides WHERE user_id=${freeUser.id}`;
    });
    await t.test('Collector defaults to Pokémon and cannot create a second game binder',async()=>{
      choice=(await request('/api/account/games',{cookie:collector.cookie})).data;assert.equal(choice.mode,'single');assert.equal(choice.selected,'pokemon');
      const input={title:'Synthetic Pokemon binder',binder_type:'tracking',columns:3,rows:3,page_count:1,game:'pokemon'};
      const created=await request('/api/binders',{method:'POST',cookie:collector.cookie,body:input});assert.equal(created.status,200);binder=created.data;
      assert.equal((await request('/api/binders',{method:'POST',cookie:collector.cookie,body:{...input,game:'mtg'}})).status,403);
      assert.equal((await request('/api/binders/'+binder.id+'/slots',{method:'POST',cookie:collector.cookie,body:{action:'place',target:0,printing_id:pokemonPrinting,revision:binder.revision}})).status,200);
    });
    await t.test('changing the selected game preserves old binders read-only and revokes no ownership',async()=>{
      const change=await request('/api/account/games',{method:'POST',cookie:collector.cookie,body:{game:'mtg',revision:choice.revision,confirm_read_only:true}});assert.equal(change.status,200);choice=change.data;
      const old=await request('/api/binders/'+binder.id,{cookie:collector.cookie});assert.equal(old.status,200);assert.equal(old.data.slots[0].printing_id,pokemonPrinting);
      assert.equal((await request('/api/binders/'+binder.id+'/slots',{method:'POST',cookie:collector.cookie,body:{action:'place',target:1,printing_id:pokemonPrinting,revision:old.data.revision}})).status,403);
      assert.equal((await request('/api/binders',{method:'POST',cookie:collector.cookie,body:{title:'Magic tracker',game:'mtg',binder_type:'tracking',columns:3,rows:3,page_count:1}})).status,200);
      assert.equal((await sql`SELECT quantity FROM collection_entries WHERE user_id=${pro.id} AND printing_id=${mtgPrinting}`)[0].quantity,2);
    });
    await t.test('game selection revisions reject stale and concurrent saves',async()=>{
      const body={game:'pokemon',revision:choice.revision,confirm_read_only:true};
      const responses=await Promise.all([request('/api/account/games',{method:'POST',cookie:collector.cookie,body}),request('/api/account/games',{method:'POST',cookie:collector.cookie,body:{...body,game:'yugioh'}})]);
      assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
    });
    await t.test('Pro and protected testers have all supported games',async()=>{
      for(const cookie of [pro.cookie,tester.cookie,admin.cookie]){const r=await request('/api/account/games',{cookie});assert.equal(r.data.mode,'unlimited');assert.equal(r.data.limit,null);assert.ok(r.data.games.every(g=>g.manageable));}
    });
    await t.test('database and API reject mixed-game pockets',async()=>{
      const r=await request('/api/binders',{method:'POST',cookie:pro.cookie,body:{title:'No mixing',game:'mtg',binder_type:'collection',columns:3,rows:3,page_count:1}});assert.equal(r.status,200);
      assert.equal((await request('/api/binders/'+r.data.id+'/slots',{method:'POST',cookie:pro.cookie,body:{action:'place',target:0,printing_id:ygoPrinting,revision:r.data.revision}})).status,400);
      await assert.rejects(()=>sql`INSERT INTO binder_slots(binder_id,position,printing_id) VALUES(${r.data.id},0,${ygoPrinting})`,e=>e.code==='23514');
      await assert.rejects(()=>sql`UPDATE binders SET game='yugioh' WHERE id=${r.data.id}`,e=>e.code==='23514');
    });
    await t.test('old-game deletion is allowed without resetting the selected game',async()=>{
      const old=(await request('/api/binders/'+binder.id,{cookie:collector.cookie})).data;
      assert.equal((await request('/api/binders/'+binder.id,{method:'DELETE',cookie:collector.cookie,body:{revision:old.revision,confirm_title:old.title}})).status,200);
    });
    await t.test('pausing advertisements and registration is independent and retains accounts',async()=>{
      await saveSettings({ads_enabled:false,registration_enabled:false});
      assert.deepEqual((await request('/api/ads/placement?placement=overview',{cookie:freeCookie})).data,{eligible:false});
      assert.equal((await request('/api/ads/image',{cookie:freeCookie})).status,404);
      assert.equal((await request('/api/session',{cookie:freeCookie})).data.user.id,freeUser.id);
      assert.equal((await request('/api/public/catalogue?game=mtg')).status,200);
    });
  }finally{
    await sql`DELETE FROM free_platform_settings`;
    if(oldSettings.length)await sql`INSERT INTO free_platform_settings ${sql(oldSettings)}`;
    await sql`DELETE FROM app_users WHERE id IN ${sql(ids)}`;
    if(cardIds.length){await sql`DELETE FROM printings WHERE card_id IN ${sql(cardIds)}`;await sql`DELETE FROM cards WHERE id IN ${sql(cardIds)}`;}
    if(setIds.length)await sql`DELETE FROM card_sets WHERE id IN ${sql(setIds)}`;
    await closeDatabase();await sql.end();
  }
});
