import { createHash } from 'node:crypto';
import { ensure } from '../errors.mjs';
export function object(value, allowed) {
  ensure(value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).every(k => allowed.includes(k)), 400, 'Unsupported battle request.');
  return value;
}
export function text(value, label, min = 1, max = 80) {
  ensure(typeof value === 'string' && !/[\u0000-\u001f\u007f]/.test(value), 400, `Enter a valid ${label}.`);
  const result = value.trim(); ensure(result.length >= min && result.length <= max, 400, `Check ${label} length.`); return result;
}
export function integer(value, min = 0, max = 1000000) {
  ensure(Number.isSafeInteger(value) && value >= min && value <= max, 400, 'Invalid battle number.'); return value;
}
export function uuid(value) {
  ensure(typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value), 400, 'Invalid battle identifier.'); return value.toLowerCase();
}
export function code(value) {
  ensure(typeof value === 'string' && /^[a-f0-9]{32}$/.test(value.trim()), 400, 'Enter the 32-character private invitation code.'); return value.trim();
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
}
export const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(canonical(value))).digest('hex');
export function envelope(input) {
  const o = object(input, ['revision', 'request_id', 'action']);
  integer(o.revision, 1); uuid(o.request_id);
  ensure(o.action && typeof o.action === 'object' && typeof o.action.type === 'string', 400, 'Choose a battle action.'); return o;
}
export function deckInput(input) {
  const o = object(input, ['title', 'game', 'cards', 'revision', 'request_id']);
  ensure(o.game === 'pokemon', 400, 'Only Pokémon is available in this battle beta.');
  const title = text(o.title, 'deck name'); integer(o.revision, 0); uuid(o.request_id);
  ensure(Array.isArray(o.cards) && o.cards.length <= 60, 400, 'A deck can have up to 60 different cards.');
  const seen = new Set();
  const cards = o.cards.map(row => {
    object(row, ['card_id', 'quantity']); const id = text(row.card_id, 'card ID', 4, 103);
    ensure(/^en:[A-Za-z0-9_-]+$/.test(id) && !seen.has(id), 400, 'Choose unique English Pokémon catalogue cards.');
    seen.add(id); return { card_id: id, quantity: integer(row.quantity, 1, 60) };
  });
  ensure(cards.reduce((n, r) => n + r.quantity, 0) <= 60, 400, 'A saved battle deck cannot exceed 60 cards.');
  return { title, game: 'pokemon', cards, revision: o.revision, request_id: o.request_id };
}
