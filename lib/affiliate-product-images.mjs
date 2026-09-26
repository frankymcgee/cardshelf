import {randomUUID} from 'node:crypto';
import {db,audit} from './db.mjs';
import {rateLimit} from './auth.mjs';
import {AppError,ensure} from './errors.mjs';
import * as v from './validate.mjs';
import {affiliateShopActive} from '../shared/affiliate-shops.mjs';

export const AFFILIATE_IMAGE_INPUT_LIMIT=1024*1024;
let processing=0;
export async function optimiseAffiliateImage(input){
  const data=v.object(input);
  ensure(Object.keys(data).every(key=>['image_base64','content_type'].includes(key)),400,'Unsupported image field.');
  const format={'image/jpeg':'jpeg','image/png':'png','image/webp':'webp'}[data.content_type];
  ensure(format,415,'Choose a JPEG, PNG or WebP image.');
  ensure(typeof data.image_base64==='string'&&data.image_base64.length>0,400,'Choose a product image.');
  ensure(data.image_base64.length<=Math.ceil(AFFILIATE_IMAGE_INPUT_LIMIT/3)*4,413,'Choose an image no larger than 1 MB.');
  ensure(data.image_base64.length%4===0&&/^[A-Za-z0-9+/]+={0,2}$/.test(data.image_base64),400,'Invalid image encoding.');
  const bytes=Buffer.from(data.image_base64,'base64');
  ensure(bytes.toString('base64')===data.image_base64,400,'Invalid image encoding.');
  ensure(bytes.length>0&&bytes.length<=AFFILIATE_IMAGE_INPUT_LIMIT,413,'Choose an image no larger than 1 MB.');
  const signature=format==='png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):
    format==='jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
  ensure(signature,415,'The image contents do not match its JPEG, PNG or WebP format.');
  ensure(processing<2,429,'The image processor is busy. Try again shortly.');processing++;
  try{
    const {default:sharp}=await import('sharp');
    const image=sharp(bytes,{failOn:'warning',limitInputPixels:12_000_000});
    const metadata=await image.metadata();
    ensure(metadata.format===format&&(metadata.pages||1)===1,415,'Use a still JPEG, PNG or WebP image.');
    ensure(metadata.width>0&&metadata.height>0&&metadata.width<=6000&&metadata.height<=6000,400,'Image dimensions are too large.');
    // Serve decoded pixels only, stripping filenames, embedded metadata and GPS.
    const {data:content,info}=await image.rotate().resize({width:1200,height:1200,fit:'inside',withoutEnlargement:true})
      .webp({quality:80,effort:3}).timeout({seconds:10}).toBuffer({resolveWithObject:true});
    ensure(content.length<=524288,413,'The optimised image is too large. Choose a smaller image.');
    return {content,width:info.width,height:info.height};
  }catch(error){
    if(error instanceof AppError)throw error;
    throw new AppError(400,'This image could not be decoded. Use a still JPEG, PNG or WebP under 1 MB and 12 megapixels.');
  }finally{processing--;}
}

// Called with the affiliate settings row locked, also used by save operations.
// Keep recent unattached uploads so another administrator's draft is preserved.
export async function pruneAffiliateImages(sql){
  await sql`DELETE FROM affiliate_product_images AS image WHERE created_at < now()-interval '24 hours'
    AND NOT EXISTS (SELECT 1 FROM affiliate_shop_settings, jsonb_array_elements(shops) AS entry
      WHERE singleton AND entry->>'image_id'=image.id::text)`;
}
export async function uploadAffiliateImage(actorId,input){
  const id=v.uuid(actorId);
  await rateLimit('affiliate-product-image:'+id,30);
  const [actor]=await db()`SELECT role FROM app_users WHERE id=${id}`;
  ensure(actor?.role==='admin',403,'Administrator access is required.');
  const image=await optimiseAffiliateImage(input),imageId=randomUUID();
  return db().begin(async sql=>{
    const [current]=await sql`SELECT role FROM app_users WHERE id=${id} FOR UPDATE`;
    ensure(current?.role==='admin',403,'Administrator access changed. Sign in again.');
    await sql`SELECT singleton FROM affiliate_shop_settings WHERE singleton FOR UPDATE`;
    await pruneAffiliateImages(sql);
    // Bound abandoned drafts even if someone keeps uploading without saving.
    const [count]=await sql`SELECT count(*)::integer AS count FROM affiliate_product_images`;
    ensure(count.count<120,409,'Too many pending product images. Save the images you want to keep; unused uploads are cleared after 24 hours on the next upload or save.');
    await sql`INSERT INTO affiliate_product_images(id,content,width,height,uploaded_by)
      VALUES(${imageId},${image.content},${image.width},${image.height},${id})`;
    await audit(sql,id,'affiliate.product_image_uploaded',{image_id:imageId});
    return {id:imageId,width:image.width,height:image.height};
  });
}
export async function affiliateProductImage(imageId,admin=false,sql=db()){
  const id=v.uuid(imageId,'Image');
  const [row]=await sql`SELECT image.content,settings.enabled,settings.shops
    FROM affiliate_product_images AS image CROSS JOIN affiliate_shop_settings AS settings
    WHERE image.id=${id} AND settings.singleton`;
  ensure(row&&(admin||(row.enabled&&row.shops.some(shop=>shop.kind==='product'&&shop.image_id===id&&affiliateShopActive(shop)))),404,'Product image is not available.');
  return row.content;
}
