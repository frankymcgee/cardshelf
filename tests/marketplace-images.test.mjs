import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { salePhotos } from '../lib/marketplace-images.mjs';
async function fixture(){const bytes=await sharp({create:{width:40,height:56,channels:3,background:'#559988'}}).jpeg().toBuffer();return ['front','back'].map(side=>({side,content_type:'image/jpeg',data_base64:bytes.toString('base64')}))}
test('sale photos are decoded and re-encoded as bounded WebP without metadata',async()=>{const images=await salePhotos(await fixture());assert.equal(images.length,2);for(const p of images){const meta=await sharp(p.data).metadata();assert.equal(meta.format,'webp');assert.ok(p.data.length<=1000000);assert.equal(meta.exif,undefined);assert.equal(meta.xmp,undefined)}});
test('duplicate sides cannot replace missing card evidence',async()=>{const photos=await fixture();photos[1].side='front';await assert.rejects(()=>salePhotos(photos),/one front and one back/)});
test('magic bytes without a decodable image are rejected',async()=>{const photos=await fixture();photos[0].data_base64=Buffer.from([255,216,255,0,0,0]).toString('base64');await assert.rejects(()=>salePhotos(photos),/could not be decoded/)});
test('large sale images are bounded to 1600 pixels',async()=>{const bytes=await sharp({create:{width:3000,height:2000,channels:3,background:'#555555'}}).png().toBuffer();const output=await salePhotos(['front','back'].map(side=>({side,content_type:'image/png',data_base64:bytes.toString('base64')})));assert.equal((await sharp(output[0].data).metadata()).width,1600)});
