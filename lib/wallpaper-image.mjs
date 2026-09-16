import { createHash } from 'node:crypto';
import { ensure, AppError } from './errors.mjs';
import { decodeWallpaper } from './appearance-validation.mjs';
// Bounded per-process decoding, in addition to per-user API throttling.
let active = 0;
export async function optimiseWallpaper(input) {
  const {bytes,type}=decodeWallpaper(input);
  ensure(active<2,429,'Two wallpapers are already being processed. Try again shortly.');
  active++;
  try {
    const {default:sharp}=await import('sharp');
    const options={limitInputPixels:20_000_000,failOn:'warning'};
    const metadata=await sharp(bytes,options).metadata();
    ensure(metadata.format===({'image/jpeg':'jpeg','image/png':'png','image/webp':'webp'}[type]),415,'Unsupported wallpaper format.');
    ensure((metadata.pages??1)===1,400,'Use a still wallpaper, not an animated image.');
    ensure(metadata.width>0&&metadata.height>0,400,'The image has invalid dimensions.');
    // Decode and re-encode instead of serving original upload bytes; metadata is stripped.
    const {data,info}=await sharp(bytes,options).rotate().resize({width:2048,height:2048,fit:'inside',withoutEnlargement:true})
      .webp({quality:80,effort:3}).timeout({seconds:10}).toBuffer({resolveWithObject:true});
    ensure(data.length<=2_000_000,413,'The optimised wallpaper is too large. Choose a smaller image.');
    return {data,width:info.width,height:info.height,version:createHash('sha256').update(data).digest('hex')};
  } catch(error) {
    if(error instanceof AppError) throw error;
    throw new AppError(400,'This image could not be decoded. Use a valid still JPEG, PNG or WebP under 5 MB and 20 megapixels.');
  } finally {active--;}
}
