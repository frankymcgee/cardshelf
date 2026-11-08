import { reconcileProviderPrintings } from '../lib/printing-availability.mjs';

// Reuse stored exact-card evidence; no network requests or ownership rewrites.
// The migration runner supplies its transaction and global migration lock.
export async function migrate(sql) {
  let cursor = '';
  while (true) {
    const cards = await sql`SELECT id,raw_data FROM cards WHERE game='pokemon' AND id>${cursor}
      AND (raw_data ? 'pricing' OR raw_data ? 'variants_detailed') ORDER BY id LIMIT 250 FOR UPDATE`;
    if (!cards.length) break;
    for (const card of cards) await reconcileProviderPrintings(sql,card.id,card.raw_data?.variants,card.raw_data);
    cursor = cards.at(-1).id;
  }
}
