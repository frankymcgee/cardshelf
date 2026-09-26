import { gameFromCardId } from './games.mjs';

export const AFFILIATE_PLACEMENTS = Object.freeze(['marketplace','cards','catalogue']);
export const AFFILIATE_DISCLOSURE = 'Affiliate links: CardShelf may earn a commission from qualifying purchases. You buy from the external shop, which handles payment and delivery.';
export const AMAZON_DISCLOSURE = 'As an Amazon Associate I earn from qualifying purchases.';
export const AMAZON_STARTERS = Object.freeze([
  {name:'Card binders',description:'Choose a binder with pockets that fit your cards and sleeves.'},
  {name:'Card sleeves',description:'Check sleeve dimensions against your card game before buying.'},
  {name:'Card packs',description:'Check the set, product language and sealed-pack contents before buying.'}
]);
const AMAZON_DOMAINS=['amazon.com','amazon.com.au','amazon.co.uk','amazon.ca','amazon.de','amazon.fr','amazon.it','amazon.es','amazon.co.jp','amazon.in','amazon.com.br','amazon.com.mx','amazon.ae','amazon.sg','amazon.nl','amazon.sa','amazon.se','amazon.pl','amazon.com.be','amazon.ie','amazon.com.tr','amazon.eg','amzn.to','amzn.eu','amzn.asia'];
export function amazonUrl(value){
  try{const host=new URL(value).hostname;return AMAZON_DOMAINS.some(domain=>host===domain||host.endsWith('.'+domain));}catch{return false;}
}
export function amazonShop(shop){return shop?.retailer==='amazon'||amazonUrl(shop?.url)||amazonUrl(shop?.search_url);}

// Only administrator-supplied HTTPS destinations. No scripts, redirects or remote fetches.
export function affiliateUrl(value, template = false) {
  if(typeof value!=='string'||!value||value.length>2048||/[\s\\\x00-\x1f\x7f]/.test(value)||/%(?:0[0-9a-f]|1[0-9a-f]|7f|5c)/i.test(value))return null;
  if(!value.startsWith('https://'))return null;
  if(template ? /[{}]/.test(value.replaceAll('{query}','')) || !value.includes('{query}') : /[{}]/.test(value))return null;
  if(value.split(/[/?#]/).slice(0,3).join('/').includes('{query}'))return null;
  if(value.includes('#')&&value.slice(value.indexOf('#')).includes('{query}'))return null;
  try {
    const url=new URL(value.replaceAll('{query}','CardShelf'));
    if(url.protocol!=='https:'||url.username||url.password||(url.port&&url.port!=='443'))return null;
    if(!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/i.test(url.hostname))return null;
    if(/(?:^|\.)(?:localhost|local|internal|test|invalid)$/i.test(url.hostname))return null;
    return value;
  }catch{return null;}
}
export function affiliateSearch(card) {
  return [card?.name,card?.set_name,card?.local_id,card?.language==='ja'?'Japanese':card?.language==='en'?'English':'']
    .filter(value=>typeof value==='string'&&value.trim()).join(' ').slice(0,300);
}
export function affiliateShopActive(shop, now = new Date()) {
  return shop?.enabled===true && (!shop.expires_on || shop.expires_on>=now.toISOString().slice(0,10)) && !!affiliateUrl(shop.url);
}
/** @param {any[]} shops @param {{placement?: string, card?: any, search?: string, game?: string}} options */
export function affiliateLinks(shops, {placement='',card=null,search='',game=''} = {}, now = new Date()) {
  const selectedGame=game||card?.game||gameFromCardId(card?.id);
  const query=(typeof search==='string'&&search.trim()?search.trim():affiliateSearch(card)).slice(0,300);
  return (Array.isArray(shops)?shops:[]).filter(shop=>affiliateShopActive(shop,now)&&shop.placements?.includes(placement)&&
    (!selectedGame||!shop.games?.length||shop.games.includes(selectedGame))).map(shop=>{
      let href=shop.url,isSearch=false;
      if(query&&!amazonShop(shop)&&affiliateUrl(shop.search_url,true)){
        try{const candidate=shop.search_url.replaceAll('{query}',encodeURIComponent(query));if(affiliateUrl(candidate)){href=candidate;isSearch=true;}}catch{/* Keep the shop link if the search cannot be encoded. */}
      }
      return {...shop,href,isSearch};
    });
}
