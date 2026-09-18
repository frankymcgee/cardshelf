import { gzip,gunzip } from 'node:zlib';
import { promisify } from 'node:util';
import { db } from './db.mjs';
import { AppError,ensure } from './errors.mjs';
import { providerUrl,scryfallImageUrl,boundedBytes,validateProviderPayload } from './game-transport-logic.mjs';
import { hashText } from './game-provider-logic.mjs';
const zip=promisify(gzip),unzip=promisify(gunzip),sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const MAX_JSON=256*1024*1024;
async function providerTransaction(run) {
  try { return await db().begin(run); }
  catch(error) {
    if(error?.details?.provider_host && error.details.blocked_until) {
      // Write after rollback, otherwise a thrown provider error loses its cooldown.
      const key='free-provider-backoff:'+error.details.provider_host;
      const value={blocked_until:error.details.blocked_until};
      await db()`INSERT INTO app_state(key,value) VALUES(${key},${db().json(value)})
        ON CONFLICT(key) DO UPDATE SET value=CASE
          WHEN (app_state.value->>'blocked_until')::timestamptz>(excluded.value->>'blocked_until')::timestamptz
          THEN app_state.value ELSE excluded.value END,updated_at=now()`;
    }
    throw error;
  }
}
async function request(sql,url,max) {
  const host=new URL(url).hostname;
  // Reuse the cache transaction: nested pool connections can deadlock when
  // several workers wait for the same provider. The browser never calls it.
  await sql`SELECT pg_advisory_xact_lock(hashtextextended(${'free-provider:'+host},0))`;
  const [backoff]=await sql`SELECT value FROM app_state WHERE key=${'free-provider-backoff:'+host}`;
  ensure(!(Date.parse(backoff?.value?.blocked_until)>Date.now()),503,'The catalogue provider is temporarily paused after a rate-limit response. Retry the set after its one-hour cooldown.');
  await sleep(350);
  const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(45000),
    headers:{'User-Agent':'CardShelf/0.13 (self-hosted catalogue cache)','Accept':'application/json;q=0.9,image/webp,image/jpeg,*/*;q=0.5'}});
  if([429,503].includes(response.status)) {
    try { await response.body?.cancel(); } catch {}
    throw new AppError(503,'The catalogue provider requested a pause. Further uncached requests are stopped for one hour.',
      {provider_host:host,blocked_until:new Date(Date.now()+3600000).toISOString()});
  }
  return boundedBytes(response,max);
}
export async function cachedProviderJson(kind,value='',max=20*1024*1024) {
  const url=providerUrl(kind,value),key=kind+':'+hashText(value),ttl=kind==='scryfall-card'?30*86400:86400;
  return providerTransaction(async sql=>{
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${'provider-cache:'+key},0))`;
    const [old]=await sql`SELECT payload_gzip FROM game_provider_cache WHERE cache_key=${key} AND fetched_at>now()-(${ttl}*interval '1 second')`;
    if(old){const bytes=await unzip(old.payload_gzip,{maxOutputLength:MAX_JSON});return validateProviderPayload(kind,value,JSON.parse(bytes.toString('utf8')));}
    const bytes=await request(sql,url,Math.min(max,MAX_JSON));let data;
    try{data=JSON.parse(bytes.toString('utf8'));}catch{ensure(false,502,'Catalogue provider returned unreadable JSON.');}
    ensure(data&&typeof data==='object',502,'Catalogue provider returned an invalid JSON object.');
    validateProviderPayload(kind,value,data);
    // Cache only complete, identity-checked responses; never provider error objects.
    const packed=await zip(bytes);
    ensure(packed.length<=40*1024*1024,502,'Compressed catalogue exceeds the storage limit.');
    await sql`INSERT INTO game_provider_cache(cache_key,payload_gzip) VALUES(${key},${packed})
      ON CONFLICT(cache_key) DO UPDATE SET payload_gzip=excluded.payload_gzip,fetched_at=now()`;
    return data;
  });
}
async function storeArtwork(provider,remoteId,url) {
  return providerTransaction(async tx=>{
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${'artwork:'+provider+':'+remoteId},0))`;
    const [old]=await tx`SELECT id FROM catalogue_artwork WHERE provider=${provider} AND remote_id=${remoteId}`;
    if(old)return '/api/public/catalogue/artwork/'+old.id;
    const bytes=await request(tx,url,5*1024*1024),{default:sharp}=await import('sharp');let content;
    try{
      const image=sharp(bytes,{limitInputPixels:16000000,animated:false,failOn:'error'}),meta=await image.metadata();
      ensure(['jpeg','png','webp'].includes(meta.format)&&!(meta.pages>1),502,'Unsupported catalogue image.');
      content=await image.resize({width:1200,height:1800,fit:'inside',withoutEnlargement:true}).webp({quality:90}).toBuffer();
    }catch{ensure(false,502,'Catalogue artwork could not be decoded safely.');}
    const id=hashText(provider+':'+remoteId);
    await tx`INSERT INTO catalogue_artwork(id,provider,remote_id,content) VALUES(${id},${provider},${remoteId},${content})`;
    return '/api/public/catalogue/artwork/'+id;
  });
}
export async function importArtwork(card) {
  if(card.game==='yugioh'&&card.raw_data.image_remote_id){
    card.image_url=await storeArtwork('ygoprodeck',card.raw_data.image_remote_id,providerUrl('ygo-image',card.raw_data.image_remote_id));return;
  }
  if(card.game!=='mtg'||!card.raw_data.scryfall_id)return;
  const id=card.raw_data.scryfall_id;
  const old=await db()`SELECT id,remote_id FROM catalogue_artwork WHERE provider='scryfall' AND remote_id IN (${id+':front'},${id+':back'})`;
  const front=old.find(row=>row.remote_id===id+':front');
  if(front){card.image_url='/api/public/catalogue/artwork/'+front.id;const back=old.find(row=>row.remote_id===id+':back');if(back){card.raw_data.back_image_url='/api/public/catalogue/artwork/'+back.id;return;}if(!card.raw_data.faces || card.raw_data.faces.length<2)return;}
  const raw=await cachedProviderJson('scryfall-card',id);
  ensure(raw.id===id&&raw.object==='card'&&raw.lang==='en',502,'Scryfall returned a different printing or language.');
  const images=raw.image_uris?[raw.image_uris]:raw.card_faces?.map(face=>face.image_uris)??[];
  for(let i=0;i<Math.min(images.length,2);i++){
    const url=scryfallImageUrl(images[i]?.normal);if(!url)continue;
    const local=await storeArtwork('scryfall',id+(i===0?':front':':back'),url);
    if(i===0)card.image_url=local;else card.raw_data.back_image_url=local;
  }
}
// Parse the shared daily feed once per process, not once for every owned card.
let dailyPrices=null,priceMemoryExpires=0;
export async function mtgPriceFeed() {
  if(!dailyPrices||Date.now()>=priceMemoryExpires) {
    priceMemoryExpires=Date.now()+3600000;
    dailyPrices=cachedProviderJson('mtg-prices','',MAX_JSON).catch(error=>{dailyPrices=null;priceMemoryExpires=0;throw error;});
  }
  return dailyPrices;
}
