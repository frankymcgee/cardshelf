import { db } from './db.mjs';
import { ensure } from './errors.mjs';
import * as v from './validate.mjs';
import { GAME_CODES,GAMES } from '../shared/games.mjs';
import { getCardPrices,cataloguePriceBadges } from './prices.mjs';
const pattern=text=>'%'+text.replace(/[\\%_]/g,'\\$&')+'%';
export async function publicCatalogue(query={}) {
  const sql=db(),game=v.oneOf(query.game??'pokemon','Game',GAME_CODES),q=v.text(query.q??'','Search',0,100),
    page=v.integer(Number(query.page??1),'Page',1,10000),limit=30,
    set=query.set?v.cardId(query.set):'',language=v.language(query.language??'en');
  const where=sql`WHERE c.game=${game} AND c.language=${language}
    ${q?sql`AND (c.name ILIKE ${pattern(q)} OR c.local_id=${q})`:sql``}
    ${set?sql`AND c.set_id=${set}`:sql``}`;
  const [items,counts]=await Promise.all([
    sql`SELECT c.id,c.name,c.local_id,c.game,c.language,c.rarity,c.image_url,c.set_id,s.name AS set_name
      FROM cards c JOIN card_sets s ON s.id=c.set_id ${where}
      ORDER BY s.release_date DESC NULLS LAST,c.set_id,length(c.local_id),c.local_id,c.id LIMIT ${limit} OFFSET ${(page-1)*limit}`,
    sql`SELECT count(*)::integer AS total FROM cards c ${where}`
  ]);
  return {games:GAMES,game,page,limit,total:counts[0].total,items:await cataloguePriceBadges(items)};
}
export async function publicSets(query={}) {
  const game=v.oneOf(query.game??'pokemon','Game',GAME_CODES),language=v.language(query.language??'en');
  return db()`SELECT s.id,s.name,s.game,s.language,s.release_date,count(c.id)::integer AS imported_count
    FROM card_sets s JOIN cards c ON c.set_id=s.id WHERE s.game=${game} AND s.language=${language}
    GROUP BY s.id ORDER BY s.release_date DESC NULLS LAST,s.name LIMIT 5000`;
}
export async function publicCard(idInput) {
  const id=v.cardId(idInput),sql=db();
  const [row]=await sql`SELECT c.id,c.name,c.local_id,c.game,c.language,c.rarity,c.illustrator,c.category,c.image_url,c.set_id,s.name AS set_name,
    c.raw_data->>'public_text' AS rules_text,c.raw_data->>'image_note' AS image_note,c.raw_data->'faces' AS faces,c.raw_data->>'back_image_url' AS back_image_url
    FROM cards c JOIN card_sets s ON s.id=c.set_id WHERE c.id=${id}`;
  ensure(row,404,'Card not found in the imported catalogue.');
  const printings=await sql`SELECT id,key,label,source FROM printings WHERE card_id=${id} ORDER BY label`;
  return {...row,rules_text:typeof row.rules_text==='string'?row.rules_text.slice(0,12000):'',
    faces:Array.isArray(row.faces)?row.faces.slice(0,4).map(face=>({name:String(face?.name??'').slice(0,200),text:String(face?.text??'').slice(0,12000)})):[],
    back_image_url:/^\/api\/public\/catalogue\/artwork\/[a-f0-9]{64}$/.test(row.back_image_url??'')?row.back_image_url:null,
    provider:GAMES.find(game=>game.code===row.game)?.provider,printings};
}
export async function publicPrices(id) {
  const data=await getCardPrices(null,id);
  return {...data,last_error:data.last_error?'The latest source refresh failed. Last-known values may be shown.':''};
}
export async function catalogueArtwork(id) {
  ensure(typeof id==='string'&&/^[a-f0-9]{64}$/.test(id),404,'Artwork unavailable.');
  const [row]=await db()`SELECT content FROM catalogue_artwork WHERE id=${id}`;
  ensure(row,404,'Artwork unavailable.');return row.content;
}
