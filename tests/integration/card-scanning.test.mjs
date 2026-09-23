// Real PostgreSQL + production HTTP routes. Recognition is injected in process;
// all keys/photos are synthetic and no call can reach OpenAI from this fixture.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import postgres from 'postgres';
import {hashPassword,randomToken,digest} from '../../lib/security.mjs';
import {closeDatabase} from '../../lib/db.mjs';
import {analyseCardScan,getCardScan,confirmCardScan,undoCardScan,scanAvailability} from '../../lib/card-scans.mjs';
import {scanningAdminOverview} from '../../lib/card-scan-settings.mjs';
import {ScanProviderError} from '../../lib/card-scan-provider.mjs';
import {scanHash,scanReservation} from '../../lib/card-scan-logic.mjs';
import {SCAN_DEFAULTS} from '../../shared/card-scanning.mjs';
import {markCollected} from '../../lib/tracking-binders.mjs';
const base=process.env.TEST_BASE_URL,url=process.env.DATABASE_URL;
if(process.env.ALLOW_TEST_DATABASE!=='yes'||!base||!new URL(url||'http://invalid').pathname.endsWith('_test')||!/^[a-f0-9]{64}$/i.test(process.env.CARDSHELF_INTEGRATION_KEY||''))throw Error('Use a disposable _test database and a synthetic encryption key.');
const sql=postgres(url,{max:4}),origin=process.env.APP_ORIGIN||base,users=[],scanIds=[];
const password='Synthetic scanner administrator password 123',apiKey='sk-synthetic-scanner-key-never-real';
const group='ci-scan-'+randomUUID().replaceAll('-',''),setId='en:'+group,cardId=setId+'-025';
const observation={card_count:1,readable:true,card_name:'Synthetic scanner card',collector_number:'025',printed_total:null,set_code:group,set_name:null,language:'en'};
const result={observation,input_tokens:2000,output_tokens:100,bounds_exceeded:false};
async function account(role='user'){
  const id=randomUUID(),token=randomToken();users.push(id);
  await sql`INSERT INTO app_users(id,email,name,password_hash,role) VALUES(${id},${id+'@example.test'},'Scanner fixture',${await hashPassword(password)},${role})`;
  await sql`DELETE FROM account_access_grants WHERE user_id=${id}`;
  await sql`INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(${digest(token)},${id},now()+interval '1 hour')`;
  await sql`INSERT INTO account_tier_overrides(user_id,tier,reason) VALUES(${id},'complimentary','Synthetic scanner access')`;
  return {id,cookie:'cardshelf_session='+token};
}
async function request(path,{user,method='GET',body,headers={}}={}){
  const r=await fetch(base+path,{method,redirect:'manual',headers:{Origin:origin,'X-Requested-With':'cardshelf',...(user?{Cookie:user.cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json'}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
  assert.match(r.headers.get('content-type')||'',/json/);return {status:r.status,data:await r.json()};
}
function upload(){const id=randomUUID();scanIds.push(id);return {request_id:id,image:'data:image/jpeg;base64,YWJj',confirm_external_processing:true};}
const row=id=>sql`SELECT * FROM card_scans WHERE id=${id}`.then(rows=>rows[0]);
function secretFree(value){const text=JSON.stringify(value);for(const s of [apiKey,password,process.env.CARDSHELF_INTEGRATION_KEY])assert.ok(!text.includes(s),'Secret leaked');}
await test('card scanning receipts, spending limits and collection/binder writes',async t=>{
  const previous=await sql`SELECT * FROM card_scan_settings`,controls=await sql`SELECT * FROM stripe_billing_controls`;
  let admin,owner,other,printing,otherPrinting,binder,tracking,foreign;let calls=0;
  const analyse=(body,user=owner,recognise=async()=>{calls++;return result;})=>analyseCardScan(user.id,body,{prepare:async()=>Buffer.from('synthetic'),recognise});
  const entry=()=>sql`SELECT * FROM collection_entries WHERE user_id=${owner.id} AND printing_id=${printing} AND condition='UNKNOWN'`.then(r=>r[0]);
  const binderState=()=>sql`SELECT * FROM binders WHERE id=${binder}`.then(r=>r[0]);
  const body=async(overrides={})=>({printing_id:printing,condition:'UNKNOWN',quantity:2,entry_revision:(await entry())?.revision??0,confirm:true,...overrides});
  const expectError=(run,status)=>assert.rejects(run,e=>e.status===status);
  async function preparedBinder(type,slots=[]){
    const [b]=await sql`INSERT INTO binders(user_id,title,columns,rows,page_count,binder_type) VALUES(${owner.id},'Prepared scan binder',2,2,2,${type}) RETURNING *`;
    if(slots.length)await sql`INSERT INTO binder_slots ${sql(slots.map(s=>({binder_id:b.id,is_collected:false,...s})), 'binder_id','position','printing_id','is_collected')}`;
    return b;
  }
  async function changeSettings(overrides={}){
    const current=(await request('/api/admin/scanning',{user:admin})).data.settings;
    return request('/api/admin/scanning',{user:admin,method:'POST',body:{revision:current.revision,password,enabled:current.enabled,
      monthly_budget_usd:current.monthly_budget_micros/1e6,user_monthly_limit:current.user_monthly_limit,
      input_usd_per_million:current.input_price_micros/1e6,output_usd_per_million:current.output_price_micros/1e6,...overrides}});
  }
  try{
    admin=await account('admin');owner=await account();other=await account();
    await sql`INSERT INTO card_sets(id,provider_id,language,name) VALUES(${setId},${group},'en','Synthetic scanner set')`;
    await sql`INSERT INTO cards(id,provider_id,set_id,language,local_id,name) VALUES(${cardId},${group+'-025'},${setId},'en','25',${observation.card_name})`;
    [printing,otherPrinting]=(await sql`INSERT INTO printings(card_id,key,label,source) VALUES(${cardId},'normal','Normal','tcgdex'),(${cardId},'holo','Holo','tcgdex') RETURNING id`).map(r=>r.id);
    for(const [user,type] of [[owner,'collection'],[owner,'tracking'],[other,'collection']]){
      const [b]=await sql`INSERT INTO binders(user_id,title,columns,rows,page_count,binder_type) VALUES(${user.id},'Scanner binder',2,2,1,${type}) RETURNING id`;
      if(user===other)foreign=b.id;else if(type==='tracking')tracking=b.id;else binder=b.id;
    }
    await sql`UPDATE card_scan_settings SET enabled=false,api_secret=null,monthly_budget_micros=0 WHERE singleton`;
    await t.test('HTTP authentication, administration, consent, CSRF and bounded JSON bodies',async()=>{
      for(const path of ['/api/scans','/api/admin/scanning'])assert.equal((await request(path)).status,401);
      assert.equal((await request('/api/admin/scanning',{user:owner})).status,403);
      assert.equal((await request('/api/scans',{user:owner,method:'POST',body:upload(),headers:{Origin:'https://evil.test'}})).status,403);
      assert.equal((await request('/api/scans',{user:owner,method:'POST',body:upload(),headers:{'Content-Type':'text/plain'}})).status,415);
      assert.equal((await request('/api/scans',{user:owner,method:'POST',body:{...upload(),confirm_external_processing:false}})).status,400);
      assert.equal((await request('/api/scans',{user:owner,method:'POST',body:upload()})).status,503);
      assert.equal((await request('/api/scans/'+randomUUID()+'/confirm',{user:owner,method:'POST',body:{padding:'x'.repeat(5000)}})).status,413);
      assert.equal((await scanAvailability(owner.id)).available,false);
    });
    await t.test('admin password and settings revision protect the encrypted provider credential',async()=>{
      const current=(await request('/api/admin/scanning',{user:admin})).data.settings;
      for(const [key,value] of Object.entries(SCAN_DEFAULTS))assert.equal(current[key],value,'Upgrade preserves '+key);
      const settings={revision:current.revision,password,api_key:apiKey,enabled:true,monthly_budget_usd:5,user_monthly_limit:100,input_usd_per_million:.4,output_usd_per_million:1.6};
      assert.equal((await request('/api/admin/scanning',{user:admin,method:'POST',body:{...settings,password:'wrong'}})).status,403);
      const saved=await request('/api/admin/scanning',{user:admin,method:'POST',body:settings});assert.equal(saved.status,200,JSON.stringify(saved.data));secretFree(saved.data);
      assert.equal((await request('/api/admin/scanning',{user:admin,method:'POST',body:settings})).status,409);
      const [stored]=await sql`SELECT api_secret FROM card_scan_settings`;assert.ok(stored.api_secret.startsWith('v1.'));assert.ok(!stored.api_secret.includes(apiKey));
      assert.equal((await scanAvailability(owner.id)).available,true);
    });
    await t.test('admin settings persist long prompts and each in-flight scan keeps its original configuration and prices',async()=>{
      const custom={...SCAN_DEFAULTS,model:'synthetic-reasoner',reasoning_effort:'high',reasoning_mode:'pro',image_detail:'auto',
        max_output_tokens:4096,input_token_ceiling:32768,request_timeout_seconds:120,prompt:'日本語'.repeat(2000)};
      const saved=await changeSettings({...custom,input_usd_per_million:.1,output_usd_per_million:.2});assert.equal(saved.status,200,JSON.stringify(saved.data));
      for(const [key,value] of Object.entries(custom))assert.equal(saved.data[key],value);secretFree(saved.data);
      const partial=await changeSettings();assert.equal(partial.status,200);assert.equal(partial.data.prompt,custom.prompt,'An older client must not reset new fields');
      const reservation=scanReservation({...custom,input_price_micros:100000,output_price_micros:200000});assert.equal(partial.data.reservation_micros,reservation);
      const u=upload();let release,started,captured;
      const gate=new Promise(r=>release=r),entered=new Promise(r=>started=r);
      const pending=analyse(u,owner,async({config})=>{captured=config;started();await gate;return {...result,output_tokens:1500,resolved_model:'synthetic-reasoner-2026-09-23'};});
      await entered;
      try{
        assert.deepEqual(captured,custom);assert.equal(Number((await row(u.request_id)).accounted_micros),reservation);
        // Restore the defaults while the previous model is still working.
        const reset=await changeSettings({...SCAN_DEFAULTS,input_usd_per_million:.4,output_usd_per_million:1.6});assert.equal(reset.status,200);
        await sql`UPDATE card_scans SET created_at=now()-interval '150 seconds' WHERE id=${u.request_id}`;
        assert.equal((await getCardScan(owner.id,u.request_id)).status,'processing','Receipt uses its own longer timeout');
        await expectError(()=>analyse(upload(),other),429);
      }finally{release();await pending;}
      const stored=await row(u.request_id);assert.equal(stored.status,'ready');assert.equal(stored.model,custom.model);
      assert.equal(stored.settings_revision,partial.data.revision);assert.equal(stored.reasoning_effort,'high');assert.equal(stored.reasoning_mode,'pro');
      assert.equal(stored.prompt_hash,scanHash(custom.prompt));assert.equal(stored.resolved_model,'synthetic-reasoner-2026-09-23');
      assert.equal(stored.max_output_tokens,4096);assert.equal(stored.input_token_ceiling,32768);assert.equal(Number(stored.accounted_micros),500,'Use saved prices, including reasoning output');
      const report=(await request('/api/admin/scanning',{user:admin})).data;
      assert.equal(report.models.find(m=>m.model===custom.model).accounted_micros,'500');
      const receipt=await getCardScan(owner.id,u.request_id);assert.ok(!JSON.stringify(receipt).includes(custom.prompt));
      assert.ok(!JSON.stringify(await sql`SELECT detail FROM audit_log WHERE action LIKE 'scanning.%'`).includes(custom.prompt));
      for(const patch of [{reasoning_effort:'unsupported'},{prompt:''},{model:'https://evil.test'},{max_output_tokens:32769}])assert.equal((await changeSettings(patch)).status,400);
      assert.equal((await request('/api/admin/scanning',{user:owner,method:'POST',body:{...custom,password}})).status,403);
      assert.equal((await request('/api/scans',{user:owner,method:'POST',body:{...upload(),model:custom.model}})).status,400);
      assert.equal((await request('/api/admin/scanning',{user:admin,method:'POST',body:{prompt:'x'.repeat(66000)}})).status,413);
    });
    await t.test('receipt replay calls the provider once and never exposes another account or raw photos',async()=>{
      const u=upload(),a=await analyse(u),before=calls;assert.equal(a.status,'ready');assert.equal(a.candidates[0].id,cardId);
      assert.equal((await analyse(u)).id,a.id);assert.equal(calls,before);
      await expectError(()=>analyse(u,other),409);await expectError(()=>analyse({...u,image:'data:image/jpeg;base64,YWJk'}),409);
      assert.equal((await request('/api/scans/'+a.id,{user:other})).status,404);
      const stored=await row(a.id);assert.equal(Number(stored.accounted_micros),960);assert.equal(stored.settled,true);
      for(const key of ['api_secret','image_hash','input_tokens'])assert.equal(Object.hasOwn(a,key),false);secretFree(a);
    });
    await t.test('only one analysis can occupy the CPU/network slot and spending is reserved before dispatch',async()=>{
      let release,started;const gate=new Promise(r=>release=r),entered=new Promise(r=>started=r);
      const u=upload(),pending=analyse(u,owner,async()=>{started();await gate;calls++;return result;});
      await entered;
      try{assert.equal((await analyse(u)).status,'processing');await expectError(()=>analyse(upload(),other),429);assert.equal(Number((await row(u.request_id)).accounted_micros),7783);}
      finally{release();await pending;}
    });
    await t.test('the monthly budget and personal quota prevent dispatch but preserve receipt retries',async()=>{
      const u=upload();await analyse(u);const before=calls;
      const [used]=await sql`SELECT count(*)::integer AS n FROM card_scans WHERE user_id=${owner.id}`;
      await sql`UPDATE card_scan_settings SET user_monthly_limit=${used.n}`;
      await expectError(()=>analyse(upload()),429);assert.equal((await analyse(u)).status,'ready');assert.equal(calls,before);
      await sql`UPDATE card_scan_settings SET user_monthly_limit=100`;
      const [total]=await sql`SELECT coalesce(sum(accounted_micros),0)::integer AS n FROM card_scans WHERE budget_month=date_trunc('month',now() AT TIME ZONE 'UTC')::date`;
      await sql`UPDATE card_scan_settings SET monthly_budget_micros=${total.n+7782}`;
      await expectError(()=>analyse(upload(),other),429);assert.equal(calls,before);assert.equal((await scanAvailability(owner.id)).available,false);
      await sql`UPDATE card_scan_settings SET monthly_budget_micros=5000000`;
    });
    await t.test('uncertain provider failures retain reservations; rejected images release money; stale receipts terminate',async()=>{
      const u=upload(),failed=await analyse(u,owner,async()=>{throw new ScanProviderError('provider_unavailable');});assert.equal(failed.status,'failed');
      const reserved=await row(u.request_id);assert.equal(reserved.settled,false);assert.equal(Number(reserved.accounted_micros),7783);
      await analyse(u);assert.equal((await row(u.request_id)).status,'failed');
      const invalid=upload(),bad=await analyseCardScan(owner.id,invalid,{recognise:async()=>{assert.fail('Invalid bytes must never reach provider');}});
      assert.equal(bad.status,'failed');assert.equal(Number((await row(bad.id)).accounted_micros),0);assert.equal((await row(bad.id)).settled,true);
      await sql`UPDATE card_scans SET status='processing',created_at=now()-interval '3 minutes' WHERE id=${u.request_id}`;
      assert.equal((await getCardScan(owner.id,u.request_id)).status,'failed');assert.equal((await row(u.request_id)).error_code,'interrupted');
    });
    await t.test('late usage violations do not disable a newer administrator configuration',async()=>{
      let release,started;const gate=new Promise(r=>release=r),entered=new Promise(r=>started=r),u=upload();
      const pending=analyse(u,owner,async()=>{started();await gate;return {...result,observation:null,input_tokens:17000,bounds_exceeded:true};});
      await entered;
      try{const saved=await changeSettings({input_token_ceiling:32768});assert.equal(saved.status,200);}
      finally{release();await pending;}
      assert.equal((await scanAvailability(owner.id)).enabled,true);
      assert.equal((await row(u.request_id)).settled,true);
      assert.equal((await changeSettings({input_token_ceiling:16384})).status,200);
    });
    await t.test('confirmed additions are atomic, idempotent and undoable without discarding notes or wishlist',async()=>{
      await sql`INSERT INTO collection_entries(user_id,printing_id,condition,quantity,notes,wishlist) VALUES(${owner.id},${printing},'UNKNOWN',3,'Keep these notes',true)`;
      const scan=await analyse(upload()),b=await binderState(),input=await body({binder:{id:binder,revision:b.revision,position:0}});
      const responses=await Promise.all([request('/api/scans/'+scan.id+'/confirm',{user:owner,method:'POST',body:input}),request('/api/scans/'+scan.id+'/confirm',{user:owner,method:'POST',body:input})]);
      for(const r of responses)assert.equal(r.status,200,JSON.stringify(r.data));assert.equal((await entry()).quantity,5);
      assert.equal((await sql`SELECT * FROM binder_slots WHERE binder_id=${binder} AND position=0`).length,1);
      await expectError(()=>confirmCardScan(owner.id,scan.id,{...input,quantity:1}),409);await expectError(()=>confirmCardScan(other.id,scan.id,input),404);
      assert.equal((await undoCardScan(owner.id,scan.id)).status,'undone');assert.equal((await undoCardScan(owner.id,scan.id)).status,'undone');
      assert.equal((await entry()).quantity,3);assert.equal((await entry()).notes,'Keep these notes');assert.equal((await entry()).wishlist,true);
      assert.equal((await sql`SELECT * FROM binder_slots WHERE binder_id=${binder} AND position=0`).length,0);
      assert.equal((await confirmCardScan(owner.id,scan.id,input)).status,'undone');assert.equal((await entry()).quantity,3);
    });
    await t.test('stale ownership and occupied or foreign binder pockets reject the whole addition',async()=>{
      const scan=await analyse(upload()),b=await binderState(),before=(await entry()).quantity;
      await expectError(async()=>confirmCardScan(owner.id,scan.id,{...await body(),entry_revision:0}),409);
      await expectError(async()=>confirmCardScan(owner.id,scan.id,await body({binder:{id:foreign,revision:1,position:0}})),404);
      await sql`INSERT INTO binder_slots(binder_id,position,printing_id) VALUES(${binder},1,${otherPrinting})`;
      await expectError(async()=>confirmCardScan(owner.id,scan.id,await body({binder:{id:binder,revision:b.revision,position:1}})),409);
      assert.equal((await entry()).quantity,before);assert.equal((await row(scan.id)).status,'ready');
      await sql`INSERT INTO binder_slots(binder_id,position,printing_id) VALUES(${binder},0,${printing})`;
      await confirmCardScan(owner.id,scan.id,await body({binder:{id:binder,revision:b.revision,position:0}}));
      await undoCardScan(owner.id,scan.id);assert.equal((await sql`SELECT * FROM binder_slots WHERE binder_id=${binder} AND position=0`).length,1,'Existing placement survives undo');
    });
    await t.test('automatic placement reuses a full prepared binder and concurrent HTTP retries add copies once',async()=>{
      const b=await preparedBinder('collection',Array.from({length:8},(_,position)=>({position,printing_id:position===6?printing:otherPrinting})));
      const scan=await analyse(upload()),before=(await entry()).quantity,input=await body({binder:{id:b.id,revision:b.revision,mode:'auto'}});
      const results=await Promise.all([1,2].map(()=>request('/api/scans/'+scan.id+'/confirm',{user:owner,method:'POST',body:input})));
      for(const r of results){assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(r.data.addition.binder.position,6);assert.equal(r.data.addition.binder.page,2);assert.equal(r.data.addition.binder.pocket,3);assert.equal(r.data.addition.binder.inserted,false);}
      assert.equal((await entry()).quantity,before+2);assert.equal((await sql`SELECT * FROM binder_slots WHERE binder_id=${b.id}`).length,8);
      assert.equal((await sql`SELECT revision FROM binders WHERE id=${b.id}`)[0].revision,b.revision,'Reusing a Collection pocket does not edit the layout');
      await undoCardScan(owner.id,scan.id);assert.equal((await entry()).quantity,before);assert.equal((await sql`SELECT * FROM binder_slots WHERE binder_id=${b.id}`).length,8);
    });
    await t.test('automatic empty-pocket placement and an explicit duplicate Collection placement both undo safely',async()=>{
      for(const manual of [false,true]){
        const b=await preparedBinder('collection',Array.from({length:5},(_,position)=>({position,printing_id:manual&&position===0?printing:otherPrinting})));
        const scan=await analyse(upload()),before=(await entry()).quantity;
        const added=await confirmCardScan(owner.id,scan.id,await body({binder:{id:b.id,revision:b.revision,...(manual?{position:5}:{mode:'auto'})}}));
        assert.equal(added.addition.binder.position,5);assert.equal(added.addition.binder.inserted,true);
        assert.equal((await sql`SELECT * FROM binder_slots WHERE binder_id=${b.id}`).length,6);assert.equal((await entry()).quantity,before+2);
        await undoCardScan(owner.id,scan.id);assert.equal((await entry()).quantity,before);assert.equal((await sql`SELECT * FROM binder_slots WHERE binder_id=${b.id}`).length,5);
      }
    });
    await t.test('Tracking placement handles missing, already-collected and empty pockets while Undo preserves prior marks',async()=>{
      assert.ok((await scanAvailability(owner.id)).binder_types.includes('tracking'));
      for(const collected of [false,true,null]){
        const b=await preparedBinder('tracking',collected===null?[]:[{position:5,printing_id:printing,is_collected:collected}]);
        const scan=await analyse(upload()),before=(await entry()).quantity,input=await body({binder:{id:b.id,revision:b.revision,mode:'auto'}});
        if(collected!==null)await expectError(async()=>confirmCardScan(owner.id,scan.id,await body({binder:{id:b.id,revision:b.revision,position:0}})),409);
        const added=await confirmCardScan(owner.id,scan.id,input);await confirmCardScan(owner.id,scan.id,input);
        assert.equal(added.addition.binder.binder_type,'tracking');assert.equal(added.addition.binder.position,collected===null?0:5);
        assert.equal(added.addition.binder.marked_collected,collected!==true);assert.equal((await entry()).quantity,before+2);
        let slots=await sql`SELECT * FROM binder_slots WHERE binder_id=${b.id}`;assert.equal(slots.length,1);assert.equal(slots[0].is_collected,true);
        await undoCardScan(owner.id,scan.id);assert.equal((await entry()).quantity,before);
        slots=await sql`SELECT * FROM binder_slots WHERE binder_id=${b.id}`;assert.equal(slots.length,collected===null?0:1);
        if(collected!==null)assert.equal(slots[0].is_collected,collected);
      }
    });
    await t.test('a full nonmatching binder or changed layout rejects automatic placement without adding inventory',async()=>{
      const b=await preparedBinder('collection',Array.from({length:8},(_,position)=>({position,printing_id:otherPrinting})));
      const scan=await analyse(upload()),before=(await entry()).quantity;
      await expectError(async()=>confirmCardScan(owner.id,scan.id,await body({binder:{id:b.id,revision:b.revision,mode:'auto'}})),409);
      await sql`DELETE FROM binder_slots WHERE binder_id=${b.id} AND position=0`;
      await sql`UPDATE binders SET revision=revision+1 WHERE id=${b.id}`;
      await expectError(async()=>confirmCardScan(owner.id,scan.id,await body({binder:{id:b.id,revision:b.revision,mode:'auto'}})),409);
      assert.equal((await entry()).quantity,before);assert.equal((await row(scan.id)).status,'ready');
      assert.equal((await sql`SELECT * FROM binder_slots WHERE binder_id=${b.id} AND position=0`).length,0);
    });
    await t.test('later checklist edits prevent scan Undo from overwriting them or partially reducing inventory',async()=>{
      const b=await preparedBinder('tracking',[{position:0,printing_id:printing,is_collected:false}]);
      const scan=await analyse(upload()),added=await confirmCardScan(owner.id,scan.id,await body({binder:{id:b.id,revision:b.revision,mode:'auto'}}));
      await markCollected(owner.id,b.id,{request_id:randomUUID(),revision:added.addition.binder.revision,position:0,printing_id:printing,collected:false});
      const before=(await entry()).quantity;await expectError(()=>undoCardScan(owner.id,scan.id),409);
      assert.equal((await entry()).quantity,before);assert.equal((await sql`SELECT is_collected FROM binder_slots WHERE binder_id=${b.id} AND position=0`)[0].is_collected,false);
    });
    await t.test('edits after scanning prevent undo from clobbering later work',async()=>{
      const scan=await analyse(upload());await confirmCardScan(owner.id,scan.id,await body());
      await sql`UPDATE collection_entries SET quantity=quantity+1,revision=revision+1 WHERE user_id=${owner.id} AND printing_id=${printing} AND condition='UNKNOWN'`;
      const before=(await entry()).quantity;await expectError(()=>undoCardScan(owner.id,scan.id),409);assert.equal((await entry()).quantity,before);
      const scan2=await analyse(upload()),b=await binderState();await confirmCardScan(owner.id,scan2.id,await body({binder:{id:binder,revision:b.revision,position:2}}));
      await sql`UPDATE binders SET revision=revision+1 WHERE id=${binder}`;await expectError(()=>undoCardScan(owner.id,scan2.id),409);
    });
    await t.test('membership loss stops chargeable analysis and additions while allowing safe undo',async()=>{
      const a=await analyse(upload()),b=await analyse(upload());await confirmCardScan(owner.id,a.id,await body());
      await sql`UPDATE account_tier_overrides SET tier='collector' WHERE user_id=${owner.id}`;
      await sql`INSERT INTO stripe_billing_controls(id,environment,subscriptions_enabled,enforcement_enabled) VALUES(1,'production',false,true) ON CONFLICT(id) DO UPDATE SET enforcement_enabled=true,environment='production'`;
      await expectError(()=>analyse(upload()),403);await expectError(async()=>confirmCardScan(owner.id,b.id,await body()),403);
      assert.equal((await undoCardScan(owner.id,a.id)).status,'undone');assert.equal((await scanAvailability(owner.id)).eligible,false);
      await sql`UPDATE account_tier_overrides SET tier='complimentary' WHERE user_id=${owner.id}`;
    });
    await t.test('account deletion during recognition retains costs without restoring private observations',async()=>{
      const departed=await account(),u=upload();let release,started;
      const gate=new Promise(r=>release=r),entered=new Promise(r=>started=r);
      const pending=analyse(u,departed,async()=>{started();await gate;return result;});
      const rejected=expectError(()=>pending,404);
      await entered;
      try{await sql`DELETE FROM app_users WHERE id=${departed.id}`;}
      finally{release();await rejected;}
      const r=await row(u.request_id);assert.equal(r.observations,null);assert.equal(r.image_hash,'0'.repeat(64));assert.deepEqual(r.candidate_ids,[]);assert.equal(Number(r.accounted_micros),960);
    });
    await t.test('unexpected accounting boundaries pause scanning, and admin usage contains no credentials',async()=>{
      const a=await analyse(upload(),owner,async()=>({...result,observation:null,input_tokens:17000,bounds_exceeded:true}));assert.equal(a.status,'failed');
      assert.equal((await scanAvailability(owner.id)).available,false);
      const report=await scanningAdminOverview(admin.id);assert.equal(report.settings.enabled,false);assert.ok(report.totals.scans>0);assert.ok(report.history.length);secretFree(report);
      secretFree(await sql`SELECT detail FROM audit_log WHERE action LIKE 'scanning.%'`);
      const retained=await row(a.id);await sql`DELETE FROM app_users WHERE id=${owner.id}`;
      assert.equal((await row(a.id)).user_id,null);assert.equal((await row(a.id)).accounted_micros,retained.accounted_micros);
      for(const id of scanIds){const r=await row(id);if(r&&r.user_id===null){assert.equal(r.observations,null);assert.equal(r.addition,null);assert.equal(r.image_hash,'0'.repeat(64));}}
    });
  }finally{
    try{
      await sql`DELETE FROM card_scans WHERE id IN ${sql(scanIds)}`;
      await sql`DELETE FROM card_scan_settings`;for(const r of previous)await sql`INSERT INTO card_scan_settings ${sql(r)}`;
      await sql`DELETE FROM stripe_billing_controls`;for(const r of controls)await sql`INSERT INTO stripe_billing_controls ${sql(r)}`;
      if(users.length)await sql`DELETE FROM app_users WHERE id IN ${sql(users)}`;
      await sql`DELETE FROM printings WHERE card_id=${cardId}`;await sql`DELETE FROM cards WHERE id=${cardId}`;await sql`DELETE FROM card_sets WHERE id=${setId}`;
    }finally{await sql.end();await closeDatabase();}
  }
});
