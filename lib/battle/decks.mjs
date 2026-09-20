import { db } from '../db.mjs';
import { ensure } from '../errors.mjs';
import { requireBattle } from './access.mjs';
import { battleAdapter } from './adapters/index.mjs';
import * as input from './input.mjs';
export const battleUserLock=(sql,id)=>sql`SELECT pg_advisory_xact_lock(hashtextextended(${'battle-user:'+id},0))`;
export async function battleCards(userId,query={}) {
  await requireBattle(userId);
  const q=input.text(query.q??'','search',0,100),page=input.integer(Number(query.page??1),1,1000),owned=query.owned==='1';
  ensure(query.game===undefined||query.game==='pokemon',400,'Only Pokémon is supported.');
  const sql=db(),pattern='%'+q.replace(/[\\%_]/g,'\\$&')+'%';
  const rows=await sql`SELECT c.*,s.name AS set_name,coalesce(o.quantity,0)::integer AS owned_quantity
    FROM cards c JOIN card_sets s ON s.id=c.set_id LEFT JOIN (
      SELECT p.card_id,sum(e.quantity) AS quantity FROM printings p JOIN collection_entries e ON e.printing_id=p.id WHERE e.user_id=${userId} GROUP BY p.card_id
    ) o ON o.card_id=c.id WHERE c.game='pokemon' AND c.language='en'
    ${q?sql`AND (c.name ILIKE ${pattern} OR c.local_id=${q})`:sql``} ${owned?sql`AND o.quantity>0`:sql``}
    ORDER BY lower(c.name),c.id LIMIT 31 OFFSET ${(page-1)*30}`;
  return {items:rows.slice(0,30).map(r=>({...battleAdapter('pokemon').cardSnapshot(r),owned_quantity:r.owned_quantity})),page,has_more:rows.length>30};
}
export async function resolveDeckCards(cards,sql=db()) {
  if(!cards.length)return [];
  const rows=await sql`SELECT c.*,s.name AS set_name FROM cards c JOIN card_sets s ON s.id=c.set_id WHERE c.id IN ${sql(cards.map(r=>r.card_id))}`;
  const adapter=battleAdapter('pokemon');
  return cards.map(r=>{
    const found=rows.find(c=>c.id===r.card_id);ensure(found,409,'A selected card is missing from the local catalogue. Reimport it or edit the deck.');
    return {card:adapter.cardSnapshot(found),quantity:r.quantity};
  });
}
export async function deckView(row,sql=db()) {
  const cards=await resolveDeckCards(row.cards,sql);
  return {id:row.id,title:row.title,game:row.game,revision:row.revision,cards,validation:battleAdapter(row.game).validateDeck(cards),updated_at:row.updated_at};
}
export async function listDecks(userId) {
  await requireBattle(userId);const rows=await db()`SELECT id,title,game,cards,revision,updated_at FROM battle_decks WHERE user_id=${userId} ORDER BY updated_at DESC LIMIT 40`;
  return {decks:rows.map(r=>({id:r.id,title:r.title,game:r.game,revision:r.revision,total:r.cards.reduce((n,c)=>n+c.quantity,0),updated_at:r.updated_at}))};
}
export async function getDeck(userId,id) {
  input.uuid(id);await requireBattle(userId);const [row]=await db()`SELECT * FROM battle_decks WHERE id=${id} AND user_id=${userId}`;
  ensure(row,404,'Deck not found.');return deckView(row);
}
export async function saveDeck(userId,id,value) {
  const data=input.deckInput(value);if(id)input.uuid(id);
  return db().begin(async sql=>{
    await requireBattle(userId,sql,true);await battleUserLock(sql,userId);
    if(!id){
      const [previous]=await sql`SELECT * FROM battle_decks WHERE user_id=${userId} AND create_request_id=${data.request_id}`;
      if(previous){ensure(previous.create_hash===input.hash(data),409,'This deck request ID was already used for different data.');return deckView(previous,sql);}
      ensure(data.revision===0,409,'New decks start at revision zero.');
      ensure(Number((await sql`SELECT count(*) AS n FROM battle_decks WHERE user_id=${userId}`)[0].n)<40,409,'The beta allows 40 saved decks. Delete an unused deck first.');
    }
    const cards=await resolveDeckCards(data.cards,sql);battleAdapter(data.game).validateDeck(cards);
    let row;
    if(id){
      [row]=await sql`UPDATE battle_decks SET title=${data.title},cards=${sql.json(data.cards)},revision=revision+1,updated_at=now()
        WHERE id=${id} AND user_id=${userId} AND revision=${data.revision} RETURNING *`;
      ensure(row,409,'The deck changed or is not yours. Reload before saving.');
    }else [row]=await sql`INSERT INTO battle_decks(user_id,title,game,cards,create_request_id,create_hash) VALUES(${userId},${data.title},${data.game},${sql.json(data.cards)},${data.request_id},${input.hash(data)}) RETURNING *`;
    return deckView(row,sql);
  });
}
export async function deleteDeck(userId,id,value) {
  input.uuid(id);const o=input.object(value,['revision','confirm_title']);input.integer(o.revision,1);input.text(o.confirm_title,'deck title');
  return db().begin(async sql=>{
    await requireBattle(userId,sql,true);await battleUserLock(sql,userId);
    const rows=await sql`DELETE FROM battle_decks WHERE id=${id} AND user_id=${userId} AND revision=${o.revision} AND title=${o.confirm_title} RETURNING id`;
    ensure(rows.length,409,'Deck title or revision changed. Reload before deleting.');return {deleted:true};
  });
}
export async function matchDeck(sql,userId,id,revision) {
  input.uuid(id);input.integer(revision,1);
  const [deck]=await sql`SELECT * FROM battle_decks WHERE id=${id} AND user_id=${userId} FOR SHARE`;
  ensure(deck&&deck.revision===revision,409,'Select your current saved deck.');
  const view=await deckView(deck,sql);ensure(view.validation.playable,400,view.validation.errors.join(' '));
  return {title:deck.title,cards:view.cards,validation:view.validation};
}
