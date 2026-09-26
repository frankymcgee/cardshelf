import { db,audit } from './db.mjs';
import { rateLimit } from './auth.mjs';
import { verifyPassword } from './security.mjs';
import { ensure } from './errors.mjs';
import * as v from './validate.mjs';
import { GAME_CODES } from '../shared/games.mjs';
import { AFFILIATE_PLACEMENTS,affiliateUrl,affiliateShopActive,amazonUrl } from '../shared/affiliate-shops.mjs';

function keys(value,allowed){const o=v.object(value);ensure(Object.keys(o).every(key=>allowed.includes(key)),400,'Unsupported affiliate settings field.');return o;}
function choices(value,allowed,name,min=0){ensure(Array.isArray(value)&&value.length>=min&&value.length<=allowed.length&&new Set(value).size===value.length&&value.every(item=>allowed.includes(item)),400,'Choose valid '+name+'.');return value;}
export function affiliateSettingsInput(input){
  const o=keys(input,['enabled','shops','revision','password']);
  ensure(Array.isArray(o.shops)&&o.shops.length<=12,400,'Add up to 12 affiliate shops.');
  const ids=new Set();
  const shops=o.shops.map(value=>{
    const s=keys(value,['id','name','description','url','search_url','referral_code','enabled','placements','games','expires_on','retailer']);
    const id=v.uuid(s.id);ensure(!ids.has(id),400,'Shop identifiers must be unique.');ids.add(id);
    const url=v.text(s.url,'Shop link',1,2048),search=v.text(s.search_url??'','Search link',0,2048);
    ensure(affiliateUrl(url),400,'Enter a public HTTPS shop link without credentials or placeholders.');
    ensure(!search||affiliateUrl(search,true),400,'Search links must be public HTTPS URLs with {query} in the path or query, not the hostname.');
    const selectedRetailer=v.oneOf(s.retailer??'other','Retailer',['other','amazon']);
    const retailer=amazonUrl(url)||amazonUrl(search)?'amazon':selectedRetailer;
    if(retailer==='amazon'){
      ensure(amazonUrl(url),400,'Use the Amazon or Amazon short link supplied by Associates.');
      ensure(!search,400,'Paste the complete Amazon Associates link as the shop URL and leave the search template blank.');
      ensure(!s.referral_code,400,'Amazon tracking IDs belong in the supplied link, not the coupon-code field.');
    }
    const expires=v.text(s.expires_on??'','Expiry date',0,10);
    ensure(!expires||(/^\d{4}-\d{2}-\d{2}$/.test(expires)&&!Number.isNaN(Date.parse(expires))&&new Date(expires).toISOString().slice(0,10)===expires),400,'Enter a valid expiry date.');
    return {id,retailer,name:v.text(s.name,'Shop name',1,60),description:v.text(s.description??'','Description',0,180),url,search_url:search,
      referral_code:v.text(s.referral_code??'','Referral code',0,80),enabled:v.bool(s.enabled,'Shop enabled'),
      placements:choices(s.placements,AFFILIATE_PLACEMENTS,'placements',1),games:choices(s.games,GAME_CODES,'games'),expires_on:expires};
  });
  ensure(typeof o.password==='string'&&o.password.length<=128,400,'Enter your administrator password.');
  return {enabled:v.bool(o.enabled,'Affiliate links enabled'),shops,revision:v.integer(o.revision,'Revision',1,2147483647),password:o.password};
}
export async function affiliateSettings(sql=db()){
  const [row]=await sql`SELECT enabled,shops,revision,updated_at FROM affiliate_shop_settings WHERE singleton`;
  ensure(row,503,'Apply the affiliate-shop migration.');return row;
}
export async function publicAffiliateShops(sql=db()){
  const settings=await affiliateSettings(sql);
  return {shops:settings.enabled?settings.shops.filter(shop=>affiliateShopActive(shop)).map(({id,retailer,name,description,url,search_url,referral_code,enabled,placements,games,expires_on})=>
    ({id,retailer,name,description,url,search_url,referral_code,enabled,placements,games,expires_on})):[]};
}
export async function saveAffiliateSettings(actorId,input){
  const data=affiliateSettingsInput(input);
  await rateLimit('affiliate-shops-admin:'+actorId,15);
  const [actor]=await db()`SELECT role,password_hash FROM app_users WHERE id=${v.uuid(actorId)}`;
  ensure(actor?.role==='admin'&&await verifyPassword(data.password,actor.password_hash),403,'Confirm your current administrator password.');
  return db().begin(async sql=>{
    const [currentActor]=await sql`SELECT role,password_hash FROM app_users WHERE id=${actorId} FOR UPDATE`;
    ensure(currentActor?.role==='admin'&&currentActor.password_hash===actor.password_hash,403,'Administrator credentials changed. Sign in again.');
    const [saved]=await sql`UPDATE affiliate_shop_settings SET enabled=${data.enabled},shops=${sql.json(data.shops)},revision=revision+1,updated_at=now(),updated_by=${actorId}
      WHERE singleton AND revision=${data.revision} RETURNING enabled,shops,revision,updated_at`;
    ensure(saved,409,'Affiliate settings changed. Reload before saving.');
    await audit(sql,actorId,'affiliate.settings_saved',{enabled:data.enabled,shop_ids:data.shops.map(s=>s.id),active_shops:data.shops.filter(s=>s.enabled).length});
    return saved;
  });
}
