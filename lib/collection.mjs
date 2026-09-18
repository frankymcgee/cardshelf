import { requirePrintingGame } from './game-access.mjs';
import { db, collectionLock, audit } from './db.mjs';
import { ensure } from './errors.mjs';
import { entryInput } from './validate.mjs';
export async function saveEntry(userId, input) {
  const data = entryInput(input);
  return db().begin(async sql => {
    await collectionLock(sql,userId);
    await requirePrintingGame(sql,userId,data.printing_id);
    ensure((await sql`SELECT id FROM printings WHERE id=${data.printing_id}`).length, 404, 'Printing not found.');
    const [current] = await sql`SELECT * FROM collection_entries WHERE user_id=${userId}
      AND printing_id=${data.printing_id} AND condition=${data.condition} FOR UPDATE`;
    ensure((current?.revision ?? 0) === data.revision, 409,
      'This row was changed in another session. Reload the card before saving.', { current: current || null });
    const [entry] = await sql`INSERT INTO collection_entries(user_id,printing_id,condition,quantity,wishlist,notes)
      VALUES (${userId},${data.printing_id},${data.condition},${data.quantity},${data.wishlist},${data.notes})
      ON CONFLICT(user_id,printing_id,condition) DO UPDATE SET quantity=excluded.quantity,wishlist=excluded.wishlist,
      notes=excluded.notes,revision=collection_entries.revision+1,updated_at=now() RETURNING *`;
    return entry;
  });
}
export async function exportEntries(userId) {
  return db()`SELECT c.game,c.language,c.provider_id AS card_id,c.name AS card_name,c.set_id,p.key AS printing,p.label AS printing_label,
    e.condition,e.quantity,e.wishlist,e.notes FROM collection_entries e JOIN printings p ON e.printing_id=p.id
    JOIN cards c ON p.card_id=c.id WHERE e.user_id=${userId} AND (e.quantity>0 OR e.wishlist OR e.notes<>'')
    ORDER BY c.id,p.key,e.condition`;
}
export async function importEntries(userId, parsed, mode, apply) {
  return db().begin(async sql => {
    // Lock both preview and apply to get a consistent per-user view. Applying
    // re-resolves every input; client-supplied printing IDs are never trusted.
    await collectionLock(sql,userId);
    const resolved = [], rejected = [...parsed.errors];
    for (const row of parsed.rows) {
      const [printing] = await sql`SELECT p.id FROM printings p JOIN cards c ON c.id=p.card_id
        WHERE c.game=${row.game||'pokemon'} AND c.language=${row.language} AND c.provider_id=${row.card_id} AND p.key=${row.printing}`;
      if (!printing) { rejected.push({ row:row.row, message:'Card or printing not found. Import the set or add the matching manual printing first.' }); continue; }
      resolved.push({...row,printing_id:printing.id});
    }
    let changed=0;
    if (apply) {
      for (const row of resolved) {
        await requirePrintingGame(sql,userId,row.printing_id);
        const [existing] = await sql`SELECT * FROM collection_entries WHERE user_id=${userId} AND printing_id=${row.printing_id} AND condition=${row.condition}`;
        const quantity = mode==='replace' ? row.quantity : Math.max(existing?.quantity??0,row.quantity);
        const wishlist = mode==='replace' ? row.wishlist : Boolean(existing?.wishlist || row.wishlist);
        const notes = mode==='replace' ? row.notes : (existing?.notes || row.notes);
        if (existing && existing.quantity===quantity && existing.wishlist===wishlist && existing.notes===notes) continue;
        await sql`INSERT INTO collection_entries(user_id,printing_id,condition,quantity,wishlist,notes)
          VALUES(${userId},${row.printing_id},${row.condition},${quantity},${wishlist},${notes})
          ON CONFLICT(user_id,printing_id,condition) DO UPDATE SET quantity=excluded.quantity,wishlist=excluded.wishlist,
            notes=excluded.notes,revision=collection_entries.revision+1,updated_at=now()`;
        changed++;
      }
      await audit(sql,userId,'collection.import',{mode,changed,rejected:rejected.length});
    }
    return { matched:resolved.length,rejected:rejected.length,errors:rejected.slice(0,100),
      sample:resolved.slice(0,15).map(({printing_id,...row})=>row),changed,applied:apply };
  });
}
