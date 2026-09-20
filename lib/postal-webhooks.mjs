/** Postal signs exact JSON bytes with RSA/SHA256 in X-Postal-Signature-256.
 * Primary source: postalserver/postal 3.3.7 lib/postal/http.rb, signer.rb and
 * app/services/webhook_delivery_service.rb. Never fetch a callback-provided key.
 */
import { constants, createHash, createPublicKey, verify } from 'node:crypto';
import { AppError, ensure } from './errors.mjs';
export const POSTAL_WEBHOOK_LIMIT=65536;
const MAX_AGE=24*60*60*1000,FUTURE_SKEW=5*60*1000;
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const stamp=(value,now)=>{ensure(typeof value==='number'&&Number.isFinite(value)&&value>0,400,'Postal event timestamp is invalid.');const time=value*1000;ensure(time<=now+FUTURE_SKEW&&time>=now-MAX_AGE,400,'Postal event timestamp is outside the accepted window.');return time;};
const identifier=value=>typeof value==='string'&&value.length>0&&value.length<=255&&!/[\x00-\x20\x7f<>]/.test(value);
function verificationKey(pem){
  ensure(typeof pem==='string'&&pem.length<=16384&&!pem.includes('PRIVATE KEY'),503,'Postal webhook verification is not configured.');
  try{const key=createPublicKey(pem);ensure(key.asymmetricKeyType==='rsa'&&key.asymmetricKeyDetails.modulusLength>=2048&&key.asymmetricKeyDetails.modulusLength<=8192,503,'Postal webhook verification is not configured.');return key;}
  catch{throw new AppError(503,'Postal webhook verification is not configured.');}
}
export function verifyPostalWebhook(raw,signature,publicKey,{now=Date.now()}={}){
  ensure(Buffer.isBuffer(raw)&&raw.length>0&&raw.length<=POSTAL_WEBHOOK_LIMIT,413,'Postal event body is missing or too large.');
  const key=verificationKey(publicKey);
  ensure(typeof signature==='string'&&signature.length<=2048&&/^[A-Za-z0-9+/]+={0,2}$/.test(signature),401,'Postal signature is missing or invalid.');
  const bytes=Buffer.from(signature,'base64');
  ensure(bytes.toString('base64')===signature&&bytes.length===Math.ceil(key.asymmetricKeyDetails.modulusLength/8),401,'Postal signature is missing or invalid.');
  let valid=false;try{valid=verify('RSA-SHA256',raw,{key,padding:constants.RSA_PKCS1_PADDING},bytes);}catch{}
  ensure(valid,401,'Postal signature is missing or invalid.');
  let envelope;try{envelope=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}catch{throw new AppError(400,'Postal event JSON is invalid.');}
  ensure(plain(envelope)&&typeof envelope.event==='string'&&envelope.event.length<=80&&plain(envelope.payload),400,'Postal event envelope is invalid.');
  ensure(typeof envelope.uuid==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(envelope.uuid),400,'Postal event identifier is invalid.');
  const created=stamp(envelope.timestamp,now),eventKey=createHash('sha256').update(envelope.uuid.toLowerCase()).digest('hex');
  const mapping={MessageSent:['Sent','delivered'],MessageDeliveryFailed:['HardFail','failed'],MessageDelayed:['SoftFail','accepted'],MessageHeld:['Held','accepted'],MessageBounced:[null,'bounced']};
  const mappingEntry=mapping[envelope.event];if(!mappingEntry)return {eventKey,ignored:true};
  const payload=envelope.payload,bounced=envelope.event==='MessageBounced',message=bounced?payload.original_message:payload.message;
  ensure(plain(message)&&message.direction==='outgoing',400,'Postal message direction is invalid.');
  ensure(Number.isSafeInteger(message.id)&&message.id>0&&identifier(message.message_id),400,'Postal message identifiers are invalid.');
  ensure(typeof message.to==='string'&&message.to.length<=254&&/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(message.to)&&!/[\x00-\x1f\x7f]/.test(message.to),400,'Postal recipient is invalid.');
  ensure(typeof message.timestamp==='number'&&Number.isFinite(message.timestamp)&&message.timestamp>0,400,'Postal message timestamp is invalid.');
  if(!bounced)ensure(payload.status===mappingEntry[0],400,'Postal event and status disagree.');
  const at=stamp(bounced?payload.bounce?.timestamp:payload.timestamp,now);
  ensure(Math.abs(at-created)<=FUTURE_SKEW&&message.timestamp*1000<=at+FUTURE_SKEW,400,'Postal event timestamps disagree.');
  ensure(payload.sent_with_ssl===undefined||payload.sent_with_ssl===null||typeof payload.sent_with_ssl==='boolean',400,'Postal delivery security flag is invalid.');
  // No subject, SMTP output, bounce body, token, sender or raw payload leaves
  // this parser. The recipient exists only transiently for exact correlation.
  return {eventKey,ignored:false,delivery:{providerId:String(message.id),messageId:message.message_id,recipient:message.to.trim().toLowerCase(),event:mappingEntry[1],at:new Date(at).toISOString(),sentWithSsl:typeof payload.sent_with_ssl==='boolean'?payload.sent_with_ssl:null}};
}
export async function receivePostalWebhook(raw,signature,{sql,configuration,applyDelivery,now=Date.now()}={}){
  try{
    sql??=(await import('./db.mjs')).db();
    configuration??=await (await import('./email-settings.mjs')).emailConfiguration(sql);
    const parsed=verifyPostalWebhook(raw,signature,configuration.webhook_public_key,{now});
    if(parsed.ignored)return {received:true,ignored:true};
    applyDelivery??=(await import('./email-outbox.mjs')).applyPostalDeliveryEvent;
    return await sql.begin(async tx=>{
      const inserted=await tx`INSERT INTO email_webhook_receipts(event_key,provider_id) VALUES (${parsed.eventKey},${parsed.delivery.providerId}) ON CONFLICT(event_key) DO NOTHING RETURNING event_key`;
      if(!inserted.length)return {received:true,duplicate:true};
      const result=await applyDelivery(parsed.delivery,tx);
      // A webhook can race the API response. Roll back the receipt so Postal's
      // retry can correlate once the provider ID is persisted; never ack loss.
      ensure(result?.matched===true,503,'Postal message is not yet available. Retry this event.');
      return {received:true};
    });
  }catch(error){
    if(error instanceof AppError)throw error;
    // Provider payloads and database error parameters must never reach logs.
    throw new AppError(503,'Postal event processing is temporarily unavailable.');
  }
}
