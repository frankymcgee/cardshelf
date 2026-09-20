import { AppError } from '../errors.mjs';
export function check(ok, message, status = 400) { if (!ok) throw new AppError(status, message); }
export function object(value, keys) { check(value && typeof value === 'object' && !Array.isArray(value), 'Send an object.'); check(Object.keys(value).every(k => keys.includes(k)), 'Unsupported request field.'); return value; }
export function integer(value, min = 0, max = Number.MAX_SAFE_INTEGER) { check(Number.isSafeInteger(value) && value >= min && value <= max, `Use a whole number between ${min} and ${max}.`); return value; }
export function text(value, min = 1, max = 100) { check(typeof value === 'string' && !/[\u0000-\u001f\u007f]/.test(value) && value.trim().length >= min && value.trim().length <= max, `Use ${min}–${max} characters without control characters.`); return value.trim(); }
export function uuid(value) { check(typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value), 'Invalid identifier.'); return value; }
export function oneOf(value, choices) { check(choices.includes(value), 'Unsupported selection.'); return value; }
export function cardId(value) { const id=text(value,4,103); check(/^en:[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(id),'Use an English Pokémon catalogue ID.'); return id; }
