import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { optimiseWallpaper } from '../lib/wallpaper-image.mjs';
const payload=(bytes,type='image/png')=>({content_type:type,data_base64:bytes.toString('base64')});
test('wallpapers are fully decoded and stored as bounded WebP without metadata',async()=>{
  const original=await sharp({create:{width:48,height:32,channels:3,background:'#437690'}}).png().withMetadata().toBuffer();
  const image=await optimiseWallpaper(payload(original));const info=await sharp(image.data).metadata();
  assert.equal(info.format,'webp');assert.equal(info.width,48);assert.equal(info.height,32);assert.equal(info.exif,undefined);
  assert.equal(image.version.length,64);assert.ok(image.data.length<2_000_000);assert.notDeepEqual(image.data,original);
});
test('large-dimension images within the input limit are resized',async()=>{
  const bytes=await sharp({create:{width:2100,height:60,channels:3,background:'#eeeeff'}}).jpeg().toBuffer();
  const image=await optimiseWallpaper(payload(bytes,'image/jpeg'));assert.equal(image.width,2048);assert.ok(image.height<=60);
});
test('wallpaper encoding is deterministic for replayed input',async()=>{
  const bytes=await sharp({create:{width:16,height:16,channels:3,background:'red'}}).webp().toBuffer();
  const a=await optimiseWallpaper(payload(bytes,'image/webp')),b=await optimiseWallpaper(payload(bytes,'image/webp'));assert.equal(a.version,b.version);
});
test('valid magic bytes with corrupt pixel data are rejected',async()=>{
  await assert.rejects(()=>optimiseWallpaper(payload(Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0]))));
});
