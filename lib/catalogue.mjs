import { db, audit } from './db.mjs';
import { ensure } from './errors.mjs';
import * as v from './validate.mjs';
function pattern(value) { return '%' + value.replace(/[\\%_]/g, '\\$&') + '%'; }
export async function catalogueCards(userId, query = {}) {
  const sql = db();
  const page = v.integer(Number(query.page ?? 1), 'Page', 1, 100000);
  const limit = v.integer(Number(query.limit ?? 30), 'Page size', 1, 60);
  const search = v.text(query.q ?? '', 'Search', 0, 100);
  const artist = v.text(query.artist ?? '', 'Illustrator', 0, 100);
  const language = query.language ? v.language(query.language) : '';
  const set = query.set ? v.text(query.set, 'Set', 1, 104) : '';
  const rarity = v.text(query.rarity ?? '', 'Rarity', 0, 100);
  const ownership = v.oneOf(query.ownership ?? 'all', 'Ownership', ['all','owned','missing','wishlist']);
  const order = v.oneOf(query.sort ?? 'number', 'Sort order', ['number','name']);
  const dex = query.dex ? v.integer(Number(query.dex), 'Pokédex number', 1, 10000) : null;
  const from = sql`FROM cards c JOIN card_sets s ON c.set_id = s.id LEFT JOIN (
    SELECT p.card_id, sum(e.quantity)::integer AS quantity, bool_or(e.wishlist) AS wishlist
    FROM collection_entries e JOIN printings p ON p.id = e.printing_id WHERE e.user_id = ${userId} GROUP BY p.card_id
  ) owned ON owned.card_id = c.id`;
  const where = sql`WHERE true
    ${search ? sql`AND (c.name ILIKE ${pattern(search)} OR c.local_id = ${search} OR c.provider_id = ${search})` : sql``}
    ${artist ? sql`AND c.illustrator ILIKE ${pattern(artist)}` : sql``}
    ${language ? sql`AND c.language = ${language}` : sql``}
    ${set ? sql`AND c.set_id = ${set}` : sql``}
    ${rarity ? sql`AND c.rarity = ${rarity}` : sql``}
    ${dex ? sql`AND c.dex_ids @> ARRAY[${dex}]::integer[]` : sql``}
    ${ownership === 'owned' ? sql`AND coalesce(owned.quantity, 0) > 0` : sql``}
    ${ownership === 'missing' ? sql`AND coalesce(owned.quantity, 0) = 0` : sql``}
    ${ownership === 'wishlist' ? sql`AND owned.wishlist IS TRUE` : sql``}`;
  const sort = order === 'name' ? sql`lower(c.name), c.set_id, length(c.local_id), c.local_id, c.id`
    : sql`s.release_date DESC NULLS LAST, c.set_id, length(c.local_id), c.local_id, c.id`;
  const [items, count] = await Promise.all([
    sql`SELECT c.id,c.provider_id,c.local_id,c.name,c.language,c.image_url,c.rarity,c.illustrator,c.dex_ids,
      s.name AS set_name,c.set_id,coalesce(owned.quantity,0) AS quantity,coalesce(owned.wishlist,false) AS wishlist
      ${from} ${where} ORDER BY ${sort} LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
    sql`SELECT count(*)::integer AS total ${from} ${where}`
  ]);
  return { items, total: count[0].total, page, limit };
}
export async function catalogueFacets() {
  const sql = db();
  const [sets, rarities] = await Promise.all([
    sql`SELECT s.*, count(c.id)::integer AS imported_count FROM card_sets s LEFT JOIN cards c ON c.set_id=s.id
        GROUP BY s.id ORDER BY s.release_date DESC NULLS LAST, s.name`,
    sql`SELECT DISTINCT rarity FROM cards WHERE rarity <> '' ORDER BY rarity`
  ]);
  return { sets, rarities: rarities.map(row => row.rarity) };
}
export async function getCard(userId, cardId) {
  const id = v.cardId(cardId), sql = db();
  const [card] = await sql`SELECT c.id,c.provider_id,c.local_id,c.name,c.language,c.image_url,c.rarity,c.illustrator,c.dex_ids,
    c.category,c.set_id,s.name AS set_name FROM cards c JOIN card_sets s ON s.id=c.set_id WHERE c.id=${id}`;
  ensure(card, 404, 'Card not found in the local catalogue.');
  const printings = await sql`SELECT * FROM printings WHERE card_id=${id} ORDER BY source, label`;
  const entries = await sql`SELECT e.* FROM collection_entries e JOIN printings p ON p.id=e.printing_id
    WHERE p.card_id=${id} AND e.user_id=${userId} ORDER BY e.condition`;
  return { ...card, printings, entries };
}
export async function addPrinting(actorId, idInput, input) {
  const cardId = v.cardId(idInput), o = v.object(input), label = v.text(o.label, 'Printing label', 1, 120);
  const verified = v.bool(o.verified ?? false, 'Verified');
  const slug = label.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70);
  // Preserve arbitrary-language labels while keeping the portable key deterministic.
  const { digest } = await import('./security.mjs');
  const key = 'manual-' + (slug || digest(label).slice(0,16));
  try {
    return await db().begin(async sql => {
      ensure((await sql`SELECT id FROM cards WHERE id=${cardId}`).length, 404, 'Card not found.');
      const [printing] = await sql`INSERT INTO printings(card_id,key,label,source,verified)
        VALUES (${cardId},${key},${label},'manual',${verified}) RETURNING *`;
      await audit(sql,actorId,'catalogue.add_printing',{card_id:cardId,printing_id:printing.id}); return printing;
    });
  } catch (error) { if (error.code === '23505') ensure(false, 409, 'A manual printing with this label already exists.'); throw error; }
}
export async function dashboard(userId) {
  const sql = db();
  const [counts, progress, binders] = await Promise.all([
    sql`SELECT
      (SELECT coalesce(sum(quantity),0)::integer FROM collection_entries WHERE user_id=${userId}) AS copies,
      (SELECT count(DISTINCT printing_id)::integer FROM collection_entries WHERE user_id=${userId} AND quantity>0) AS owned_printings,
      (SELECT count(DISTINCT printing_id)::integer FROM collection_entries WHERE user_id=${userId} AND wishlist) AS wishlist,
      (SELECT count(*)::integer FROM binders WHERE user_id=${userId}) AS binders,
      (SELECT count(*)::integer FROM cards) AS catalogue_cards`,
    sql`SELECT s.id,s.name,s.language,s.card_count,count(c.id)::integer AS imported,
      count(c.id) FILTER(WHERE o.card_id IS NOT NULL)::integer AS owned
      FROM card_sets s JOIN cards c ON c.set_id=s.id
      LEFT JOIN (SELECT DISTINCT p.card_id FROM collection_entries e JOIN printings p ON p.id=e.printing_id
        WHERE e.user_id=${userId} AND e.quantity>0) o ON o.card_id=c.id
      GROUP BY s.id ORDER BY count(c.id) FILTER(WHERE o.card_id IS NOT NULL) DESC,s.name LIMIT 12`,
    sql`SELECT b.*,count(s.position)::integer AS filled FROM binders b LEFT JOIN binder_slots s ON s.binder_id=b.id
      WHERE b.user_id=${userId} GROUP BY b.id ORDER BY b.updated_at DESC LIMIT 4`
  ]);
  return { counts: counts[0], progress, binders };
}
