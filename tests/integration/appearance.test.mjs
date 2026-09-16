// Isolated fixtures; never run against a production database.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import sharp from 'sharp';
import { digest, randomToken } from '../../lib/security.mjs';
import { appearanceDefaults } from '../../shared/appearance.mjs';
const url=process.env.TEST_BASE_URL;
if(process.env.ALLOW_TEST_DATABASE!=='yes'||!url||!new URL(process.env.DATABASE_URL||'http://invalid').pathname.endsWith('_test'))
  throw new Error('Appearance tests require a disposable _test database, ALLOW_TEST_DATABASE=yes and TEST_BASE_URL.');
const sql=postgres(process.env.DATABASE_URL,{max:2});
const owner=randomUUID(),other=randomUUID(),binder=randomUUID(),token=randomToken(),otherToken=randomToken();
let revision=1,shareToken;
const base=appearanceDefaults('#735590');
async function request(path,{method='GET',body,session=token,headers={}}={}) {
  const response=await fetch(url+'/api/'+path,{method,headers:{Origin:process.env.APP_ORIGIN||url,'X-Requested-With':'cardshelf',
    ...(session?{Cookie:'cardshelf_session='+session}:{}),...(body?{'Content-Type':'application/json'}:{}),...headers},body:body?JSON.stringify(body):undefined});
  const bytes=Buffer.from(await response.arrayBuffer());let data;
  try{data=JSON.parse(bytes.toString('utf8'));}catch{data=bytes;}
  return {status:response.status,data,headers:response.headers};
}
const path='binders/'+binder+'/appearance';
await test('binder appearance ownership, sharing and image persistence',async t=>{
  try {
    await sql`INSERT INTO app_users(id,email,name,password_hash) VALUES(${owner},${owner+'@test.invalid'},'Appearance owner','not-a-real-login'),(${other},${other+'@test.invalid'},'Other user','not-a-real-login')`;
    await sql`INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(${digest(token)},${owner},now()+interval '1 hour'),(${digest(otherToken)},${other},now()+interval '1 hour')`;
    await sql`INSERT INTO binders(id,user_id,title,color,columns,rows,page_count) VALUES(${binder},${owner},'Appearance fixture','#735590',3,3,2)`;
    await t.test('existing and newly generated binders default to empty appearance metadata',async()=>{
      const r=await request('binders/'+binder);assert.equal(r.status,200);assert.deepEqual(r.data.appearance,{});assert.equal(r.data.wallpaper_version,null);
    });
    await t.test('unauthenticated edits and cross-origin uploads are rejected',async()=>{
      assert.equal((await request(path,{method:'PATCH',session:null,body:{}})).status,401);
      assert.equal((await request(path,{method:'PATCH',body:{},headers:{Origin:'https://other.invalid'}})).status,403);
    });
    await t.test('another collector cannot change or read this binder wallpaper',async()=>{
      assert.equal((await request(path,{method:'PATCH',session:otherToken,body:{revision,appearance:base}})).status,404);
      assert.equal((await request('binders/'+binder+'/wallpaper',{session:otherToken})).status,404);
    });
    await t.test('solid colour and zero opacity persist without changing layout or ownership',async()=>{
      const r=await request(path,{method:'PATCH',body:{revision,appearance:{...base,pocket_opacity:0,effects_mode:'off'}}});assert.equal(r.status,200,JSON.stringify(r.data));revision=r.data.revision;
      assert.equal(r.data.appearance.pocket_opacity,0);assert.equal(r.data.appearance.effects_mode,'off');
      assert.equal((await sql`SELECT count(*)::integer AS n FROM collection_entries WHERE user_id=${owner}`)[0].n,0);
      assert.equal((await request('binders/'+binder)).data.page_count,2);
    });
    await t.test('stale updates are rejected and cannot overwrite appearance',async()=>{
      assert.equal((await request(path,{method:'PATCH',body:{revision:1,appearance:{...base,background_color:'#ffffff'}}})).status,409);
      assert.equal((await request('binders/'+binder)).data.appearance.background_color,base.background_color);
    });
    await t.test('wallpaper mode requires a saved or supplied image',async()=>{
      assert.equal((await request(path,{method:'PATCH',body:{revision,appearance:{...base,mode:'image'}}})).status,400);
    });
    await t.test('arbitrary URLs, malformed image bytes and SVG are not accepted',async()=>{
      assert.equal((await request(path,{method:'PATCH',body:{revision,appearance:{...base,image_url:'https://bad.invalid'}}})).status,400);
      assert.equal((await request(path,{method:'PATCH',body:{revision,appearance:base,wallpaper:{content_type:'image/png',data_base64:Buffer.from('<svg/>').toString('base64')}}})).status,415);
    });
    await t.test('upload plus appearance saves atomically as re-encoded WebP',async()=>{
      const bytes=await sharp({create:{width:25,height:20,channels:3,background:'#557788'}}).png().withMetadata().toBuffer();
      const r=await request(path,{method:'PATCH',body:{revision,appearance:{...base,mode:'image',wallpaper_fit:'tile',print_background:true},wallpaper:{content_type:'image/png',data_base64:bytes.toString('base64')}}});
      assert.equal(r.status,200,JSON.stringify(r.data));revision=r.data.revision;assert.match(r.data.wallpaper_version,/^[a-f0-9]{64}$/);
      const image=await request('binders/'+binder+'/wallpaper');assert.equal(image.status,200);assert.equal(image.headers.get('content-type'),'image/webp');assert.match(image.headers.get('cache-control'),/no-store/);
      const metadata=await sharp(image.data).metadata();assert.equal(metadata.format,'webp');assert.equal(metadata.exif,undefined);assert.equal(metadata.width,25);
    });
    await t.test('missing or invalid uploads do not delete a previously saved image',async()=>{
      const before=(await request('binders/'+binder)).data.wallpaper_version;
      assert.equal((await request(path,{method:'PATCH',body:{revision,appearance:base,wallpaper:{content_type:'image/png',data_base64:'bad'}}})).status,400);
      assert.equal((await request('binders/'+binder)).data.wallpaper_version,before);
    });
    await t.test('changing binder settings preserves appearance and the wallpaper',async()=>{
      const r=await request('binders/'+binder,{method:'PATCH',body:{revision,title:'Appearance fixture',description:'Updated',color:'#735590',columns:3,rows:3,page_count:2}});
      assert.equal(r.status,200);revision=r.data.revision;assert.equal(r.data.appearance.mode,'image');assert.ok(r.data.wallpaper_version);
    });
    await t.test('sharing explicitly exposes theme but never image bytes in JSON or private owner fields',async()=>{
      const share=await request('binders/'+binder+'/share',{method:'POST',body:{revision,enabled:true}});assert.equal(share.status,200);revision=share.data.revision;shareToken=share.data.share_token;
      const r=await request('shared/'+shareToken,{session:null});assert.equal(r.status,200);assert.equal(r.data.appearance.mode,'image');assert.equal(r.data.user_id,undefined);assert.equal(r.data.data,undefined);
      const image=await request('shared/'+shareToken+'/wallpaper',{session:null});assert.equal(image.status,200);assert.match(image.headers.get('cache-control'),/no-store/);
      assert.equal((await request('binders/'+binder+'/wallpaper',{session:null})).status,401);
    });
    await t.test('switching to solid colour retains the private image but stops its shared retrieval',async()=>{
      const r=await request(path,{method:'PATCH',body:{revision,appearance:base}});assert.equal(r.status,200);revision=r.data.revision;
      assert.equal((await request('binders/'+binder+'/wallpaper')).status,200);
      assert.equal((await request('shared/'+shareToken+'/wallpaper',{session:null})).status,404);
    });
    await t.test('rotating sharing tokens revokes old wallpaper URLs immediately',async()=>{
      const r=await request(path,{method:'PATCH',body:{revision,appearance:{...base,mode:'image'}}});revision=r.data.revision;
      const share=await request('binders/'+binder+'/share',{method:'POST',body:{revision,enabled:true}});revision=share.data.revision;
      assert.equal((await request('shared/'+shareToken+'/wallpaper',{session:null})).status,404);shareToken=share.data.share_token;
      assert.equal((await request('shared/'+shareToken+'/wallpaper',{session:null})).status,200);
    });
    await t.test('removing wallpaper deletes stored bytes and falls back to chosen colour',async()=>{
      const r=await request(path,{method:'PATCH',body:{revision,appearance:base,remove_wallpaper:true}});assert.equal(r.status,200);revision=r.data.revision;assert.equal(r.data.wallpaper_version,null);
      assert.equal((await request('binders/'+binder+'/wallpaper')).status,404);
      assert.equal((await sql`SELECT count(*)::integer AS n FROM binder_wallpapers WHERE binder_id=${binder}`)[0].n,0);
      assert.deepEqual((await request('binders/'+binder)).data.slots,[]);
    });
  } finally {await sql`DELETE FROM app_users WHERE id IN (${owner},${other})`;await sql.end();}
});
