import { AppError, ensure } from './errors.mjs';
import { SQUARE_VERSION } from './subscription-logic.mjs';
import { squareHost } from './square-connector-logic.mjs';
// Dedicated, bounded transport. Never accept an arbitrary URL or log provider bodies.
export async function connectorRequest(environment,path,{token='',clientSecret='',body,method=body?'POST':'GET'}={}) {
  ensure(/^\/(?:oauth2\/(?:token|token\/status|revoke)|v2\/(?:locations|merchants\/[A-Za-z0-9_-]+|catalog\/list))(?:\?|$)/.test(path),500,'Unsupported connector endpoint.');
  try {
    const response=await fetch(squareHost(environment)+path,{method,redirect:'error',signal:AbortSignal.timeout(10000),
      headers:{'Square-Version':SQUARE_VERSION,'Content-Type':'application/json',...(clientSecret?{Authorization:'Client '+clientSecret}:token?{Authorization:'Bearer '+token}:{})},
      ...(body!==undefined?{body:JSON.stringify(body)}:{})});
    let size=0;const chunks=[];
    for await(const chunk of response.body){size+=chunk.length;ensure(size<=1_000_000,502,'Square response exceeded the connector limit.');chunks.push(chunk);}
    let data;try{data=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new AppError(502,'Square returned an unreadable response.');}
    ensure(response.ok&&!data.errors?.length,502,'Square could not verify this connection. Check the application credentials and permissions, then reconnect.');
    return data;
  }catch(error){if(error instanceof AppError)throw error;throw new AppError(502,'Square connection request failed. Try again; no subscription was created.');}
}
