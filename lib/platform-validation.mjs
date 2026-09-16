import { ensure } from './errors.mjs';
import * as v from './validate.mjs';
export function requestInput(input) {
  const o = v.object(input);
  ensure(o.consent === true,400,'Please agree to being contacted about this request.');
  return { name:v.text(o.name,'Name',1,80),email:v.email(o.email),
    purpose:v.oneOf(o.purpose ?? 'early_access','Request type',['early_access','support','privacy']),
    message:v.text(o.message ?? '','Message',0,1200) };
}
export function planInput(input) {
  const o=v.object(input);
  return { name:v.text(o.name,'Plan name',1,80),description:v.text(o.description ?? '','Description',0,500),
    monthly_price_minor:o.monthly_price_minor==null?null:v.integer(o.monthly_price_minor,'Monthly price in cents',0,10000000),
    annual_price_minor:o.annual_price_minor==null?null:v.integer(o.annual_price_minor,'Annual price in cents',0,100000000),
    revision:v.integer(o.revision,'Revision',1,Number.MAX_SAFE_INTEGER) };
}
export function requestStatusInput(input) {
  const o=v.object(input);
  return {status:v.oneOf(o.status,'Request status',['new','contacted','archived']),
    revision:v.integer(o.revision,'Revision',1,Number.MAX_SAFE_INTEGER)};
}
