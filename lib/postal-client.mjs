import { AppError,ensure } from './errors.mjs';
import { recoveryEmail } from './password-recovery-logic.mjs';
import { postalOrigin,postalApiKey,emailHeader,senderAddress } from './email-settings.mjs';
// Only the deployment-pinned Postal endpoint can receive the API credential.
export async function postalSend(config,email,message,{fetch:fetchImpl=fetch,tag='cardshelf'}={}) {
  ensure(config?.enabled&&config.configured,503,'Postal email is disabled or not configured.');
  ensure(config.origin===postalOrigin(),503,'Postal origin does not match the trusted deployment setting.');
  postalApiKey(config.secret);
  const recipient=recoveryEmail(email),from=senderAddress(config.from_address),name=emailHeader(config.sender_name,'Sender name',80);
  const subject=emailHeader(message?.subject,'Email subject',200);
  ensure(typeof message?.text==='string'&&message.text.length>0&&message.text.length<=60000&&!message.text.includes('\0'),400,'Email text is invalid.');
  ensure(typeof tag==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(tag),400,'Email category is invalid.');
  // Postal generates its own Message-ID and does not provide send idempotency.
  // Persist its returned identifiers; an early callback must retry correlation.
  const body={to:[recipient],from:JSON.stringify(name)+' <'+from+'>',subject,plain_body:message.text,tag,
    ...(config.reply_to?{reply_to:senderAddress(config.reply_to)}:{})};
  try {
    const response=await fetchImpl(config.origin+'/api/v1/send/message',{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),
      headers:{'X-Server-API-Key':config.secret,'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify(body)});
    ensure(response.ok,502,'Postal did not accept the message. Check delivery status before retrying.');
    let size=0;const chunks=[];
    for await(const chunk of response.body){size+=chunk.length;ensure(size<=65536,502,'Postal response exceeded the allowed size.');chunks.push(chunk);}
    const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    ensure(data?.status==='success'&&data.data?.messages&&Object.keys(data.data.messages).length===1,502,'Postal did not confirm message acceptance.');
    const info=data.data.messages[recipient],id=String(info?.id??''),messageId=data.data.message_id;
    ensure((typeof info?.id!=='number'||Number.isSafeInteger(info.id))&&/^[1-9]\d{0,18}$/.test(id)&&typeof messageId==='string'&&/^[!-~]{1,255}$/.test(messageId)&&!/[<>]/.test(messageId),502,'Postal returned invalid delivery identifiers.');
    return {provider_id:id,message_id:messageId};
  } catch {throw new AppError(502,'Postal could not confirm delivery acceptance. Check the delivery queue before retrying.');}
}
