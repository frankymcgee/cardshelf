import { ensure,AppError } from './errors.mjs';
import { STRIPE_VERSION } from './stripe-logic.mjs';
export function stripeForm(body) {
  const p=new URLSearchParams();
  function add(key,value){if(value===undefined||value===null)return;if(typeof value==='object'){for(const [k,v] of Object.entries(value))add(`${key}[${k}]`,v);}else p.append(key,String(value));}
  for(const [key,value] of Object.entries(body||{}))add(key,value);return p;
}
// Credentials only travel to this fixed HTTPS API. No arbitrary URLs or money-transfer endpoints.
export async function stripeRequest(cfg,path,body=null,method=body?'POST':'GET',idempotency=null) {
  ensure(cfg?.secret,503,'Stripe is not configured.');
  ensure(/^\/v1\/(?:account|balance|products|prices|tax_rates|tax\/settings|customers|subscriptions|checkout\/sessions|invoices|invoice_payments|payment_intents|charges|refunds|events|billing_portal\/(?:configurations|sessions))(?:[/?]|$)/.test(path)&&!path.includes('..')&&!path.includes('#')&&!path.includes('\\'),500,'Unsupported Stripe endpoint.');
  ensure(!/^\/v1\/(?:products|tax\/settings)(?:[/?]|$)/.test(path)||method==='GET',500,'Product sync endpoints are read-only.');
  ensure(['GET','POST'].includes(method),500,'Unsupported Stripe method.');
  try{
    const response=await fetch('https://api.stripe.com'+path,{method,redirect:'error',signal:AbortSignal.timeout(10000),headers:{Authorization:'Bearer '+cfg.secret,'Stripe-Version':STRIPE_VERSION,'Content-Type':'application/x-www-form-urlencoded',...(idempotency?{'Idempotency-Key':idempotency}:{})},...(body?{body:stripeForm(body).toString()}:{})});
    let size=0;const chunks=[];for await(const chunk of response.body){size+=chunk.length;ensure(size<=1500000,502,'Stripe response exceeded its size limit.');chunks.push(chunk);}
    let data;try{data=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new AppError(502,'Stripe returned an unreadable response.');}
    ensure(response.ok&&!data.error,502,`Stripe request failed (HTTP ${response.status}). Check the key permissions and Stripe request logs. Retry the original request, not a new subscription.`);return data;
  }catch(error){if(error instanceof AppError)throw error;throw new AppError(502,'Stripe could not confirm this request. Use its original retry or refresh action.');}
}
export const stripePath=(kind,id)=>'/v1/'+kind+'/'+encodeURIComponent(id);
