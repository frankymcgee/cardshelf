import { ensure } from './errors.mjs';
import * as v from './validate.mjs';
import { appearanceDefaults, EFFECT_MODES, WALLPAPER_FITS, isHexColour } from '../shared/appearance.mjs';
export const MAX_WALLPAPER_BYTES = 5_000_000;
export function appearanceInput(input, colour) {
  const o = v.object(input, 'Appearance'), defaults = appearanceDefaults(colour);
  ensure(Object.keys(o).every(key => Object.hasOwn(defaults,key)),400,'Appearance contains an unsupported setting.');
  const result = {};
  for (const [key,fallback] of Object.entries(defaults)) {
    const value = o[key] ?? fallback;
    if (key.endsWith('_color')) { ensure(isHexColour(value),400,'Choose a valid six-digit colour.'); result[key]=value.toLowerCase(); }
    else if (key==='mode'||key==='cover_mode') result[key]=v.oneOf(value,'Background',['color','image']);
    else if (key.endsWith('wallpaper_fit')) result[key]=v.oneOf(value,'Image fit',WALLPAPER_FITS);
    else if (key==='effects_mode') result[key]=v.oneOf(value,'Variant effects',EFFECT_MODES);
    else if (typeof fallback==='boolean') result[key]=v.bool(value,key);
    else result[key]=v.integer(value,key,0,key.endsWith('wallpaper_blur')?12:100);
  }
  return result;
}
export function decodeWallpaper(input) {
  const o = v.object(input,'Wallpaper');
  const type=v.oneOf(o.content_type,'Wallpaper type',['image/jpeg','image/png','image/webp']);
  ensure(typeof o.data_base64==='string' && o.data_base64.length>0 && o.data_base64.length<=Math.ceil(MAX_WALLPAPER_BYTES/3)*4,413,'Choose a wallpaper smaller than 5 MB.');
  ensure(o.data_base64.length%4===0 && /^[A-Za-z0-9+/]*={0,2}$/.test(o.data_base64),400,'Wallpaper data is not valid base64.');
  const bytes=Buffer.from(o.data_base64,'base64');
  ensure(bytes.toString('base64')===o.data_base64,400,'Wallpaper data is not canonical base64.');
  ensure(bytes.length<=MAX_WALLPAPER_BYTES,413,'Choose a wallpaper smaller than 5 MB.');
  const png=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  const jpeg=bytes[0]===255 && bytes[1]===216 && bytes[2]===255;
  const webp=bytes.toString('ascii',0,4)==='RIFF' && bytes.toString('ascii',8,12)==='WEBP';
  ensure((type==='image/png'&&png)||(type==='image/jpeg'&&jpeg)||(type==='image/webp'&&webp),415,'The file content does not match its image type. Use JPEG, PNG or WebP.');
  return {bytes,type};
}
