import { db } from '../db.mjs';
import { hash } from '../battle/input.mjs';
import { compileArenaCard,deckValidation } from './cards.mjs';
import { requireArena } from './access.mjs';
import { ARENA_VERSION } from '../../shared/arena.mjs';
import * as v from './input.mjs';
export const arenaUserLock=(sql,id)=>sql`SELECT pg_advisory_xact_lock(hashtextextended(${'arena-user:'+id},0))`;
function deckInput(value){
  const o=v.object(value,['title','cards','revision','request_id']);const title=v.text(o.title,1,80);v.integer(o.revision);v.uuid(o.request_id);
  v.check(Array.isArray(o.cards)&&o.cards.length<=60,'Use at most 60 card entries.');const seen=new Set();
  const cards=o.cards.map(x=>{v.object(x,['card_id','quantity']);const id=v.cardId(x.card_id);v.check(!seen.has(id),'Use unique English Pokémon card IDs.');seen.add(id);return {card_id:id,quantity:v.integer(x.quantity,1,60)};});
  v.check(cards.reduce((n,c)=>n+c.quantity,0)<=60,'A saved deck cannot exceed 60 cards.');return {title,cards,revision:o.revision,request_id:o.request_id};
}
export async function resolveArenaDeck(cards,sql=db(),version=ARENA_VERSION) {
  if(!cards.length)return [];
  const rows=await sql`SELECT c.*,s.name AS set_name FROM cards c JOIN card_sets s ON s.id=c.set_id WHERE c.id IN ${sql(cards.map(c=>c.card_id))}`;
  return cards.map(c=>{const row=rows.find(r=>r.id===c.card_id);v.check(row,'A deck card is missing from the local catalogue.',409);const result=compileArenaCard(row,version);
    v.check(result.supported,`${row.name}: ${result.reason} Remove this card before using the automated format.`,422);return {card:result.card,quantity:c.quantity};});
}
export { arenaCatalogue } from './workshop.mjs';
export async function arenaDeckList(userId,sql=db()) {
  await requireArena(userId,sql);const decks=await sql`SELECT id,title,game,cards,revision,updated_at FROM arena_decks WHERE user_id=${userId} ORDER BY updated_at DESC LIMIT 40`;
  const legacy=await sql`SELECT id,title FROM battle_decks WHERE user_id=${userId} ORDER BY updated_at DESC LIMIT 40`;
  const ids=[...new Set(decks.flatMap(d=>d.cards.map(c=>c.card_id)))];
  const source=ids.length?await sql`SELECT c.*,s.name AS set_name FROM cards c JOIN card_sets s ON s.id=c.set_id WHERE c.id IN ${sql(ids)}`:[];
  const compiled=new Map(source.map(row=>[row.id,compileArenaCard(row)]));
  return {decks:decks.map(d=>{
    const resolved=d.cards.map(entry=>({card:compiled.get(entry.card_id)?.card,quantity:entry.quantity}));
    const unavailable=d.cards.some(entry=>!compiled.get(entry.card_id)?.supported);
    const validation=deckValidation(resolved);
    if(unavailable){validation.playable=false;validation.errors.unshift('A card is missing or no longer supported. Open this deck to review it.');}
    const faces=resolved.filter(row=>row.card).sort((a,b)=>(a.card.kind==='pokemon'?0:1)-(b.card.kind==='pokemon'?0:1));
    return {...d,total:d.cards.reduce((n,c)=>n+c.quantity,0),validation,preview:faces.slice(0,3).map(row=>row.card),
      groups:['pokemon','trainer','energy'].map(kind=>({kind,count:resolved.filter(row=>row.card?.kind===kind).reduce((n,row)=>n+row.quantity,0)}))};
  }),legacy};
}
export async function arenaDeckView(userId,id,sql=db(),version=ARENA_VERSION) {
  v.uuid(id);await requireArena(userId,sql);const [row]=await sql`SELECT * FROM arena_decks WHERE id=${id} AND user_id=${userId}`;v.check(row,'Deck not found.',404);
  const source=row.cards.length?await sql`SELECT c.*,s.name AS set_name FROM cards c JOIN card_sets s ON s.id=c.set_id WHERE c.id IN ${sql(row.cards.map(c=>c.card_id))}`:[];
  const cards=row.cards.map(entry=>{
    const found=source.find(c=>c.id===entry.card_id),compiled=found?compileArenaCard(found,version):{supported:false,card:{id:entry.card_id,name:'Missing catalogue card'},reason:'This card is missing from the local catalogue.'};
    return {...compiled,quantity:entry.quantity};
  });
  const validation=deckValidation(cards,version);
  if(cards.some(c=>!c.supported)){validation.playable=false;validation.errors.unshift('Remove or replace the unavailable cards before saving or playing.');}
  return {id:row.id,title:row.title,revision:row.revision,cards,validation};
}
export async function saveArenaDeck(userId,id,value) {
  const data=deckInput(value);if(id)v.uuid(id);
  return db().begin(async sql=>{
    await requireArena(userId,sql,true);await arenaUserLock(sql,userId);
    if(!id){const [old]=await sql`SELECT * FROM arena_decks WHERE user_id=${userId} AND request_id=${data.request_id}`;
      if(old){v.check(old.request_hash===hash(data),'Request ID was used for another deck.',409);return arenaDeckView(userId,old.id,sql);}
      v.check(data.revision===0,'New decks start at revision zero.',409);
      v.check(Number((await sql`SELECT count(*) AS n FROM arena_decks WHERE user_id=${userId}`)[0].n)<40,'Delete an unused deck before creating another.',409);
    }
    const cards=await resolveArenaDeck(data.cards,sql);deckValidation(cards);let row;
    if(id){[row]=await sql`UPDATE arena_decks SET title=${data.title},cards=${sql.json(data.cards)},revision=revision+1,updated_at=now() WHERE id=${id} AND user_id=${userId} AND revision=${data.revision} RETURNING id`;v.check(row,'Deck changed or is unavailable. Reload before saving.',409);}
    else [row]=await sql`INSERT INTO arena_decks(user_id,title,cards,request_id,request_hash) VALUES(${userId},${data.title},${sql.json(data.cards)},${data.request_id},${hash(data)}) RETURNING id`;
    return arenaDeckView(userId,row.id,sql);
  });
}
export async function deleteArenaDeck(userId,id,value) {
  v.uuid(id);const o=v.object(value,['revision','title']);v.integer(o.revision,1);v.text(o.title,1,80);
  return db().begin(async sql=>{await requireArena(userId,sql,true);await arenaUserLock(sql,userId);const rows=await sql`DELETE FROM arena_decks WHERE id=${id} AND user_id=${userId} AND revision=${o.revision} AND title=${o.title} RETURNING id`;v.check(rows.length,'Deck changed. Reload before deleting.',409);return {deleted:true};});
}
export async function snapshotArenaDeck(sql,userId,id,revision,version=ARENA_VERSION) {
  const deck=await arenaDeckView(userId,v.uuid(id),sql,version);v.check(deck.revision===v.integer(revision,1),'Select the latest saved deck.',409);v.check(deck.validation.playable,deck.validation.errors.join(' '));return {title:deck.title,cards:deck.cards.map(({card,quantity})=>({card,quantity}))};
}
export async function legacyArenaDeck(userId,id) {
  v.uuid(id);await requireArena(userId);const [deck]=await db()`SELECT title,cards FROM battle_decks WHERE id=${id} AND user_id=${userId}`;v.check(deck,'Legacy deck not found.',404);
  const cards=await resolveArenaDeck(deck.cards);return {title:deck.title,cards,validation:deckValidation(cards)};
}
