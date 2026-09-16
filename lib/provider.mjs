import { ensure } from './errors.mjs';
import { language, providerId } from './validate.mjs';
export const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export async function fetchProvider(lang,path) {
  language(lang);
  // The host and path grammar are fixed. User input cannot supply an arbitrary URL.
  ensure(/^(sets|cards)(\/[A-Za-z0-9][A-Za-z0-9._-]*)?$/.test(path),400,'Invalid catalogue endpoint.');
  const url=`https://api.tcgdex.net/v2/${lang}/${path}`;
  let last;
  for(let attempt=0;attempt<3;attempt++) {
    try {
      const response=await fetch(url,{signal:AbortSignal.timeout(25000),headers:{Accept:'application/json','User-Agent':'CardShelf/0.1.1'}});
      if(response.status===429 || response.status>=500) {
        const delay=Math.min(60,Math.max(1,Number(response.headers.get('retry-after'))||2**attempt));
        await response.body?.cancel();await sleep(delay*1000);throw new Error(`Catalogue provider returned HTTP ${response.status}.`);
      }
      if(!response.ok) {await response.body?.cancel();throw new Error(`Catalogue provider returned HTTP ${response.status}.`);}
      const chunks=[];let size=0;
      for await(const chunk of response.body) {size+=chunk.length;ensure(size<=8_000_000,502,'Catalogue response exceeds 8 MB.');chunks.push(chunk);}
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch(error) {last=error;if(attempt<2) await sleep(500*(attempt+1));}
  }
  throw last || new Error('Could not contact the catalogue provider.');
}
export async function remoteSets(lang) {
  const items=await fetchProvider(language(lang),'sets');
  ensure(Array.isArray(items),502,'Unexpected set index from the catalogue provider.');
  return items.filter(x=>x && typeof x.id==='string' && typeof x.name==='string')
    .map(x=>({id:providerId(x.id),name:x.name,card_count:Number(x.cardCount?.total)||0}));
}
