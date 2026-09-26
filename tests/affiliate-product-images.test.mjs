import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {optimiseAffiliateImage,affiliateProductImage,AFFILIATE_IMAGE_INPUT_LIMIT} from '../lib/affiliate-product-images.mjs';
const encode=(buffer,type='image/png')=>({content_type:type,image_base64:buffer.toString('base64')});

test('manual product images are bounded, rotated, re-encoded and stripped of metadata',async()=>{
  const photo=await sharp({create:{width:1800,height:900,channels:3,background:'#5546d8'}}).jpeg().withMetadata({orientation:6}).toBuffer();
  const image=await optimiseAffiliateImage(encode(photo,'image/jpeg'));
  const metadata=await sharp(image.content).metadata();
  assert.equal(metadata.format,'webp');assert.equal(metadata.width,600);assert.equal(metadata.height,1200);
  assert.equal(metadata.exif,undefined);assert.equal(metadata.icc,undefined);assert.equal(metadata.orientation,undefined);assert.ok(image.content.length<=524288);
  for(const content_type of ['image/png','image/webp']){
    const buffer=await sharp({create:{width:40,height:50,channels:4,background:{r:60,g:70,b:80,alpha:.5}}}).toFormat(content_type.split('/')[1]).toBuffer();
    const decoded=await optimiseAffiliateImage(encode(buffer,content_type));assert.equal(decoded.width,40);assert.equal(decoded.height,50);
  }
});
test('image uploads reject scripts, spoofed formats, invalid encodings and excessive size or dimensions',async()=>{
  const png=await sharp({create:{width:10,height:10,channels:3,background:'white'}}).png().toBuffer();
  const tooWide=await sharp({create:{width:6001,height:2,channels:3,background:'white'}}).png().toBuffer();
  const tooManyPixels=await sharp({create:{width:4000,height:3100,channels:3,background:'white'}}).png().toBuffer();
  const values=[encode(Buffer.from('<svg onload="alert(1)"></svg>'),'image/svg+xml'),encode(png,'image/jpeg'),encode(Buffer.from('not an image')),
    {content_type:'image/png',image_base64:'a==='},{content_type:'image/png',image_base64:'AB=='},{content_type:'image/png',image_base64:'YQ==\n'},
    encode(Buffer.alloc(AFFILIATE_IMAGE_INPUT_LIMIT+1)),encode(tooWide),encode(tooManyPixels),{...encode(png),url:'https://example.com/image.png'}];
  for(const value of values)await assert.rejects(()=>optimiseAffiliateImage(value),e=>[400,413,415].includes(e.status));
});
test('public image reads require an enabled, unexpired product reference; private previews need the admin route',async()=>{
  const id='00000000-0000-0000-0000-000000000001',content=Buffer.from('image');
  const product={kind:'product',image_id:id,enabled:true,url:'https://www.amazon.com.au/dp/ABCDEFGHIJ?tag=fixture-22',expires_on:''};
  for(const row of [undefined,{enabled:false,shops:[product],content},{enabled:true,shops:[],content},
    ...[{enabled:false},{expires_on:'2000-01-01'},{kind:'shop'},{url:'javascript:bad'},{image_id:'00000000-0000-0000-0000-000000000002'}].map(change=>({enabled:true,shops:[{...product,...change}],content}))]){
    await assert.rejects(()=>affiliateProductImage(id,false,async()=>row?[row]:[]),e=>e.status===404);
  }
  assert.equal(await affiliateProductImage(id,false,async()=>[{enabled:true,shops:[product],content}]),content);
  assert.equal(await affiliateProductImage(id,true,async()=>[{enabled:false,shops:[],content}]),content);
  await assert.rejects(()=>affiliateProductImage('../../private',false,async()=>[]),e=>e.status===400);
});
