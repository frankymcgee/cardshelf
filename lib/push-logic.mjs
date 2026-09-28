import { ECDH } from 'node:crypto';
import { ensure, AppError } from './errors.mjs';
import * as v from './validate.mjs';

export const PUSH_GROUPS={marketplace_enquiry:'marketplace',marketplace_reply:'marketplace',membership_changed:'membership'};
export function pushObject(input,keys) {
  const data=v.object(input);
  ensure(Object.keys(data).every(key=>keys.includes(key)),400,'Unsupported notification setting.');
  return data;
}
export function pushEndpoint(value) {
  ensure(typeof value==='string'&&value.length<=2048&&!/[\s\\]/.test(value),400,'Invalid push endpoint.');
  let url;try{url=new URL(value);}catch{throw new AppError(400,'Invalid push endpoint.');}
  // Only browser push services, never user-chosen hosts, ports or redirects.
  const host=url.hostname;
  const trusted=host==='fcm.googleapis.com'||host==='updates.push.services.mozilla.com'
    ||/^[a-z0-9-]+\.push\.apple\.com$/.test(host)
    ||/^[a-z0-9-]+\.notify\.windows\.com$/.test(host);
  ensure(trusted&&url.protocol==='https:'&&!url.username&&!url.password&&!url.hash&&(!url.port||url.port==='443')&&url.pathname!=='/',400,'This browser push service is not supported.');
  return url.href;
}
function pushKey(value,length) {
  ensure(typeof value==='string'&&/^[A-Za-z0-9_-]+$/.test(value)&&value.length<=100,400,'Invalid push encryption key.');
  const bytes=Buffer.from(value,'base64url');
  ensure(bytes.length===length&&bytes.toString('base64url')===value,400,'Invalid push encryption key.');
  return bytes;
}
export function pushSubscription(input) {
  const data=pushObject(input,['endpoint','keys','expirationTime']),keys=pushObject(data.keys,['p256dh','auth']);
  const publicKey=pushKey(keys.p256dh,65);pushKey(keys.auth,16);
  try {ensure(publicKey[0]===4,400,'Invalid push public key.');ECDH.convertKey(publicKey,'prime256v1');}
  catch {throw new AppError(400,'Invalid push public key.');}
  return {endpoint:pushEndpoint(data.endpoint),keys:{p256dh:keys.p256dh,auth:keys.auth}};
}
export function pushPreferences(input) {
  const data=pushObject(input,['marketplace','membership']);
  return {marketplace:v.bool(data.marketplace,'Marketplace notifications'),membership:v.bool(data.membership,'Membership notifications')};
}
export function pushPayload(kind,input={}) {
  ensure(Object.hasOwn(PUSH_GROUPS,kind)||kind==='test',400,'Unsupported notification event.');
  if(kind.startsWith('marketplace_')) {
    const conversation_id=v.uuid(input.conversation_id,'Conversation');
    if(kind==='marketplace_enquiry')return {conversation_id};
    const message_id=String(input.message_id);
    ensure(/^[1-9]\d{0,18}$/.test(message_id)&&BigInt(message_id)<=9223372036854775807n,400,'Invalid message identifier.');
    return {conversation_id,message_id};
  }
  return {};
}
export function pushMessage(kind,payload,eventKey) {
  const safe=pushPayload(kind,payload);
  const title=kind==='test'?'Notifications are ready':kind==='membership_changed'?'Membership updated':kind==='marketplace_enquiry'?'New marketplace enquiry':'New marketplace reply';
  return {title:'CardShelf · '+title,body:kind==='test'?'This device can receive CardShelf notifications.':'Open CardShelf to view your update.',
    url:kind==='test'?'/notifications':kind==='membership_changed'?'/membership':'/marketplace/inbox?thread='+safe.conversation_id,
    tag:eventKey};
}
export function pushOriginReady(origin) {
  try {const url=new URL(origin);return url.protocol==='https:'&&!['localhost','127.0.0.1','[::1]'].includes(url.hostname);}
  catch{return false;}
}
