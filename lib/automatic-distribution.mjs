import { extractTcgdexMarkets } from './tcgdex-pricing.mjs';
const cache=new Map(),normalise=s=>String(s||'').toLowerCase().replace(/^[a-z0-9.]+:\s*/,'').replace(/[^a-z0-9]/g,'');
async function source(path) {
  const cached=cache.get(path);if(cached&&cached.until>Date.now())return cached.promise;
  const entry={until:Date.now()+86400000,promise:null};
  entry.promise=(async()=>{
    const response=await fetch('https://tcgcsv.com/tcgplayer/3/'+path,{signal:AbortSignal.timeout(15000),headers:{Accept:'application/json','User-Agent':'CardShelf/0.66.0'},redirect:'error'});
    if(!response.ok)throw Error('Distribution feed HTTP '+response.status);
    let size=0;const chunks=[];
    for await(const chunk of response.body){size+=chunk.length;if(size>16000000)throw Error('Distribution feed too large');chunks.push(chunk);}
    const data=JSON.parse(Buffer.concat(chunks).toString());
    if(data.success!==true||!Array.isArray(data.results))throw Error('Invalid distribution feed');
    return data.results;
  })().catch(error=>{entry.until=Date.now()+3600000;console.error('Distribution source:',error.message);return [];});
  cache.set(path,entry);return entry.promise;
}
export async function distributionProducts(setName) {
  const groups=await source('groups');
  const selected=groups.filter(g=>Number.isSafeInteger(g.groupId)&&g.groupId>0&&g.categoryId===3&&
    (normalise(g.name)===normalise(setName)||g.name==='Deck Exclusives'));
  const lists=await Promise.all(selected.map(async group=>(await source(group.groupId+'/products')).map(product=>({group,product}))));
  return lists.flat();
}
const plain=d=>d&&(!d.size||d.size==='standard')&&!d.subtype&&!d.foil&&(!d.stamp||(Array.isArray(d.stamp)&&!d.stamp.length));
export function automaticDistributionRules(raw,language,products=[]) {
  if(language!=='en')return [];
  const markets=extractTcgdexMarkets(raw?.pricing,raw?.variants_detailed);
  const result=[];
  for(const finish of ['normal','holo','reverse']) {
    const details=(Array.isArray(raw?.variants_detailed)?raw.variants_detailed:[]).filter(d=>d?.type===finish);
    if(details.length&&(!details.every(plain)||details.some(d=>d.languages&&!d.languages.includes(language))))continue;
    // Require a finish-specific product ID, never the card-level ID alone.
    const ids=[...new Set([...markets.quotes,...markets.metrics].filter(q=>q.variant===finish&&Number.isSafeInteger(q.product_id)).map(q=>q.product_id))];
    if(ids.length!==1)continue;
    const matches=products.filter(({product})=>product.productId===ids[0]);
    if(matches.length!==1)continue;
    const {product,group}=matches[0];
    if(product.categoryId!==3||product.groupId!==group.groupId)continue;
    if(!raw.name||normalise(String(product.name||'').split(' - ')[0].split(' (')[0])!==normalise(raw.name))continue;
    const numbers=(product.extendedData||[]).filter(x=>x.name==='Number').map(x=>String(x.value).split('/')[0].replace(/^0+(?=\d)/,''));
    if(numbers.length!==1||numbers[0]!==String(raw.localId).replace(/^0+(?=\d)/,''))continue;
    let distribution;
    if(group.name==='Deck Exclusives')distribution='product_exclusive';
    else if(normalise(group.name)===normalise(raw.set?.name)) {
      if(/promo/i.test(group.name))distribution='promo';
      else if(!/exclusive|stamp|cosmos|jumbo|non.holo|reverse.holo|holofoil/i.test(product.name||''))distribution='regular';
    }
    if(distribution)result.push({finish,distribution,note:'Automatic exact TCGplayer product/number match: '+group.name,url:'https://www.tcgplayer.com/product/'+ids[0]});
  }
  return result;
}
export async function saveAutomaticDistribution(sql,raw,language,products) {
  for(const rule of automaticDistributionRules(raw,language,products))await sql`INSERT INTO printing_distribution_rules(game,language,provider_card_id,printing_key,distribution,note,evidence_url,automatic)
    VALUES('pokemon',${language},${raw.id},${rule.finish},${rule.distribution},${rule.note},${rule.url},true)
    ON CONFLICT(game,language,provider_card_id,printing_key) DO UPDATE SET distribution=excluded.distribution,note=excluded.note,evidence_url=excluded.evidence_url WHERE printing_distribution_rules.automatic`;
}
