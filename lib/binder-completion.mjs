import { db, collectionLock, audit } from './db.mjs';
import { ensure } from './errors.mjs';
import * as v from './validate.mjs';
import { membershipState } from './membership.mjs';
import { requireGame } from './game-access.mjs';
import { canManageGame } from '../shared/games.mjs';
import { completionState, completionWishlistInput, completionSelection, completionMatchQuery, MATCH_PAGE_SIZE } from './binder-completion-logic.mjs';

async function readState(sql, userId, id, lock = false) {
  const [binder] = await sql`SELECT id,title,binder_type,game,revision,columns,rows,page_count,generation
    FROM binders WHERE id=${id} AND user_id=${userId} ${lock ? sql`FOR UPDATE` : sql``}`;
  ensure(binder, 404, 'Binder not found.');
  const slots = await sql`SELECT s.position,s.printing_id,s.is_collected,p.label,c.id AS card_id,c.name,c.local_id,c.language,c.game,c.image_url,cs.name AS set_name
    FROM binder_slots s JOIN printings p ON p.id=s.printing_id JOIN cards c ON c.id=p.card_id
    JOIN card_sets cs ON cs.id=c.set_id WHERE s.binder_id=${id} ORDER BY s.position`;
  const entries = slots.length ? await sql`SELECT printing_id,condition,quantity,wishlist,revision FROM collection_entries
    WHERE user_id=${userId} AND printing_id IN ${sql([...new Set(slots.map(s => s.printing_id))])}` : [];
  return { binder, state: completionState(binder, slots, entries) };
}
async function permissions(sql, userId, binder) {
  const [{ access }, [choice]] = await Promise.all([membershipState(userId, sql), sql`SELECT game FROM account_game_choices WHERE user_id=${userId}`]);
  const collection = access.features.some(f => f.code === 'collection');
  const game = canManageGame(access, binder.game, choice?.game ?? 'pokemon');
  return { can_add_wishlist: collection && game, can_browse_marketplace: access.features.some(f => f.code === 'marketplace_browse'),
    wishlist_reason: !collection ? 'Saving a wishlist needs collection access. Your existing binder remains readable.' :
      !game ? 'This game is read-only under your current membership. Review your selection in Card games.' : '' };
}
function available(sql, userId) { return sql`status='active' AND NOT hidden AND seller_id<>${userId}`; }
export async function getBinderCompletion(userId, idInput) {
  const id = v.uuid(idInput);
  return db().begin('isolation level repeatable read, read only', async sql => {
    const { binder, state } = await readState(sql, userId, id), access = await permissions(sql, userId, binder);
    const ids = state.items.map(item => item.printing_id);
    const matches = access.can_browse_marketplace && ids.length ? await sql`SELECT printing_id,count(*)::integer AS total
      FROM marketplace_listings WHERE printing_id IN ${sql(ids)} AND ${available(sql, userId)} GROUP BY printing_id` : [];
    const counts = new Map(matches.map(row => [row.printing_id, row.total]));
    const { generation, ...details } = binder;
    return { binder: { ...details, design_checklist: binder.binder_type === 'tracking' && generation?.options?.selection === 'designs' }, ...state,
      items: state.items.map(item => ({ ...item, match_count: counts.get(item.printing_id) || 0 })), permissions: access };
  });
}
export async function addBinderCompletionWishlist(userId, idInput, input) {
  const id = v.uuid(idInput), change = completionWishlistInput(input);
  return db().begin(async sql => {
    await collectionLock(sql, userId);
    const { binder, state } = await readState(sql, userId, id, true);
    const { access } = await membershipState(userId, sql);
    ensure(access.features.some(f => f.code === 'collection'), 403, 'Saving a wishlist needs collection access. Open Membership to review your access.');
    await requireGame(sql, userId, binder.game);
    const ids = completionSelection(binder, state, change);
    if (ids.length) {
      await sql`INSERT INTO collection_entries ${sql(ids.map(printing_id => ({ user_id: userId, printing_id, condition: 'UNKNOWN', quantity: 0, wishlist: true, notes: '' })), 'user_id', 'printing_id', 'condition', 'quantity', 'wishlist', 'notes')}
        ON CONFLICT(user_id,printing_id,condition) DO UPDATE SET wishlist=true,
          revision=collection_entries.revision+1,updated_at=now()`;
      await audit(sql, userId, 'binder.completion_wishlist', { binder_id: id, added: ids.length });
    }
    return { added: ids.length, already_wishlisted: change.printing_ids.length - ids.length };
  });
}
export async function getBinderCompletionMatches(userId, idInput, query) {
  const id = v.uuid(idInput), q = completionMatchQuery(query);
  return db().begin('isolation level repeatable read, read only', async sql => {
    const { state } = await readState(sql, userId, id);
    const { access } = await membershipState(userId, sql);
    ensure(access.features.some(f => f.code === 'marketplace_browse'), 403, 'Marketplace matches need browsing access. Open Membership to review your access.');
    const printing = state.items.find(item => item.printing_id === q.printing_id);
    ensure(printing, 409, 'This printing is no longer missing from this binder. Refresh the missing cards.');
    const filter = sql`printing_id=${q.printing_id} AND ${available(sql, userId)}`;
    const [rows, [count]] = await Promise.all([
      sql`SELECT id,seller_alias,condition,price_minor,postage_minor,delivery,region FROM marketplace_listings
        WHERE ${filter} ORDER BY price_minor,id LIMIT ${MATCH_PAGE_SIZE} OFFSET ${(q.page - 1) * MATCH_PAGE_SIZE}`,
      sql`SELECT count(*)::integer AS total FROM marketplace_listings WHERE ${filter}`
    ]);
    return { printing_id: q.printing_id, items: rows.map(row => ({ ...row, currency: 'AUD' })), total: count.total, page: q.page, page_size: MATCH_PAGE_SIZE };
  });
}
