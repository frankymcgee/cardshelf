import { db } from './db.mjs';
import { ensure } from './errors.mjs';
import * as v from './validate.mjs';
import { extractPricing,quoteForPrinting,displayPrice,valueRows } from './price-logic.mjs';
export function pricingConfiguration() {
  const n=Number(process.env.PRICE_REFRESH_HOURS);
  return {enabled:process.env.PRICE_TRACKING_ENABLED!=='false',hours:Number.isFinite(n)&&n>=1?Math.min(168,n):6,batch:100};
}
export async function fxRates() { return db()`SELECT currency,aud_rate,rate_date,fetched_at FROM price_fx_rates ORDER BY currency`; }
export async function storePricing(cardId,pricing) {
  const {quotes,references}=extractPricing(pricing);
  await db().begin(async sql=> {
    await sql`INSERT INTO card_price_cache(card_id,quotes,reference_prices,fetched_at,attempted_at,next_attempt_at,last_error)
      VALUES(${cardId},${sql.json(quotes)},${sql.json(references)},now(),now(),now()+(${pricingConfiguration().hours}*interval '1 hour'),'')
      ON CONFLICT(card_id) DO UPDATE SET quotes=excluded.quotes,reference_prices=excluded.reference_prices,
        fetched_at=now(),attempted_at=now(),next_attempt_at=excluded.next_attempt_at,last_error=''`;
    for(const q of [...quotes,...references].filter(q=>q.source_updated_at)) await sql`INSERT INTO card_price_history
      (card_id,source,variant,currency,metric,amount,source_updated_at)
      VALUES(${cardId},${q.source},${q.variant},${q.currency},${q.metric},${q.amount},${q.source_updated_at})
      ON CONFLICT(card_id,source,variant,currency,metric,source_updated_at) DO UPDATE SET amount=excluded.amount`;
  });
}
export async function priceFailure(cardId,error) {
  await db()`INSERT INTO card_price_cache(card_id,attempted_at,next_attempt_at,last_error)
    VALUES(${cardId},now(),now()+interval '1 hour',${String(error?.message??error).slice(0,500)})
    ON CONFLICT(card_id) DO UPDATE SET attempted_at=now(),next_attempt_at=now()+interval '1 hour',last_error=excluded.last_error`;
}
export async function cardsDue(cardId=null) {
  const sql=db();
  if(cardId) return sql`SELECT c.id,c.provider_id,c.language FROM cards c LEFT JOIN card_price_cache pc ON pc.card_id=c.id
    WHERE c.id=${cardId} AND (pc.attempted_at IS NULL OR pc.attempted_at<now()-interval '1 hour')`;
  return sql`WITH tracked AS (
    SELECT p.card_id FROM collection_entries e JOIN printings p ON p.id=e.printing_id WHERE e.quantity>0 OR e.wishlist
    UNION SELECT p.card_id FROM binder_slots s JOIN printings p ON p.id=s.printing_id
  ) SELECT c.id,c.provider_id,c.language FROM tracked t JOIN cards c ON c.id=t.card_id
    LEFT JOIN card_price_cache pc ON pc.card_id=c.id WHERE pc.next_attempt_at IS NULL OR pc.next_attempt_at<=now()
    ORDER BY pc.next_attempt_at ASC NULLS FIRST,c.id LIMIT ${pricingConfiguration().batch}`;
}
export async function queuePriceRefresh(userId,cardId=null) {
  ensure(pricingConfiguration().enabled,409,'Price tracking is disabled in the server configuration.');
  const sql=db();
  if(cardId) {
    cardId=v.cardId(cardId);
    ensure((await sql`SELECT id FROM cards WHERE id=${cardId}`).length,404,'Import this card before requesting prices.');
    const [recent]=await sql`SELECT attempted_at FROM card_price_cache WHERE card_id=${cardId} AND attempted_at>now()-interval '1 hour'`;
    if(recent) return {recent:true,message:'This card was checked in the last hour. Showing the cached result.'};
  }
  const key=cardId?'prices:card:'+cardId:'prices:tracked';
  return sql.begin(async tx=> {
    await tx`SELECT pg_advisory_xact_lock(72490319)`;
    const [existing]=await tx`SELECT id FROM jobs WHERE scope_key=${key} AND status IN ('queued','running')`;
    if(existing) return {id:existing.id,already_queued:true};
    ensure(Number((await tx`SELECT count(*) AS n FROM jobs WHERE kind='refresh-prices' AND status IN ('queued','running')`)[0].n)<20,429,'The price queue is full. Let existing jobs finish.');
    const [job]=await tx`INSERT INTO jobs(user_id,kind,scope_key,payload,message)
      VALUES(${userId},'refresh-prices',${key},${tx.json(cardId?{card_id:cardId}:{})},'Price refresh queued') RETURNING id`;
    return {...job,already_queued:false};
  });
}
export async function schedulePriceRefresh() {
  if(!pricingConfiguration().enabled) return;
  const sql=db();
  const [recent]=await sql`SELECT key FROM app_state WHERE key='price_schedule' AND updated_at>now()-interval '1 minute'`;
  if(recent) return;
  // Multiple workers may poll, but only one scheduler queues the global job.
  await sql.begin(async tx=> {
    const [lock]=await tx`SELECT pg_try_advisory_xact_lock(72490319) AS acquired`;
    if(!lock.acquired) return;
    const [again]=await tx`SELECT key FROM app_state WHERE key='price_schedule' AND updated_at>now()-interval '1 minute'`;
    if(again) return;
    await tx`INSERT INTO app_state(key,value) VALUES('price_schedule','{}'::jsonb) ON CONFLICT(key) DO UPDATE SET updated_at=now()`;
    if(!(await cardsDue()).length) return;
    await tx`INSERT INTO jobs(kind,scope_key,payload,message) VALUES('refresh-prices','prices:tracked','{}'::jsonb,'Scheduled price refresh')
      ON CONFLICT(scope_key) WHERE status IN ('queued','running') DO NOTHING`;
  });
}
export async function getCardPrices(userId,idInput) {
  const cardId=v.cardId(idInput),sql=db();
  ensure((await sql`SELECT id FROM cards WHERE id=${cardId}`).length,404,'Card not found.');
  const [caches,printings,rates,history]=await Promise.all([
    sql`SELECT * FROM card_price_cache WHERE card_id=${cardId}`,
    sql`SELECT id,key,label,source FROM printings WHERE card_id=${cardId} ORDER BY label`,fxRates(),
    sql`SELECT source,variant,currency,metric,amount::float8 AS amount,source_updated_at,observed_at
      FROM card_price_history WHERE card_id=${cardId} ORDER BY source_updated_at DESC LIMIT 120`
  ]);
  const cache=caches[0]??null;
  return {enabled:pricingConfiguration().enabled,refresh_hours:pricingConfiguration().hours,fetched_at:cache?.fetched_at??null,
    attempted_at:cache?.attempted_at??null,last_error:cache?.last_error??'',rates,history,
    printings:printings.map(p=>({...p,price:displayPrice(quoteForPrinting(p,cache?.quotes??[]),cache,rates)})),
    references:(cache?.reference_prices??[]).map(q=>displayPrice(q,cache,rates))};
}
export async function priceSummary(userId,binderId=null) {
  const sql=db();let rows;
  if(binderId) {
    binderId=v.uuid(binderId);
    ensure((await sql`SELECT id FROM binders WHERE id=${binderId} AND user_id=${userId}`).length,404,'Binder not found.');
    rows=await sql`SELECT p.key,p.source,pc.quotes,pc.fetched_at,pc.last_error,count(*)::integer AS quantity,
      coalesce((SELECT sum(e.quantity)::integer FROM collection_entries e WHERE e.user_id=${userId} AND e.printing_id=p.id),0) AS owned_quantity
      FROM binder_slots s JOIN printings p ON p.id=s.printing_id LEFT JOIN card_price_cache pc ON pc.card_id=p.card_id
      WHERE s.binder_id=${binderId} GROUP BY p.id,pc.card_id`;
  } else {
    rows=await sql`SELECT p.key,p.source,pc.quotes,pc.fetched_at,pc.last_error,sum(e.quantity)::integer AS quantity
      FROM collection_entries e JOIN printings p ON p.id=e.printing_id LEFT JOIN card_price_cache pc ON pc.card_id=p.card_id
      WHERE e.user_id=${userId} AND e.quantity>0 GROUP BY p.id,pc.card_id`;
  }
  const rates=await fxRates();
  return {enabled:pricingConfiguration().enabled,refresh_hours:pricingConfiguration().hours,rates,
    valuation:valueRows(rows,rates),owned_reference:binderId?valueRows(rows.map(r=>({...r,quantity:Math.min(r.quantity,r.owned_quantity)})),rates):null,
    basis:binderId?'Planned pockets; owned reference does not prove physical placement.':'Owned quantities; market estimates are not condition-adjusted.',
    generated_at:new Date().toISOString()};
}
export async function cataloguePriceBadges(items) {
  if(!items.length) return items;
  const sql=db(),ids=items.map(c=>c.id);
  const [caches,printings,rates]=await Promise.all([sql`SELECT * FROM card_price_cache WHERE card_id IN ${sql(ids)}`,
    sql`SELECT card_id,key,source FROM printings WHERE card_id IN ${sql(ids)}`,fxRates()]);
  const cacheMap=new Map(caches.map(c=>[c.card_id,c]));
  return items.map(card=> {
    const cache=cacheMap.get(card.id);
    const matches=printings.filter(p=>p.card_id===card.id).map(p=>quoteForPrinting(p,cache?.quotes??[])).filter(Boolean).sort((a,b)=>a.amount-b.amount);
    return {...card,price_from:displayPrice(matches[0]??null,cache,rates)};
  });
}
