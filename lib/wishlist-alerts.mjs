import { db, collectionLock } from './db.mjs';
import { ensure } from './errors.mjs';
import { requirePrintingGame } from './game-access.mjs';
import { membershipState, requireCapability } from './membership.mjs';
import { displayPrice, quoteForPrinting } from './price-logic.mjs';
import * as v from './validate.mjs';

export async function saveWishlistAlert(userId,input) {
  const o=v.object(input),printingId=v.uuid(o.printing_id),revision=v.integer(o.revision,'Revision',0,2147483647);
  const target=v.integer(o.target_aud_minor,'Target price',1,100000000),enabled=v.bool(o.enabled??true,'Enabled');
  const market=v.bool(o.watch_market,'Watch market prices'),listings=v.bool(o.watch_listings,'Watch member listings');
  ensure(market||listings,400,'Select market prices or member listings.');
  ensure(Array.isArray(o.conditions)&&o.conditions.length>0&&o.conditions.length<=6,400,'Select at least one listing condition.');
  const conditions=[...new Set(o.conditions.map(c=>v.oneOf(c,'Condition',v.CONDITIONS)))].sort();
  return db().begin(async sql=>{
    await collectionLock(sql,userId);await requirePrintingGame(sql,userId,printingId);
    const {access}=await membershipState(userId,sql);
    ensure(['collection','prices'].every(code=>access.features.some(f=>f.code===code)),403,'Wishlist alerts require collection and price access.');
    if(enabled) {
      ensure((await sql`SELECT printing_id FROM collection_entries WHERE user_id=${userId} AND printing_id=${printingId} AND wishlist LIMIT 1`).length,409,'Add this printing to your wishlist before enabling an alert.');
      ensure((await sql`SELECT id FROM printings WHERE id=${printingId} AND catalogue_available`).length,409,'This printing has been retired from catalogue choices.');
    }
    const [old]=await sql`SELECT * FROM wishlist_alerts WHERE user_id=${userId} AND printing_id=${printingId} FOR UPDATE`;
    ensure((old?.revision??0)===revision,409,'This alert changed. Reload it before saving.');
    if(old && old.target_aud_minor===target&&old.enabled===enabled&&old.watch_market===market&&old.watch_listings===listings&&JSON.stringify(old.conditions)===JSON.stringify(conditions)) return old;
    const [row]=await sql`INSERT INTO wishlist_alerts(user_id,printing_id,target_aud_minor,watch_market,watch_listings,conditions,enabled)
      VALUES(${userId},${printingId},${target},${market},${listings},${conditions},${enabled}) ON CONFLICT(user_id,printing_id) DO UPDATE SET target_aud_minor=excluded.target_aud_minor,watch_market=excluded.watch_market,watch_listings=excluded.watch_listings,conditions=excluded.conditions,enabled=excluded.enabled,revision=wishlist_alerts.revision+1,checked_at=NULL,market_matched=false RETURNING *`;
    return row;
  });
}
/** @param {string} userId @param {string | null} [printingInput] */
export async function wishlistAlerts(userId,printingInput=null) {
  await requireCapability(userId,'prices');
  const printingId=printingInput?v.uuid(printingInput):null;
  const sql=db();
  const rules=await sql`SELECT a.*,p.label,c.name,c.id AS card_id,c.language,s.name AS set_name,
    EXISTS(SELECT 1 FROM collection_entries e WHERE e.user_id=a.user_id AND e.printing_id=a.printing_id AND e.wishlist) AS wishlisted,p.catalogue_available
    FROM wishlist_alerts a JOIN printings p ON p.id=a.printing_id JOIN cards c ON c.id=p.card_id JOIN card_sets s ON s.id=c.set_id
    WHERE a.user_id=${userId} ${printingId?sql`AND a.printing_id=${printingId}`:sql``} ORDER BY a.created_at DESC LIMIT 500`;
  const events=printingId?[]:await sql`SELECT e.id,e.kind,e.amount_aud_minor,e.target_aud_minor,e.seen_at,e.created_at,e.listing_id,a.printing_id,c.name,c.id AS card_id,p.label,
    coalesce(l.status='active' AND NOT l.hidden,false) AS listing_active FROM wishlist_alert_events e JOIN wishlist_alerts a ON a.id=e.alert_id JOIN printings p ON p.id=a.printing_id JOIN cards c ON c.id=p.card_id LEFT JOIN marketplace_listings l ON l.id=e.listing_id WHERE e.user_id=${userId} ORDER BY e.created_at DESC,e.id DESC LIMIT 100`;
  const [{unread}]=await sql`SELECT count(*)::integer AS unread FROM wishlist_alert_events WHERE user_id=${userId} AND seen_at IS NULL`;
  return {rules,events,unread};
}
export async function markWishlistAlertSeen(userId,idInput) {
  const id=v.uuid(idInput);
  const [row]=await db()`UPDATE wishlist_alert_events SET seen_at=coalesce(seen_at,now()) WHERE id=${id} AND user_id=${userId} RETURNING id`;
  ensure(row,404,'Alert not found.');return {seen:true};
}
export async function evaluateWishlistAlert(idInput) {
  const id=v.uuid(idInput),[owner]=await db()`SELECT user_id FROM wishlist_alerts WHERE id=${id}`;
  if(!owner) return;
  return db().begin(async sql=>{
    await collectionLock(sql,owner.user_id);
    const [a]=await sql`SELECT a.*,p.key,p.source,p.catalogue_available,c.language,c.game,pc.quotes,pc.fetched_at,pc.last_error FROM wishlist_alerts a JOIN printings p ON p.id=a.printing_id JOIN cards c ON c.id=p.card_id LEFT JOIN card_price_cache pc ON pc.card_id=c.id WHERE a.id=${id} FOR UPDATE OF a`;
    if(!a?.enabled || (a.checked_at && Date.now()-new Date(a.checked_at).getTime()<60000)) return;
    await sql`UPDATE wishlist_alerts SET checked_at=now() WHERE id=${id}`;
    if(!a.catalogue_available || !(await sql`SELECT printing_id FROM collection_entries WHERE user_id=${a.user_id} AND printing_id=${a.printing_id} AND wishlist LIMIT 1`).length) return;
    const {access}=await membershipState(a.user_id,sql);
    if(!['collection','prices'].every(code=>access.features.some(f=>f.code===code))) return;
    try { await requirePrintingGame(sql,a.user_id,a.printing_id); } catch(error) { if(error.status===403) return; throw error; }
    if(a.watch_market && a.language==='en' && process.env.PRICE_TRACKING_ENABLED!=='false') {
      const rates=await sql`SELECT * FROM price_fx_rates`,price=displayPrice(quoteForPrinting(a,a.quotes??[]),a,rates);
      // An absent/stale/approximate quote cannot trigger or re-arm a market alert.
      if(price && !price.stale && !price.fetch_error && price.aud!==null) {
        const amount=Math.round(price.aud*100),matched=amount>0&&amount<=a.target_aud_minor;
        if(matched&&!a.market_matched) {
          const cycle=a.market_cycle+1;
          await sql`INSERT INTO wishlist_alert_events(user_id,alert_id,kind,amount_aud_minor,target_aud_minor,event_key) VALUES(${a.user_id},${id},'market',${amount},${a.target_aud_minor},${id+':'+a.revision+':market:'+cycle}) ON CONFLICT(event_key) DO NOTHING`;
          await sql`UPDATE wishlist_alerts SET market_matched=true,market_cycle=${cycle} WHERE id=${id}`;
        } else if(!matched&&a.market_matched) await sql`UPDATE wishlist_alerts SET market_matched=false WHERE id=${id}`;
      }
    }
    if(a.watch_listings && access.features.some(f=>f.code==='marketplace_browse')) {
      const listings=await sql`SELECT l.id,l.price_minor+l.postage_minor AS amount FROM marketplace_listings l
        WHERE l.printing_id=${a.printing_id} AND l.seller_id<>${a.user_id} AND l.status='active' AND NOT l.hidden AND l.condition IN ${sql(a.conditions)} AND l.price_minor+l.postage_minor<=${a.target_aud_minor}
        AND NOT EXISTS(SELECT 1 FROM wishlist_alert_events e WHERE e.event_key=${id+':'+a.revision+':listing:'}||l.id::text) ORDER BY l.price_minor+l.postage_minor,l.id LIMIT 5`;
      for(const l of listings) await sql`INSERT INTO wishlist_alert_events(user_id,alert_id,kind,amount_aud_minor,target_aud_minor,listing_id,event_key) VALUES(${a.user_id},${id},'listing',${l.amount},${a.target_aud_minor},${l.id},${id+':'+a.revision+':listing:'+l.id}) ON CONFLICT(event_key) DO NOTHING`;
    }
  });
}
export async function checkWishlistAlerts() {
  const due=await db()`SELECT id FROM wishlist_alerts WHERE enabled AND (checked_at IS NULL OR checked_at<now()-interval '1 minute') ORDER BY checked_at NULLS FIRST,id LIMIT 100`;
  for(const row of due) await evaluateWishlistAlert(row.id);
}
