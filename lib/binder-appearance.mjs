import { db, audit } from './db.mjs';
import { ensure } from './errors.mjs';
import * as v from './validate.mjs';
import { appearanceInput } from './appearance-validation.mjs';
import { optimiseWallpaper } from './wallpaper-image.mjs';
async function checkBinder(sql,userId,id,revision,lock=false) {
  const [binder]=await sql`SELECT id,color,revision,wallpaper_version FROM binders WHERE id=${id} AND user_id=${userId} ${lock?sql`FOR UPDATE`:sql``}`;
  ensure(binder,404,'Binder not found.');
  ensure(binder.revision===revision,409,'This binder changed in another session. Reopen Appearance before saving.');
  return binder;
}
export async function saveAppearance(userId,idInput,input) {
  const id=v.uuid(idInput),o=v.object(input),revision=v.integer(o.revision,'Revision',1,Number.MAX_SAFE_INTEGER);
  ensure(Object.keys(o).every(key=>['revision','appearance','wallpaper','remove_wallpaper'].includes(key)),400,'Unsupported appearance request field.');
  const sql=db(),current=await checkBinder(sql,userId,id,revision);
  const appearance=appearanceInput(o.appearance,current.color),remove=v.bool(o.remove_wallpaper??false,'Remove wallpaper');
  ensure(!(remove&&o.wallpaper),400,'Choose upload or remove wallpaper, not both.');
  const image=o.wallpaper?await optimiseWallpaper(o.wallpaper):null;
  ensure(appearance.mode!=='image'||image||(!remove&&current.wallpaper_version),400,'Upload a wallpaper or select Solid colour.');
  return sql.begin(async tx=>{
    const binder=await checkBinder(tx,userId,id,revision,true);
    if(remove) await tx`DELETE FROM binder_wallpapers WHERE binder_id=${id}`;
    if(image) await tx`INSERT INTO binder_wallpapers(binder_id,data,width,height) VALUES(${id},${image.data},${image.width},${image.height})
      ON CONFLICT(binder_id) DO UPDATE SET data=excluded.data,width=excluded.width,height=excluded.height,updated_at=now()`;
    const version=image?image.version:remove?null:binder.wallpaper_version;
    const [updated]=await tx`UPDATE binders SET appearance=${tx.json(appearance)},wallpaper_version=${version},revision=revision+1,updated_at=now()
      WHERE id=${id} RETURNING id,appearance,wallpaper_version,revision`;
    await audit(tx,userId,'binder.appearance',{binder_id:id,wallpaper_changed:!!image||remove});
    return updated;
  });
}
export async function ownerWallpaper(userId,idInput) {
  const id=v.uuid(idInput);
  const [row]=await db()`SELECT w.data FROM binder_wallpapers w JOIN binders b ON b.id=w.binder_id WHERE b.id=${id} AND b.user_id=${userId}`;
  ensure(row,404,'Wallpaper not found.');return row.data;
}
export async function sharedWallpaper(token) {
  ensure(typeof token==='string'&&/^[a-f0-9]{64}$/.test(token),404,'Shared wallpaper not found.');
  const [row]=await db()`SELECT w.data FROM binder_wallpapers w JOIN binders b ON b.id=w.binder_id WHERE b.share_token=${token} AND b.appearance->>'mode'='image'`;
  ensure(row,404,'Shared wallpaper not found.');return row.data;
}
