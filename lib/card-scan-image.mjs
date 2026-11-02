import sharp from 'sharp';
import { AppError,ensure } from './errors.mjs';
export async function prepareScanImage(bytes) {
  try {
    const image=sharp(bytes,{limitInputPixels:16_000_000,failOn:'error',animated:false});
    const info=await image.metadata();
    ensure(['jpeg','png','webp'].includes(info.format)&&(!info.pages||info.pages===1)&&info.width>=160&&info.height>=160,400,'Unsupported scan image.');
    // Decode limits bound memory; re-encoding strips EXIF and other metadata.
    return await image.rotate().resize({width:1600,height:1600,fit:'inside',withoutEnlargement:true}).jpeg({quality:88}).toBuffer();
  } catch {throw new AppError(400,'Use a clear single-card JPEG, PNG or WebP photo, up to 16 megapixels.');}
}
export async function prepareScanImages(bytes) {
  const image=await prepareScanImage(bytes);
  const {width,height}=await sharp(image).metadata();
  // Keep the entire lower edge: modern cards print IDs on the left, while
  // older layouts may use the right. Both views come from the same clean photo.
  const top=Math.floor(height*0.6);
  const identificationImage=await sharp(image).extract({left:0,top,width,height:height-top}).jpeg({quality:92}).toBuffer();
  return {image,identificationImage};
}
