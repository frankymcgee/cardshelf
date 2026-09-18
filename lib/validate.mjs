import { gameFromCardId } from '../shared/games.mjs';
import { ensure } from './errors.mjs';
export function object(value, name = 'Request') {
  ensure(value !== null && typeof value === 'object' && !Array.isArray(value), 400, `${name} must be an object.`);
  return value;
}
export function text(value, name, min = 0, max = 2000) {
  ensure(typeof value === 'string', 400, `${name} must be text.`);
  const result = value.trim();
  ensure(result.length >= min && result.length <= max, 400, `${name} must contain ${min}–${max} characters.`);
  ensure(!result.includes('\u0000'), 400, `${name} contains an invalid character.`);
  return result;
}
export function integer(value, name, min = 0, max = 9999) {
  ensure(typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max,
    400, `${name} must be an integer between ${min} and ${max}.`);
  return value;
}
export function bool(value, name) {
  ensure(typeof value === 'boolean', 400, `${name} must be true or false.`); return value;
}
export function oneOf(value, name, options) {
  ensure(options.includes(value), 400, `${name} is not supported.`); return value;
}
export function uuid(value, name = 'Identifier') {
  const v = text(value, name, 36, 36);
  ensure(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v), 400, `${name} is invalid.`);
  return v.toLowerCase();
}
export function language(value) { return oneOf(value, 'Language', ['en', 'ja']); }
export function providerId(value) {
  const id = text(value, 'Catalogue ID', 1, 100);
  ensure(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(id), 400, 'Catalogue ID is invalid.'); return id;
}
export function cardId(value) {
  const id = text(value, 'Card ID', 4, 160);
  ensure(gameFromCardId(id), 400, 'Card ID is invalid.');
  return id;
}
export function email(value) {
  const v = text(value, 'Email', 3, 254).toLowerCase();
  ensure(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 400, 'Enter a valid email address.'); return v;
}
export function password(value) {
  ensure(typeof value === 'string' && value.length >= 12 && value.length <= 128, 400, 'Use a password containing 12–128 characters.');
  return value;
}
export const CONDITIONS = ['NM', 'LP', 'MP', 'HP', 'DMG', 'UNKNOWN'];
export function entryInput(input) {
  const o = object(input);
  return { printing_id: uuid(o.printing_id, 'Printing'), condition: oneOf(o.condition, 'Condition', CONDITIONS),
    quantity: integer(o.quantity, 'Quantity'), wishlist: bool(o.wishlist, 'Wishlist'),
    notes: text(o.notes ?? '', 'Notes'), revision: integer(o.revision, 'Revision', 0, Number.MAX_SAFE_INTEGER) };
}
export function binderInput(input) {
  const o = object(input);
  const color = text(o.color ?? '#5546d8', 'Colour', 7, 7);
  ensure(/^#[0-9a-f]{6}$/i.test(color), 400, 'Choose a valid binder colour.');
  return { title: text(o.title, 'Binder name', 1, 100), description: text(o.description ?? '', 'Description', 0, 1000),
    columns: oneOf(o.columns, 'Columns', [2, 3, 4]), rows: oneOf(o.rows, 'Rows', [2, 3, 4]),
    page_count: integer(o.page_count, 'Page count', 1, 60), color };
}
