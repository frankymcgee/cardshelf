import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import postgres from 'postgres';
import sharp from 'sharp';
import {hashPassword,randomToken,digest} from '../../lib/security.mjs';
const base=process.env.TEST_BASE_URL;
if(process.env.ALLOW_TEST_DATABASE!=='yes'||!base||!new URL(process.env.DATABASE_URL||'http://invalid').pathname.endsWith('_test'))throw new Error('Use a disposable _test database only.');
const sql=postgres(process.env.DATABASE_URL,{max:3}),ids=[],images=[],password='Product image fixture 123';
async function request(path,cookie,body,origin=process.env.APP_ORIGIN||base){
  const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{...(cookie?{Cookie:cookie}:{}),Origin:origin,'X-Requested-With':'cardshelf','Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  return {status:r.status,headers:r.headers,data:r.headers.get('content-type')?.startsWith('image/')?Buffer.from(await r.arrayBuffer()):await r.json()};
}
await test('manual product images remain private until the saved product is published',async t=>{
  let original,revision,admin,user,imageId;
  try{
    [original]=await sql`SELECT * FROM affiliate_shop_settings WHERE singleton`;
    await sql`UPDATE affiliate_shop_settings SET enabled=false,shops='[]'::jsonb WHERE singleton`;
    for(const role of ['admin','user']){
      const id=randomUUID(),token=randomToken();ids.push(id);
      await sql`INSERT INTO app_users(id,name,email,password_hash,role) VALUES(${id},'Product image fixture',${id+'@example.test'},${await hashPassword(password)},${role})`;
      await sql`INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(${digest(token)},${id},now()+interval '1 hour')`;
      const account={id,cookie:'cardshelf_session='+token};if(role==='admin')admin=account;else user=account;
    }
    revision=(await request('/api/admin/affiliate-shops',admin.cookie)).data.revision;
    const png=await sharp({create:{width:200,height:140,channels:3,background:'#6f65bd'}}).png().withMetadata().toBuffer();
    const image={content_type:'image/png',image_base64:png.toString('base64')};
    const uploadPath='/api/admin/affiliate-shops/images';
    const product=overrides=>({id:randomUUID(),kind:'product',retailer:'amazon',name:'Archive zip binder',description:'My own description.\nA binder for sleeved cards.',url:'https://www.amazon.com.au/dp/ABCDEFGHIJ?tag=fixture-22&linkCode=ll1',search_url:'',referral_code:'',enabled:true,placements:['marketplace','cards','catalogue'],games:[],expires_on:'',image_id:imageId,...overrides});
    const save=async(shops,enabled=true,rev=revision)=>{const result=await request('/api/admin/affiliate-shops',admin.cookie,{shops,enabled,revision:rev,password});if(result.status===200)revision=result.data.revision;return result;};
    await t.test('upload requires an administrator, same origin, bounded JSON and a decodable still image',async()=>{
      assert.equal((await request(uploadPath,null,image)).status,401);assert.equal((await request(uploadPath,user.cookie,image)).status,403);
      assert.equal((await request(uploadPath,admin.cookie,image,'https://evil.example.com')).status,403);
      assert.equal((await request(uploadPath,admin.cookie,{...image,image_base64:'bad'})).status,400);
      assert.equal((await request(uploadPath,admin.cookie,{...image,content_type:'image/svg+xml'})).status,415);
      assert.equal((await request(uploadPath,admin.cookie,{...image,url:'https://example.com/pixel'})).status,400);
      assert.equal((await request(uploadPath,admin.cookie,{...image,image_base64:'a'.repeat(1500000)})).status,413);
      const uploaded=await request(uploadPath,admin.cookie,image);assert.equal(uploaded.status,200,JSON.stringify(uploaded.data));
      imageId=uploaded.data.id;images.push(imageId);assert.equal(uploaded.data.width,200);
    });
    const publicImage='/api/public/affiliate-images/'+imageId,adminImage=uploadPath+'/'+imageId;
    await t.test('draft bytes are admin-only and uploading does not modify saved settings',async()=>{
      assert.equal((await request(adminImage)).status,401);assert.equal((await request(adminImage,user.cookie)).status,403);
      const preview=await request(adminImage,admin.cookie);assert.equal(preview.status,200);assert.match(preview.headers.get('cache-control'),/private.*no-store/);
      const metadata=await sharp(preview.data).metadata();assert.equal(metadata.format,'webp');assert.equal(metadata.exif,undefined);
      assert.equal((await request(publicImage)).status,404);assert.equal((await request(publicImage,admin.cookie)).status,404);
      const settings=await request('/api/admin/affiliate-shops',admin.cookie);assert.equal(settings.data.revision,revision);assert.deepEqual(settings.data.shops,[]);
    });
    await t.test('publication preserves product text and tracking; stale edits and missing images are rejected',async()=>{
      assert.equal((await save([product({image_id:randomUUID()})])).status,400);
      assert.equal((await save([product()],true,revision-1)).status,revision===1?400:409);
      const entry=product(),saved=await save([entry]);assert.equal(saved.status,200,JSON.stringify(saved.data));
      assert.equal(saved.data.shops[0].content_source,'manual');
      const published=await request('/api/public/affiliate-shops');assert.equal(published.data.shops[0].image_id,imageId);assert.equal(published.data.shops[0].url,entry.url);assert.equal(published.data.shops[0].description,entry.description);
      assert.doesNotMatch(JSON.stringify(published.data),/uploaded_by|content_source|image_base64|password/);
      const publicResult=await request(publicImage);assert.equal(publicResult.status,200);assert.equal(publicResult.headers.get('content-type'),'image/webp');assert.match(publicResult.headers.get('cache-control'),/no-store/);assert.equal(publicResult.headers.get('x-content-type-options'),'nosniff');
      assert.equal((await save([],true,revision-1)).status,409);assert.equal((await request(publicImage)).status,200);
    });
    await t.test('pause, expiry, replacement and removal revoke public image access',async()=>{
      for(const [entry,enabled] of [[product({enabled:false}),true],[product({expires_on:'2000-01-01'}),true],[product(),false]]){
        assert.equal((await save([entry],enabled)).status,200);assert.equal((await request(publicImage)).status,404);
      }
      await save([product()]);assert.equal((await request(publicImage)).status,200);
      const next=await request(uploadPath,admin.cookie,image);images.push(next.data.id);const replacement=product({image_id:next.data.id});
      assert.equal((await request('/api/public/affiliate-images/'+next.data.id)).status,404);assert.equal((await request(publicImage)).status,200);
      await save([replacement]);assert.equal((await request(publicImage)).status,404);assert.equal((await request('/api/public/affiliate-images/'+next.data.id)).status,200);
      await save([{...replacement,image_id:''}]);assert.equal((await request('/api/public/affiliate-images/'+next.data.id)).status,404);
    });
    await t.test('cleanup preserves saved and recent drafts while reclaiming old unused images',async()=>{
      await save([product({enabled:false})]);
      await sql`UPDATE affiliate_product_images SET created_at=now()-interval '2 days' WHERE id IN ${sql(images)}`;
      const recent=await request(uploadPath,admin.cookie,image);assert.equal(recent.status,200);images.push(recent.data.id);
      const rows=await sql`SELECT id FROM affiliate_product_images WHERE id IN ${sql(images)}`;
      assert.deepEqual(rows.map(r=>r.id).sort(),[imageId,recent.data.id].sort());
      assert.equal((await request(adminImage,admin.cookie)).status,200);
      const audit=await sql`SELECT detail FROM audit_log WHERE user_id=${admin.id} AND action='affiliate.product_image_uploaded'`;
      assert.equal(audit.length,3);assert.doesNotMatch(JSON.stringify(audit),/base64|content_type|password/);
      await sql`UPDATE app_users SET role='user' WHERE id=${admin.id}`;
      assert.equal((await request(uploadPath,admin.cookie,image)).status,403);assert.equal((await request(adminImage,admin.cookie)).status,403);
    });
  }finally{
    if(original)await sql`UPDATE affiliate_shop_settings SET enabled=${original.enabled},shops=${sql.json(original.shops)},revision=${original.revision},updated_by=${original.updated_by},updated_at=${original.updated_at} WHERE singleton`;
    if(images.length)await sql`DELETE FROM affiliate_product_images WHERE id IN ${sql(images)}`;
    if(ids.length){await sql`DELETE FROM audit_log WHERE user_id IN ${sql(ids)}`;await sql`DELETE FROM app_users WHERE id IN ${sql(ids)}`;await sql`DELETE FROM auth_attempts WHERE bucket IN ${sql(ids.flatMap(id=>[digest('affiliate-shops-admin:'+id),digest('affiliate-product-image:'+id)]))}`;}
    await sql.end();
  }
});
