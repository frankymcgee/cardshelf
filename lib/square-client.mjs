import { AppError,ensure } from './errors.mjs';
import { SQUARE_VERSION,squareConfiguration,squareId } from './subscription-logic.mjs';
export const resourcePath=(kind,id)=>`/v2/${kind}/${encodeURIComponent(squareId(id))}`;
export async function squareRequest(path,body=null,method=body?'POST':'GET',cfg=squareConfiguration()) {
  ensure(cfg.configured,503,'Square is not configured on this server.');
  ensure(/^\/v2\/(?:customers|catalog\/object|locations|subscriptions|invoices|orders|payments|refunds|disputes)(?:[/?]|$)/.test(path),500,'Unsupported Square endpoint.');
  const host=cfg.environment==='production'?'https://connect.squareup.com':'https://connect.squareupsandbox.com';
  try {
    const response=await fetch(host+path,{method,redirect:'error',signal:AbortSignal.timeout(12000),
      headers:{Authorization:`Bearer ${cfg.token}`,'Square-Version':SQUARE_VERSION,'Content-Type':'application/json'},
      ...(body?{body:JSON.stringify(body)}:{})});
    const chunks=[];let length=0;
    for await(const chunk of response.body){length+=chunk.length;ensure(length<=1000000,502,'Square response too large.');chunks.push(chunk);}
    let data;try{data=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new AppError(502,'Square returned an unreadable response.');}
    // Never log tokens, contact details or complete payment/provider response bodies.
    ensure(response.ok&&!data.errors?.length,502,`Square request failed (${response.status}). Check the Square dashboard and retry the same request.`);
    return data;
  }catch(error){if(error instanceof AppError)throw error;throw new AppError(502,'Square could not confirm this request. Retry the same request; do not start another subscription.');}
}
