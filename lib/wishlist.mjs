import { db, collectionLock } from './db.mjs';
import { requirePrintingGame } from './game-access.mjs';
import { wishlistInput, wishlistChange } from './wishlist-logic.mjs';
import { printingWishlisted } from '../shared/wishlist.mjs';
/** Atomically change only wishlist flags. Never accept ownership or account fields. */
export async function saveWishlist(userId, input) {
  const data = wishlistInput(input);
  return db().begin(async sql => {
    // Share the same lock as ownership/import, game choice and binder quick tracking.
    await collectionLock(sql, userId);
    await requirePrintingGame(sql, userId, data.printing_id);
    const current = await sql`SELECT printing_id,condition,quantity,wishlist,notes,revision
      FROM collection_entries WHERE user_id=${userId} AND printing_id=${data.printing_id}
      ORDER BY condition FOR UPDATE`;
    const action = wishlistChange(current, data);
    if (action === 'add') {
      // UNKNOWN is a wish without a condition claim. Do not infer Near Mint or a copy.
      await sql`INSERT INTO collection_entries(user_id,printing_id,condition,quantity,wishlist,notes)
        VALUES(${userId},${data.printing_id},'UNKNOWN',0,true,'')
        ON CONFLICT(user_id,printing_id,condition) DO UPDATE SET wishlist=true,
          revision=collection_entries.revision+1,updated_at=now()`;
    } else if (action === 'remove') {
      // A printing may have legacy wishes in more than one condition. Clear them together.
      // Retain all rows, including zero-copy rows, so stale revisions cannot be reused.
      await sql`UPDATE collection_entries SET wishlist=false,revision=revision+1,updated_at=now()
        WHERE user_id=${userId} AND printing_id=${data.printing_id} AND wishlist=true`;
    }
    const entries = await sql`SELECT printing_id,condition,quantity,wishlist,notes,revision
      FROM collection_entries WHERE user_id=${userId} AND printing_id=${data.printing_id} ORDER BY condition`;
    return { printing_id: data.printing_id, wishlist: printingWishlisted(entries, data.printing_id), entries };
  });
}
