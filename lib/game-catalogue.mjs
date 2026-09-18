import { db,audit } from './db.mjs';
import { ensure } from './errors.mjs';
import * as v from './validate.mjs';
import { cachedProviderJson,importArtwork,mtgPriceFeed } from './game-provider.mjs';
import { normaliseGameSets,normaliseMtgSet,normaliseYugiohSet,mtgPriceData } from './game-provider-logic.mjs';
import { priceFailure,pricingConfiguration } from './prices.mjs';
export async function availableGameSets(game) {
  v.oneOf(game,'Additional game',['mtg','yugioh']);
  return normaliseGameSets(game,await cachedProviderJson(game==='mtg'?'mtg-sets':'ygo-sets'));
}
export async function queueGameImport(actorId,input) {
  const o=v.object(input);
  ensure(Object.keys(o).every(k=>['game','code','confirm_provider_terms'].includes(k)),400,'Unsupported catalogue import field.');
  const [actor]=await db()`SELECT role FROM app_users WHERE id=${actorId}`;ensure(actor?.role==='admin',403,'Administrator access required.');
  ensure(o.confirm_provider_terms===true,400,'Confirm review of the provider terms and the free public catalogue requirement.');
  const game=v.oneOf(o.game,'Game',['mtg','yugioh']),code=v.providerId(o.code);
  const set=(await availableGameSets(game)).find(s=>s.code===code);ensure(set,404,'Choose a set from the provider catalogue.');
  return db().begin(async sql=>{
    await sql`SELECT pg_advisory_xact_lock(72491302)`;
    const scope='import-game:'+game+':'+code;
    const [old]=await sql`SELECT id FROM jobs WHERE scope_key=${scope} AND status IN ('queued','running')`;
    if(old)return {...old,already_queued:true};
    ensure(Number((await sql`SELECT count(*) AS n FROM jobs WHERE status IN ('queued','running')`)[0].n)<30,429,'Wait for current catalogue jobs to finish.');
    const [job]=await sql`INSERT INTO jobs(user_id,kind,scope_key,payload,message)
      VALUES(${actorId},'import-game-set',${scope},${sql.json({game,code})},'Additional game set queued') RETURNING id`;
    await audit(sql,actorId,'catalogue.game_set_queued',{game,code});return {...job,already_queued:false};
  });
}
export async function storeGamePricing(cardId,pricing) {
  const {quotes,references}=pricing;
  return db().begin(async sql=>{
    await sql`INSERT INTO card_price_cache(card_id,quotes,reference_prices,fetched_at,attempted_at,next_attempt_at,last_error)
      VALUES(${cardId},${sql.json(quotes)},${sql.json(references)},now(),now(),now()+interval '24 hours','')
      ON CONFLICT(card_id) DO UPDATE SET quotes=excluded.quotes,reference_prices=excluded.reference_prices,
        fetched_at=now(),attempted_at=now(),next_attempt_at=excluded.next_attempt_at,last_error=''`;
    for(const q of [...quotes,...references].filter(q=>q.source_updated_at))await sql`INSERT INTO card_price_history
      (card_id,source,variant,currency,metric,amount,source_updated_at) VALUES(${cardId},${q.source},${q.variant},${q.currency},${q.metric},${q.amount},${q.source_updated_at})
      ON CONFLICT(card_id,source,variant,currency,metric,source_updated_at) DO UPDATE SET amount=excluded.amount`;
  });
}
export async function storeGameCard(card) {
  await db().begin(async sql=>{
    await sql`INSERT INTO cards(id,provider_id,set_id,game,language,local_id,name,illustrator,rarity,category,image_url,dex_ids,raw_data)
      VALUES(${card.id},${card.provider_id},${card.set_id},${card.game},${card.language},${card.local_id},${card.name},${card.illustrator},
        ${card.rarity},${card.category},${card.image_url},${card.dex_ids},${sql.json(card.raw_data)})
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,illustrator=excluded.illustrator,
        rarity=excluded.rarity,category=excluded.category,image_url=coalesce(excluded.image_url,cards.image_url),raw_data=excluded.raw_data,updated_at=now()`;
    for(const p of card.printings)await sql`INSERT INTO printings(card_id,key,label,source,metadata)
      VALUES(${card.id},${p.key},${p.label},${p.source},${sql.json(p.metadata)}) ON CONFLICT(card_id,key)
      DO UPDATE SET label=excluded.label,metadata=excluded.metadata WHERE printings.source=excluded.source`;
  });
  if(pricingConfiguration().enabled&&card.pricing)await storeGamePricing(card.id,card.pricing);
}
export async function runGameImport(job,report,stopping) {
  const game=v.oneOf(job.payload.game,'Game',['mtg','yugioh']),set=(await availableGameSets(game)).find(s=>s.code===job.payload.code);
  ensure(set,409,'The selected set is no longer in the source catalogue.');
  const raw=await cachedProviderJson(game==='mtg'?'mtg-set':'ygo-set',game==='mtg'?set.source_code:set.name,40*1024*1024);
  const cards=game==='mtg'?normaliseMtgSet(set,raw):normaliseYugiohSet(set,raw);
  ensure(cards.length>0,409,'This set has no supported English paper printings. No existing data was deleted.');
  let prices=null,priceError='';
  if(game==='mtg'&&pricingConfiguration().enabled){try{prices=await mtgPriceFeed();}catch{priceError='MTGJSON daily prices could not be loaded. Metadata is retained; retry after checking the provider.';}}
  const sql=db(),setId=game+':en:'+set.code;
  await sql`INSERT INTO card_sets(id,provider_id,language,game,name,series,release_date,card_count)
    VALUES(${setId},${game+'-'+set.code},'en',${game},${set.name},${set.series},${set.release_date},${cards.length})
    ON CONFLICT(id) DO UPDATE SET name=excluded.name,series=excluded.series,release_date=excluded.release_date,card_count=excluded.card_count,updated_at=now()`;
  let done=0;const errors=[];
  for(const card of cards){
    if(stopping()){
      await sql`UPDATE jobs SET status='queued',lease_token=NULL,message='Additional game import paused for restart' WHERE id=${job.id} AND lease_token=${job.lease_token}`;return;
    }
    try{
      if(game==='mtg')card.pricing=prices?mtgPriceData(card,prices):null;
      try{await importArtwork(card);}catch{errors.push({card_id:card.id,message:'Artwork is unavailable; catalogue data was still imported. Retry this set later.'});}
      await storeGameCard(card);
      if(priceError)await priceFailure(card.id,new Error(priceError));
    }catch(error){errors.push({card_id:card.id,message:String(error.message).slice(0,300)});}
    await report(job,++done,cards.length,`Imported ${done} of ${cards.length} ${game==='mtg'?'Magic':'Yu-Gi-Oh!'} printings`,errors.slice(0,100));
  }
  if(priceError)errors.push({card_id:setId,message:priceError});
  await sql`UPDATE jobs SET status=${errors.length?'failed':'completed'},message=${errors.length?'Catalogue imported with issues. Review and retry; existing ownership is unchanged.':'Additional game import complete'},
    errors=${sql.json(errors.slice(0,100))},lease_token=NULL,finished_at=now() WHERE id=${job.id} AND lease_token=${job.lease_token}`;
}
export async function refreshGameCard(card) {
  if(card.game==='mtg'){
    const printings=await db()`SELECT key FROM printings WHERE card_id=${card.id} AND source='mtgjson'`;
    await storeGamePricing(card.id,mtgPriceData({...card,printings},await mtgPriceFeed()));return;
  }
  ensure(card.game==='yugioh',400,'Unknown catalogue provider.');
  const data=card.raw_data,payload=await cachedProviderJson('ygo-card',String(data.passcode));
  const set={game:'yugioh',code:card.set_id.split(':')[2],name:data.set_name};
  const result=normaliseYugiohSet(set,payload).find(r=>r.id===card.id);
  await storeGamePricing(card.id,result?.pricing??{quotes:[],references:[]});
}
