import { extractPricing,positiveAmount } from './price-logic.mjs';
const FINISHES={normal:['normal'],holo:['holo','holofoil'],reverse:['reverse','reverse-holofoil']};
const METRICS=['lowPrice','midPrice','highPrice','directLowPrice'];
const date=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))?new Date(value).toISOString():null;
const product=value=>Number.isSafeInteger(value)&&value>0&&value<=2147483647?value:null;
function plain(detail) {
  return detail && (!detail.size||detail.size==='standard') && !detail.subtype && !detail.foil
    && (!detail.stamp||(Array.isArray(detail.stamp)&&detail.stamp.length===0));
}
function playerRows(block,finish,detail=null) {
  if(block?.unit!=='USD') return {quotes:[],metrics:[]};
  if(detail?.thirdParty?.tcgplayer!=null&&!product(detail.thirdParty.tcgplayer)) return {quotes:[],metrics:[]};
  const entries=FINISHES[finish].filter(key=>Object.hasOwn(block,key)).map(key=>block[key]).filter(x=>x&&typeof x==='object');
  const id=product(detail?.thirdParty?.tcgplayer),quotes=[],metrics=[];
  for(const metric of ['marketPrice',...METRICS]) {
    const valid=entries.filter(e=>positiveAmount(e[metric])!==null&&(e.productId==null||product(e.productId)));
    if(!valid.length||new Set(valid.map(e=>e[metric])).size!==1) continue;
    const ids=[...new Set(valid.map(e=>product(e.productId)).filter(Boolean))];
    if(ids.length>1 || (id&&ids.length&&ids[0]!==id)) continue;
    const row={source:'TCGplayer',variant:finish,currency:'USD',metric,amount:valid[0][metric],source_updated_at:date(block.updated)};
    const productId=ids[0]||id;if(productId) row.product_id=productId;
    if(detail) {row.mapping_basis='detailed_variant';if(typeof detail.variantId==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(detail.variantId))row.provider_variant_id=detail.variantId;}
    (metric==='marketPrice'?quotes:metrics).push(row);
  }
  return {quotes,metrics};
}
/** Scoped variant pricing may contain a whole card's finishes. Select only its
 * stated plain finish; stamped, jumbo and special-foil variants are not aliases. */
export function extractTcgdexMarkets(pricing,details) {
  const {references}=extractPricing(pricing),quotes=[],metrics=[];
  for(const finish of Object.keys(FINISHES)) {
    const typed=Array.isArray(details)?details.filter(d=>d?.type===finish):[];
    const candidates=typed.filter(plain);
    let data;
    if(typed.length) {
      if(candidates.length!==1) continue;
      const detail=candidates[0];
      if(detail.pricing?.tcgplayer) data=playerRows(detail.pricing.tcgplayer,finish,detail);
      else data=playerRows(pricing?.tcgplayer,finish,detail);
    } else data=playerRows(pricing?.tcgplayer,finish);
    quotes.push(...data.quotes);metrics.push(...data.metrics);
  }
  // Cardmarket's duplicated variant blocks still expose aggregate categories.
  // Use them only as card-level guides, never as proven finish matches.
  if(!references.length&&Array.isArray(details)) {
    const blocks=details.filter(plain).map(d=>extractPricing(d.pricing).references).filter(x=>x.length);
    if(blocks.length&&blocks.every(x=>JSON.stringify(x)===JSON.stringify(blocks[0]))) references.push(...blocks[0]);
  }
  return {quotes,references,metrics};
}
const key=q=>[q.source,q.variant,q.currency,q.metric].join(':');
export function mergeMarketObservations(previous,incoming,now=new Date().toISOString()) {
  const result={quotes:[],references:[],metrics:[],providers:{}};
  for(const source of ['TCGplayer','Cardmarket']) {
    let accepted=0,retained=0;
    const hasData=['quotes','references','metrics'].some(k=>(incoming[k]||[]).some(q=>q.source===source));
    for(const field of ['quotes','references','metrics']) {
      const old=(previous?.[field]||[]).filter(q=>q.source===source),next=(incoming[field]||[]).filter(q=>q.source===source);
      if(!hasData) {
        result[field].push(...old.map(q=>({...q,received_at:q.received_at||previous.fetched_at||null,retained:true,retention_reason:'missing'})));retained+=old.length;
      } else for(const q of next) {
        const before=old.find(v=>key(v)===key(q)),oldTime=Date.parse(before?.source_updated_at),newTime=Date.parse(q.source_updated_at);
        const latest=Date.parse(now)+86400000;
        if(before&&Number.isFinite(oldTime)&&oldTime<=latest&&(!Number.isFinite(newTime)||newTime<oldTime||newTime>latest)) {
          result[field].push({...before,received_at:before.received_at||previous.fetched_at||null,retained:true,retention_reason:'older'});retained++;
        } else {result[field].push({...q,received_at:now});accepted++;}
      }
    }
    const rows=[...result.quotes,...result.references,...result.metrics].filter(q=>q.source===source);
    const sourceDates=rows.map(q=>q.source_updated_at).filter(Boolean).sort();
    result.providers[source]={state:accepted?(retained?'partial':'available'):hasData?'older':'missing',checked_at:now,
      received_at:accepted?now:previous?.providers?.[source]?.received_at||previous?.fetched_at||null,
      source_updated_at:sourceDates.at(-1)||null,retained_observations:retained};
  }
  return result;
}
