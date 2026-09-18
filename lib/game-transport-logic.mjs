import { ensure } from './errors.mjs';
export function providerUrl(kind,value='') {
  switch(kind){
    case 'ygo-sets':return 'https://db.ygoprodeck.com/api/v7/cardsets.php';
    case 'ygo-set':ensure(typeof value==='string'&&value.length>0&&value.length<=200,400,'Invalid set name.');return 'https://db.ygoprodeck.com/api/v7/cardinfo.php?cardset='+encodeURIComponent(value);
    case 'ygo-card':ensure(/^[1-9]\d{0,11}$/.test(String(value)),400,'Invalid card passcode.');return 'https://db.ygoprodeck.com/api/v7/cardinfo.php?id='+value;
    case 'ygo-image':ensure(/^[1-9]\d{0,11}$/.test(String(value)),400,'Invalid image identity.');return 'https://images.ygoprodeck.com/images/cards/'+value+'.jpg';
    case 'mtg-sets':return 'https://mtgjson.com/api/v5/SetList.json';
    case 'mtg-set':ensure(/^[A-Z0-9]{1,12}$/.test(value),400,'Invalid Magic set code.');return 'https://mtgjson.com/api/v5/'+value+'.json';
    case 'mtg-prices':return 'https://mtgjson.com/api/v5/AllPricesToday.json';
    case 'scryfall-card':ensure(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value),400,'Invalid Scryfall identity.');return 'https://api.scryfall.com/cards/'+value;
    default:ensure(false,400,'Unsupported free catalogue operation.');
  }
}
export function scryfallImageUrl(value) {
  if(typeof value!=='string')return null;
  try{const url=new URL(value);return url.protocol==='https:'&&url.hostname==='cards.scryfall.io'&&!url.port&&!url.username&&!url.password&&
    /^\/(?:normal|large)\/(?:front|back)\/[a-f0-9]\/[a-f0-9]\/[a-f0-9-]{36}\.jpg$/.test(url.pathname)?url.href:null;}catch{return null;}
}
export async function boundedBytes(response,max) {
  ensure(response.ok,502,`Catalogue provider returned HTTP ${response.status}. A rate-limit response is not automatically retried.`);
  ensure(response.body,502,'The catalogue response was empty.');
  const chunks=[];let size=0;
  try{for await(const chunk of response.body){size+=chunk.length;ensure(size<=max,502,'Catalogue response exceeds the safety limit.');chunks.push(chunk);}}
  catch(error){try{await response.body.cancel();}catch{}throw error;}
  return Buffer.concat(chunks);
}

export function validateProviderPayload(kind,value,data) {
  if(kind==='ygo-sets')ensure(Array.isArray(data)&&data.length>0&&data.length<=20000,502,'Invalid Yu-Gi-Oh! set catalogue.');
  else if(kind==='ygo-set'||kind==='ygo-card') {
    ensure(Array.isArray(data?.data)&&data.data.length>0&&data.data.length<=12000&&!data.meta?.next_page,502,'Incomplete Yu-Gi-Oh! catalogue response.');
    if(kind==='ygo-card')ensure(data.data.length===1&&String(data.data[0].id)===String(value),502,'Yu-Gi-Oh! card identity mismatch.');
  } else if(kind==='mtg-sets')ensure(Array.isArray(data?.data)&&data.data.length>0&&data.data.length<=20000,502,'Invalid Magic set catalogue.');
  else if(kind==='mtg-set')ensure(data?.data?.code===value&&Array.isArray(data.data.cards),502,'Magic set identity mismatch.');
  else if(kind==='mtg-prices')ensure(data?.data&&typeof data.data==='object'&&!Array.isArray(data.data)&&Object.keys(data.data).length>0&&/^\d{4}-\d{2}-\d{2}$/.test(data?.meta?.date||''),502,'Invalid Magic daily-price feed.');
  else if(kind==='scryfall-card')ensure(data?.object==='card'&&data.id===value&&data.lang==='en',502,'Scryfall printing identity or language mismatch.');
  else ensure(false,400,'Unknown provider operation.');
  return data;
}
