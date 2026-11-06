import { valueRows } from './price-logic.mjs';

const round = value => Math.round((value + Number.EPSILON) * 100) / 100;

export function portfolioAllocation(rows, rates, now = Date.now()) {
  const games = new Map();
  for (const row of rows) {
    if (!games.has(row.game)) games.set(row.game, []);
    games.get(row.game).push(row);
  }
  return [...games].map(([game, items]) => ({ game, ...valueRows(items, rates, now) }))
    .sort((a, b) => (b.aud_total ?? -1) - (a.aud_total ?? -1) || a.game.localeCompare(b.game));
}

// Compare retained copies on the same pricing basis. Purchases, removals and
// changes of provider/coverage must never masquerade as a market mover.
export function portfolioMovers(before, after, metadata) {
  if (!before || !after || before.snapshot_date === after.snapshot_date) return null;
  const previous = new Map(before.holdings.map(row => [row.printing_id, row]));
  const cards = new Map(metadata.map(row => [row.printing_id, row]));
  const movers = [];
  let comparable = 0;
  for (const current of after.holdings) {
    const old = previous.get(current.printing_id), card = cards.get(current.printing_id);
    const quantity = Math.min(old?.quantity ?? 0, current.quantity);
    if (!card || quantity <= 0 || !old?.basis || old.basis !== current.basis ||
      !Number.isFinite(old.unit_aud) || !Number.isFinite(current.unit_aud) || old.unit_aud <= 0 || current.unit_aud <= 0) continue;
    comparable++;
    const change = round(quantity * (current.unit_aud - old.unit_aud));
    if (!change) continue;
    movers.push({ printing_id: current.printing_id, card_id: card.card_id, name: card.name,
      local_id: card.local_id, label: card.label, language: card.language, game: card.game, set_name: card.set_name,
      quantity, change_aud: change, percent: round((current.unit_aud / old.unit_aud - 1) * 100) });
  }
  const order = (a, b) => Math.abs(b.change_aud) - Math.abs(a.change_aud) || a.printing_id.localeCompare(b.printing_id);
  return { from: before.snapshot_date, to: after.snapshot_date, comparable_printings: comparable,
    gainers: movers.filter(row => row.change_aud > 0).sort(order).slice(0, 3),
    decliners: movers.filter(row => row.change_aud < 0).sort(order).slice(0, 3) };
}
