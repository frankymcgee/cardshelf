import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import sharp from 'sharp';
import { digest, randomToken } from '../../lib/security.mjs';
const url=process.env.TEST_BASE_URL;
if(process.env.ALLOW_TEST_DATABASE!=='yes'||!url||!new URL(process.env.DATABASE_URL||'http://invalid').pathname.endsWith('_test'))
  throw new Error('Cover tests require a disposable _test database, ALLOW_TEST_DATABASE=yes and TEST_BASE_URL.');
const sql=postgres(process.env.DATABASE_URL,{max:2});
const owner=randomUUID(),other=randomUUID(),binder=randomUUID(),token=randomToken(),otherToken=randomToken();
let revision=1,shared,insideVersion,coverVersion;
async function request(path,{method='GET',body,session=token}={}) {
  const response=await fetch(url+'/api/'+path,{method,headers:{Origin:process.env.APP_ORIGIN||url,'X-Requested-With':'cardshelf',
    ...(session?{Cookie:'cardshelf_session='+session}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
  const bytes=Buffer.from(await response.arrayBuffer());let data;
  try{data=JSON.parse(bytes.toString('utf8'));}catch{data=bytes;}
  return {status:response.status,data,headers:response.headers};
}
const path='binders/'+binder,edit=path+'/appearance';
const image=async colour=>({content_type:'image/png',data_base64:(await sharp({create:{width:1050,height:1050,channels:3,background:colour}}).png({compressionLevel:0}).toBuffer()).toString('base64')});
await test('outside binder covers persist independently and respect image access',async t=>{
  try {
    await sql`INSERT INTO app_users(id,email,name,password_hash) VALUES(${owner},${owner+'@test.invalid'},'Cover owner','not-a-real-login'),(${other},${other+'@test.invalid'},'Other user','not-a-real-login')`;
    await sql`INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(${digest(token)},${owner},now()+interval '1 hour'),(${digest(otherToken)},${other},now()+interval '1 hour')`;
    await sql`INSERT INTO binders(id,user_id,title,color,columns,rows,page_count) VALUES(${binder},${owner},'Cover fixture','#123456',3,3,2)`;
    await t.test('legacy binders keep their inside colour when the cover colour changes in settings',async()=>{
      const r=await request(path,{method:'PATCH',body:{revision,title:'Cover fixture',description:'',color:'#abcdef',columns:3,rows:3,page_count:2}});
      assert.equal(r.status,200,JSON.stringify(r.data));revision=r.data.revision;
      assert.equal(r.data.appearance.background_color,'#123456');assert.equal(r.data.color,'#abcdef');
      assert.equal(r.data.cover_wallpaper_version,null);
    });
    await t.test('cover mode needs an image and another user cannot upload or read one',async()=>{
      assert.equal((await request(edit,{method:'PATCH',body:{revision,appearance:{cover_mode:'image'}}})).status,400);
      assert.equal((await request(edit,{method:'PATCH',session:otherToken,body:{revision,appearance:{}}})).status,404);
      assert.equal((await request(path+'/cover-wallpaper',{session:otherToken})).status,404);
      assert.equal((await request(path+'/cover-wallpaper',{session:null})).status,401);
      assert.equal((await request(edit,{method:'PATCH',body:{revision,appearance:{},cover_color:'red'}})).status,400);
    });
    await t.test('both images save atomically even when their combined request exceeds the old 8 MB limit',async()=>{
      const body={revision,appearance:{mode:'image',cover_mode:'image',cover_wallpaper_fit:'contain'},cover_color:'#fedcba',wallpaper:await image('#336699'),cover_wallpaper:await image('#884422')};
      assert.ok(Buffer.byteLength(JSON.stringify(body))>8_000_000);
      const r=await request(edit,{method:'PATCH',body});assert.equal(r.status,200,JSON.stringify(r.data));revision=r.data.revision;
      insideVersion=r.data.wallpaper_version;coverVersion=r.data.cover_wallpaper_version;
      assert.match(coverVersion,/^[a-f0-9]{64}$/);assert.notEqual(insideVersion,coverVersion);
      assert.equal(r.data.appearance.background_color,'#123456');assert.equal(r.data.color,'#fedcba');
      const cover=await request(path+'/cover-wallpaper');assert.equal(cover.status,200);assert.equal(cover.headers.get('content-type'),'image/webp');
      assert.match(cover.headers.get('cache-control'),/no-store/);assert.equal(cover.headers.get('cross-origin-resource-policy'),'same-origin');
      const metadata=await sharp(cover.data).metadata();assert.equal(metadata.format,'webp');assert.equal(metadata.exif,undefined);
      const list=await request('binders');assert.equal(list.data.find(b=>b.id===binder).cover_wallpaper_version,coverVersion);
    });
    await t.test('stale and invalid cover uploads leave both saved images untouched',async()=>{
      assert.equal((await request(edit,{method:'PATCH',body:{revision:1,appearance:{cover_mode:'color'},remove_cover_wallpaper:true}})).status,409);
      assert.equal((await request(edit,{method:'PATCH',body:{revision,appearance:{},remove_wallpaper:true,cover_wallpaper:{content_type:'image/png',data_base64:'bad'}}})).status,400);
      const b=(await request(path)).data;assert.equal(b.wallpaper_version,insideVersion);assert.equal(b.cover_wallpaper_version,coverVersion);assert.equal(b.revision,revision);
    });
    await t.test('older interior-only saves preserve the new cover settings and colour',async()=>{
      const r=await request(edit,{method:'PATCH',body:{revision,appearance:{background_color:'#225588'}}});assert.equal(r.status,200);revision=r.data.revision;
      assert.equal(r.data.appearance.cover_mode,'image');assert.equal(r.data.appearance.cover_wallpaper_fit,'contain');assert.equal(r.data.color,'#fedcba');
      assert.equal(r.data.cover_wallpaper_version,coverVersion);
    });
    await t.test('current shared links expose each enabled surface without owner fields or bytes in JSON',async()=>{
      const share=await request(path+'/share',{method:'POST',body:{revision,enabled:true}});assert.equal(share.status,200);revision=share.data.revision;shared=share.data.share_token;
      const b=(await request('shared/'+shared,{session:null})).data;assert.equal(b.cover_wallpaper_version,coverVersion);assert.equal(b.user_id,undefined);assert.equal(b.data,undefined);
      assert.equal((await request('shared/'+shared+'/wallpaper',{session:null})).status,200);
      assert.equal((await request('shared/'+shared+'/cover-wallpaper',{session:null})).status,200);
    });
    await t.test('solid cover mode retains its private image and still shares the inside wallpaper',async()=>{
      const r=await request(edit,{method:'PATCH',body:{revision,appearance:{cover_mode:'color'}}});assert.equal(r.status,200);revision=r.data.revision;
      assert.equal((await request(path+'/cover-wallpaper')).status,200);
      assert.equal((await request('shared/'+shared+'/cover-wallpaper',{session:null})).status,404);
      assert.equal((await request('shared/'+shared+'/wallpaper',{session:null})).status,200);
    });
    await t.test('rotating and disabling the shared link revoke both wallpaper routes',async()=>{
      const r=await request(edit,{method:'PATCH',body:{revision,appearance:{cover_mode:'image'}}});assert.equal(r.status,200);revision=r.data.revision;
      const share=await request(path+'/share',{method:'POST',body:{revision,enabled:true}});assert.equal(share.status,200);revision=share.data.revision;
      for(const endpoint of ['wallpaper','cover-wallpaper']) assert.equal((await request('shared/'+shared+'/'+endpoint,{session:null})).status,404);
      shared=share.data.share_token;
      assert.equal((await request('shared/'+shared+'/cover-wallpaper',{session:null})).status,200);
      const disabled=await request(path+'/share',{method:'POST',body:{revision,enabled:false}});assert.equal(disabled.status,200);revision=disabled.data.revision;
      assert.equal((await request('shared/'+shared+'/cover-wallpaper',{session:null})).status,404);
    });
    await t.test('removing the cover deletes only its bytes and keeps all inside settings and pockets',async()=>{
      const r=await request(edit,{method:'PATCH',body:{revision,appearance:{cover_mode:'color'},remove_cover_wallpaper:true}});assert.equal(r.status,200);revision=r.data.revision;
      assert.equal(r.data.cover_wallpaper_version,null);assert.equal(r.data.wallpaper_version,insideVersion);assert.equal(r.data.appearance.mode,'image');
      assert.equal((await request(path+'/wallpaper')).status,200);assert.equal((await request(path+'/cover-wallpaper')).status,404);
      assert.deepEqual((await request(path)).data.slots,[]);
      assert.equal((await sql`SELECT count(*)::integer AS n FROM binder_cover_wallpapers WHERE binder_id=${binder}`)[0].n,0);
    });
    await t.test('deleting the binder also deletes its outside and inside images',async()=>{
      const r=await request(edit,{method:'PATCH',body:{revision,appearance:{cover_mode:'image'},cover_wallpaper:await image('#884422')}});assert.equal(r.status,200);revision=r.data.revision;
      assert.equal((await request(path,{method:'DELETE',body:{revision,confirm_title:'Cover fixture'}})).status,200);
      for(const table of ['binder_wallpapers','binder_cover_wallpapers']) assert.equal((await sql`SELECT count(*)::integer AS n FROM ${sql(table)} WHERE binder_id=${binder}`)[0].n,0);
    });
  } finally {await sql`DELETE FROM app_users WHERE id IN (${owner},${other})`;await sql.end();}
});
