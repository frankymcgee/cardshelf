import { createHash } from 'node:crypto';
import { ensure } from './errors.mjs';
import * as v from './validate.mjs';
import { SALE_CONDITIONS, DELIVERY_OPTIONS, REPORT_REASONS, SALE_STATES, canTransitionSale } from '../shared/marketplace.mjs';
export const PHOTO_INPUT_LIMIT = 2_000_000;
export const PHOTO_STORED_LIMIT = 1_000_000;
export const PHOTO_QUOTA = 64_000_000;
export function exact(input, fields) {
  const o = v.object(input);
  ensure(Object.keys(o).every(key => fields.includes(key)), 400, 'The request contains an unsupported field.');
  return o;
}
export function revision(value) { return v.integer(value, 'Revision', 1, 2147483646); }
export function askingPrice(value) { return v.integer(value, 'Asking price in AUD cents', 1, 10_000_000); }
export function listingInput(input) {
  const o = exact(input, ['request_id', 'printing_id', 'seller_alias', 'condition', 'price_minor', 'delivery', 'postage_minor', 'region', 'description', 'ownership_confirmed', 'photos']);
  ensure(o.ownership_confirmed === true, 400, 'Confirm that you own this genuine card and may sell it using these photos.');
  ensure(Array.isArray(o.photos) && o.photos.length === 2, 400, 'Add one front and one back photo of the actual card.');
  const delivery = v.oneOf(o.delivery, 'Delivery method', DELIVERY_OPTIONS);
  const postage = v.integer(o.postage_minor, 'Postage in AUD cents', 0, 100_000);
  ensure(delivery !== 'pickup' || postage === 0, 400, 'Pickup-only listings must have zero postage.');
  return { request_id: v.uuid(o.request_id, 'Request ID'), printing_id: v.uuid(o.printing_id, 'Printing'),
    seller_alias: v.text(o.seller_alias, 'Public seller name', 2, 40),
    condition: v.oneOf(o.condition, 'Condition', SALE_CONDITIONS), price_minor: askingPrice(o.price_minor),
    delivery, postage_minor: postage, region: v.text(o.region, 'Suburb or city', 2, 80),
    description: v.text(o.description, 'Description', 10, 2000), ownership_confirmed: true };
}
export function listingEdit(input, current) {
  const o = exact(input, ['revision', 'status', 'price_minor', 'postage_minor', 'description']);
  const state = v.oneOf(o.status, 'Listing status', SALE_STATES);
  ensure(canTransitionSale(current.status, state), 409, 'This listing cannot move to that status. Sold listings cannot be reopened.');
  ensure(!current.hidden || state !== 'active', 409, 'An administrator has hidden this listing. It cannot be relisted.');
  const price = askingPrice(o.price_minor), postage = v.integer(o.postage_minor, 'Postage in AUD cents', 0, 100_000);
  const description = v.text(o.description, 'Description', 10, 2000);
  ensure(current.delivery !== 'pickup' || postage === 0, 400, 'Pickup-only listings must have zero postage.');
  ensure(current.status !== 'sold' || (price === current.price_minor && postage === current.postage_minor && description === current.description), 409, 'Sold listings are read-only.');
  return { revision: revision(o.revision), status: state, price_minor: price, postage_minor: postage, description };
}
export function messageInput(input, first = false) {
  const o = exact(input, first ? ['request_id', 'message', 'revision'] : ['request_id', 'message']);
  return { request_id: v.uuid(o.request_id, 'Request ID'), message: v.text(o.message, 'Message', 1, 2000),
    ...(first ? { revision: revision(o.revision) } : {}) };
}
export function reportInput(input) {
  const o = exact(input, ['reason', 'details']);
  return { reason: v.oneOf(o.reason, 'Report reason', REPORT_REASONS), details: v.text(o.details, 'Details', 10, 1500) };
}
export function queryInput(query = {}) {
  return { page: v.integer(Number(query.page ?? 1), 'Page', 1, 10000),
    q: v.text(query.q ?? '', 'Search', 0, 100),
    language: v.oneOf(query.language ?? '', 'Language', ['', 'en', 'ja']),
    condition: v.oneOf(query.condition ?? '', 'Condition', ['', ...SALE_CONDITIONS]),
    mine: v.oneOf(query.mine ?? 'false', 'My listings', ['false', 'true']) === 'true',
    order: v.oneOf(query.order ?? 'newest', 'Sort', ['newest', 'price_low', 'price_high']) };
}
export function contentHash(value) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
export function decodeSalePhoto(input) {
  const p = exact(input, ['side', 'content_type', 'data_base64']);
  const side = v.oneOf(p.side, 'Photo side', ['front', 'back']);
  const type = v.oneOf(p.content_type, 'Photo format', ['image/jpeg', 'image/png', 'image/webp']);
  const encoded = p.data_base64;
  ensure(typeof encoded === 'string' && encoded.length > 0 && encoded.length <= Math.ceil(PHOTO_INPUT_LIMIT / 3) * 4, 413, 'Each photo must be 2 MB or smaller.');
  ensure(encoded.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(encoded), 400, 'Invalid photo encoding.');
  const data = Buffer.from(encoded, 'base64');
  ensure(data.length <= PHOTO_INPUT_LIMIT && data.toString('base64') === encoded, 400, 'Invalid photo encoding.');
  const png = data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  const jpeg = data[0] === 255 && data[1] === 216 && data[2] === 255;
  const webp = data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP';
  ensure((type === 'image/png' && png) || (type === 'image/jpeg' && jpeg) || (type === 'image/webp' && webp), 415, 'Use actual PNG, JPEG or WebP image files. SVG is not supported.');
  return { side, type, data };
}
