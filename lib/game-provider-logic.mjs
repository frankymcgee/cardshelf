import { createHash } from 'node:crypto';
import { ensure } from './errors.mjs';
import * as v from './validate.mjs';
export const hashText=text=>createHash('sha256').update(String(text)).digest('hex');
const optional=(value,max=500)=>typeof value==='string'?value.replaceAll('\0','').slice(0,max):'';
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)?value.toLowerCase():null;
const iso=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value?value:null;
export function providerAmount(value) {
  if(typeof value==='string' && /^\d+(?:\.\d{1,6})?$/.test(value))value=Number(value);
  return typeof value==='number'&&Number.isFinite(value)&&value>0&&value<=10000000?value:null;
}
export function normaliseGameSets(game,payload) {
  const values=game==='mtg'?payload?.data:payload;
  ensure(['mtg','yugioh'].includes(game)&&Array.isArray(values)&&values.length<=20000,502,'Unsupported set catalogue response.');
  const result=[];
  for(const raw of values){
    if(game==='mtg'&&(raw.isOnlineOnly||raw.isForeignOnly))continue;
    const name=v.text(raw.name??raw.set_name,'Provider set name',1,200);
    const sourceCode=v.providerId(raw.code??raw.set_code);
    const code=game==='mtg'?sourceCode.toUpperCase():sourceCode+'-'+hashText(name).slice(0,12);
    const count=Number(raw.totalSetSize??raw.num_of_cards??0);
    ensure(Number.isInteger(count)&&count>=0&&count<=100000,502,'Invalid provider set size.');
    result.push({game,language:'en',code,source_code:sourceCode,name,card_count:count,
      release_date:iso(raw.releaseDate??raw.tcg_date),series:game==='mtg'?optional(raw.block??raw.type,100):'Yu-Gi-Oh! TCG'});
  }
  ensure(new Set(result.map(row=>row.code)).size===result.length,502,'Provider returned duplicate set identities.');
  return result;
}
function cardBase(game,set,providerId,number,name) {
  return {id:`${game}:en:${providerId}`,provider_id:providerId,set_id:`${game}:en:${set.code}`,game,language:'en',
    local_id:v.text(String(number),'Card number',1,50),name:v.text(name,'Card name',1,200),
    illustrator:'',rarity:'',category:'',image_url:null,dex_ids:[],raw_data:{},printings:[],pricing:{quotes:[],references:[]}};
}
export function normaliseYugiohSet(set,payload) {
  ensure(set?.game==='yugioh'&&Array.isArray(payload?.data)&&payload.data.length<=12000&&!payload.meta?.next_page,502,'Expected the complete selected Yu-Gi-Oh! set.');
  const cards=[];
  for(const raw of payload.data){
    ensure(Number.isSafeInteger(raw.id)&&raw.id>0,502,'Invalid Yu-Gi-Oh! card identity.');
    const matches=Array.isArray(raw.card_sets)?raw.card_sets.filter(s=>s.set_name===set.name):[];
    const codes=[...new Set(matches.map(s=>v.text(s.set_code,'Set number',1,50)))];
    for(const code of codes){
      const id='ygo-'+raw.id+'-'+hashText(code).slice(0,12),card=cardBase('yugioh',set,id,code,raw.name);
      card.category=optional(raw.type,100);card.raw_data={catalogue_provider:'ygoprodeck',passcode:raw.id,set_code:code,set_name:set.name,
        public_text:optional(raw.desc,12000),image_note:'Catalogue illustration; alternate artwork and edition are not verified.'};
      const selected=matches.filter(s=>s.set_code===code),seen=new Set();
      for(const s of selected){
        const rarity=v.text(s.set_rarity,'Rarity',1,100),key='rarity-'+hashText(code+'|'+rarity).slice(0,20);
        if(seen.has(key))continue;seen.add(key);
        card.printings.push({key,label:rarity+' · edition unspecified',source:'ygoprodeck',metadata:{set_code:code,rarity,edition:'unspecified'}});
        const amounts=selected.filter(t=>t.set_rarity===rarity).map(t=>providerAmount(t.set_price)).filter(n=>n!==null);
        if(amounts.length&&new Set(amounts).size===1)card.pricing.references.push({source:'YGOPRODeck',provider:'ygoprodeck',variant:key,currency:'USD',metric:'setPrice',amount:amounts[0],source_updated_at:null,
          approximate:true,estimate_note:'Set/rarity reference; edition, condition and sale date are not confirmed.'});
      }
      card.rarity=[...new Set(selected.map(s=>s.set_rarity))].join(' / ').slice(0,500);
      const price=Array.isArray(raw.card_prices)?raw.card_prices[0]:null;
      for(const [field,source,currency] of [['cardmarket_price','Cardmarket','EUR'],['tcgplayer_price','TCGplayer','USD']]){
        const amount=providerAmount(price?.[field]);
        if(amount!==null)card.pricing.references.push({source,provider:'ygoprodeck',variant:'all-printings',currency,metric:'lowestAcrossPrintings',amount,source_updated_at:null,
          approximate:true,estimate_note:'Lowest provider value across multiple versions, not this exact printing.'});
      }
      const image=raw.card_images?.find(i=>i.id===raw.id)??raw.card_images?.[0];
      if(Number.isSafeInteger(image?.id)&&image.id>0)card.raw_data.image_remote_id=String(image.id);
      if(card.printings.length)cards.push(card);
    }
  }
  ensure(new Set(cards.map(c=>c.id)).size===cards.length,502,'Duplicate Yu-Gi-Oh! printing identities.');
  return cards;
}
export function normaliseMtgSet(set,payload) {
  const data=payload?.data;
  ensure(set?.game==='mtg'&&data?.code===set.source_code&&Array.isArray(data.cards)&&data.cards.length<=15000,502,'Magic set identity or response does not match.');
  const byId=new Map(data.cards.map(card=>[card.uuid,card])),cards=[];
  for(const raw of data.cards){
    if((raw.side&&raw.side!=='a') || (raw.language&&!['English','en'].includes(raw.language)) || !raw.availability?.includes('paper'))continue;
    const id=uuid(raw.uuid);ensure(id,502,'Magic card UUID is invalid.');
    const card=cardBase('mtg',set,'mtg-'+id,raw.number,raw.name);
    card.illustrator=optional(raw.artist,200);card.rarity=optional(raw.rarity,100);card.category=optional(raw.type,200);
    const faces=[raw,...(Array.isArray(raw.otherFaceIds)?raw.otherFaceIds.map(id=>byId.get(id)).filter(Boolean):[])];
    card.raw_data={catalogue_provider:'mtgjson',mtgjson_uuid:id,scryfall_id:uuid(raw.identifiers?.scryfallId),
      public_text:optional(raw.text,12000),faces:faces.slice(0,4).map(f=>({name:optional(f.faceName??f.name,200),text:optional(f.text,12000)})),
      image_note:'Printing artwork from Scryfall. Magic data from MTGJSON. Not affiliated with Wizards of the Coast.'};
    ensure(Array.isArray(raw.finishes),502,'Magic printing does not declare its available finishes.');
    for(const [finish,key,label] of [['nonfoil','normal','Nonfoil'],['foil','foil','Foil'],['etched','etched','Etched foil']])
      if(raw.finishes.includes(finish))card.printings.push({key,label,source:'mtgjson',metadata:{mtgjson_uuid:id,finish,edition:'provider printing'}});
    if(card.printings.length)cards.push(card);
  }
  ensure(new Set(cards.map(c=>c.id)).size===cards.length,502,'Duplicate Magic printing identities.');
  return cards;
}
export function mtgPriceData(card,feed,now=Date.now()) {
  const pricing={quotes:[],references:[]},paper=feed?.data?.[card.raw_data?.mtgjson_uuid]?.paper;
  for(const [provider,source,expectedCurrency] of [['tcgplayer','TCGplayer','USD'],['cardmarket','Cardmarket','EUR'],['cardkingdom','Card Kingdom','USD']]){
    const data=paper?.[provider];if(!data||data.currency!==expectedCurrency)continue;
    for(const p of card.printings){
      const values=data.retail?.[p.key];if(!values||typeof values!=='object'||Array.isArray(values))continue;
      const dates=Object.keys(values).filter(d=>iso(d)&&Date.parse(d)<=now+86400000).sort().reverse();
      // A newest explicit zero removes a quote; never fall back to an older positive value.
      const date=dates[0],amount=providerAmount(values[date]);if(!date||amount===null)continue;
      const q={source,provider:'mtgjson',variant:p.key,currency:expectedCurrency,metric:'retail',amount,source_updated_at:date+'T00:00:00.000Z'};
      if(provider==='tcgplayer')pricing.quotes.push(q);
      else pricing.references.push({...q,approximate:true,estimate_note:'Provider retail reference for this printing/finish; condition and realised sale price are not confirmed.'});
    }
  }
  return pricing;
}
export function gameQuoteForPrinting(printing,quotes) {
  if(printing?.source!=='mtgjson'||!['normal','foil','etched'].includes(printing.key))return null;
  return (Array.isArray(quotes)?quotes:[]).find(q=>q?.provider==='mtgjson'&&q.source==='TCGplayer'&&q.currency==='USD'&&q.variant===printing.key&&q.metric==='retail'&&typeof q.amount==='number'&&providerAmount(q.amount)!==null)??null;
}
export function gameReferenceForPrinting(printing,references) {
  if(!Array.isArray(references)||!['mtgjson','ygoprodeck'].includes(printing?.source))return null;
  const pool=references.filter(q=>q?.provider===printing.source&&typeof q.amount==='number'&&providerAmount(q.amount)!==null&&['USD','EUR'].includes(q.currency));
  if(printing.source==='mtgjson')return pool.find(q=>q.variant===printing.key&&q.source==='Cardmarket'&&q.currency==='EUR'&&q.metric==='retail')??
    pool.find(q=>q.variant===printing.key&&q.source==='Card Kingdom'&&q.currency==='USD'&&q.metric==='retail')??null;
  return pool.find(q=>q.variant===printing.key&&q.metric==='setPrice'&&q.currency==='USD'&&q.source==='YGOPRODeck')??
    pool.find(q=>q.variant==='all-printings'&&q.source==='Cardmarket'&&q.currency==='EUR'&&q.metric==='lowestAcrossPrintings')??
    pool.find(q=>q.variant==='all-printings'&&q.source==='TCGplayer'&&q.currency==='USD'&&q.metric==='lowestAcrossPrintings')??null;
}
