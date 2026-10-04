import { requireGame } from './game-access.mjs';
import { db, audit, collectionLock } from './db.mjs';
import { ensure } from './errors.mjs';
import * as v from './validate.mjs';
import { appearanceInput } from './appearance-validation.mjs';
import { optimiseWallpaper } from './wallpaper-image.mjs';
import { isHexColour, resolvedAppearance } from '../shared/appearance.mjs';
async function checkBinder(sql,userId,id,revision,lock=false) {
  if(lock) await collectionLock(sql,userId);
  const [binder]=await sql`SELECT game,id,color,revision,appearance,wallpaper_version,cover_wallpaper_version,binder_type FROM binders WHERE id=${id} AND user_id=${userId} ${lock?sql`FOR UPDATE`:sql``}`;
  ensure(binder,404,'Binder not found.');
  await requireGame(sql,userId,binder.game);
  ensure(binder.binder_type==='collection',400,'Tracking binders use a simple checklist appearance. Use a Collection binder for custom themes.');
  ensure(binder.revision===revision,409,'This binder changed in another session. Reopen Appearance before saving.');
  return binder;
}
export async function saveAppearance(userId,idInput,input) {
  const id=v.uuid(idInput),o=v.object(input),revision=v.integer(o.revision,'Revision',1,Number.MAX_SAFE_INTEGER);
  ensure(Object.keys(o).every(key=>['revision','appearance','wallpaper','remove_wallpaper','cover_color','cover_wallpaper','remove_cover_wallpaper'].includes(key)),400,'Unsupported appearance request field.');
  const sql=db(),current=await checkBinder(sql,userId,id,revision);
  // Preserve settings omitted by older clients, and freeze the existing interior
  // fallback before changing the independent cover colour.
  const appearance=appearanceInput({...resolvedAppearance(current.appearance,current.color),...v.object(o.appearance,'Appearance')},current.color);
  const colour=o.cover_color??current.color;
  ensure(isHexColour(colour),400,'Choose a valid six-digit cover colour.');
  const remove=v.bool(o.remove_wallpaper??false,'Remove wallpaper');
  const removeCover=v.bool(o.remove_cover_wallpaper??false,'Remove cover wallpaper');
  ensure(!(remove&&o.wallpaper),400,'Choose upload or remove wallpaper, not both.');
  ensure(!(removeCover&&o.cover_wallpaper),400,'Choose upload or remove cover wallpaper, not both.');
  const image=o.wallpaper?await optimiseWallpaper(o.wallpaper):null;
  const coverImage=o.cover_wallpaper?await optimiseWallpaper(o.cover_wallpaper):null;
  ensure(appearance.mode!=='image'||image||(!remove&&current.wallpaper_version),400,'Upload a wallpaper or select Solid colour.');
  ensure(appearance.cover_mode!=='image'||coverImage||(!removeCover&&current.cover_wallpaper_version),400,'Upload a cover wallpaper or select Solid colour for the outside cover.');
  return sql.begin(async tx=>{
    const binder=await checkBinder(tx,userId,id,revision,true);
    if(remove) await tx`DELETE FROM binder_wallpapers WHERE binder_id=${id}`;
    if(image) await tx`INSERT INTO binder_wallpapers(binder_id,data,width,height) VALUES(${id},${image.data},${image.width},${image.height})
      ON CONFLICT(binder_id) DO UPDATE SET data=excluded.data,width=excluded.width,height=excluded.height,updated_at=now()`;
    if(removeCover) await tx`DELETE FROM binder_cover_wallpapers WHERE binder_id=${id}`;
    if(coverImage) await tx`INSERT INTO binder_cover_wallpapers(binder_id,data,width,height) VALUES(${id},${coverImage.data},${coverImage.width},${coverImage.height})
      ON CONFLICT(binder_id) DO UPDATE SET data=excluded.data,width=excluded.width,height=excluded.height,updated_at=now()`;
    const version=image?image.version:remove?null:binder.wallpaper_version;
    const coverVersion=coverImage?coverImage.version:removeCover?null:binder.cover_wallpaper_version;
    const [updated]=await tx`UPDATE binders SET color=${colour.toLowerCase()},appearance=${tx.json(appearance)},wallpaper_version=${version},
      cover_wallpaper_version=${coverVersion},revision=revision+1,updated_at=now()
      WHERE id=${id} RETURNING id,color,appearance,wallpaper_version,cover_wallpaper_version,revision`;
    await audit(tx,userId,'binder.appearance',{binder_id:id,wallpaper_changed:!!image||remove,cover_wallpaper_changed:!!coverImage||removeCover});
    return updated;
  });
}
export async function ownerWallpaper(userId,idInput,surface='inside') {
  const id=v.uuid(idInput);
  const sql=db(),table=surface==='cover'?'binder_cover_wallpapers':'binder_wallpapers';
  const [row]=await sql`SELECT w.data FROM ${sql(table)} w JOIN binders b ON b.id=w.binder_id WHERE b.id=${id} AND b.user_id=${userId}`;
  ensure(row,404,'Wallpaper not found.');return row.data;
}
export async function sharedWallpaper(token,surface='inside') {
  ensure(typeof token==='string'&&/^[a-f0-9]{64}$/.test(token),404,'Shared wallpaper not found.');
  const sql=db(),table=surface==='cover'?'binder_cover_wallpapers':'binder_wallpapers',mode=surface==='cover'?'cover_mode':'mode';
  const [row]=await sql`SELECT w.data FROM ${sql(table)} w JOIN binders b ON b.id=w.binder_id WHERE b.share_token=${token} AND b.appearance->>${mode}='image'`;
  ensure(row,404,'Shared wallpaper not found.');return row.data;
}
