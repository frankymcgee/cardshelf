import { db } from './db.mjs';
import { fetchProvider,sleep } from './provider.mjs';
import { configuration } from './config.mjs';
import { ensure } from './errors.mjs';
import { cardsDue,storePricing,priceFailure,pricingConfiguration } from './prices.mjs';
export async function refreshFx() {
  const sql=db();
  const [recent]=await sql`SELECT key FROM app_state WHERE key='price_fx_attempt' AND updated_at>now()-interval '1 hour'`;
  if(recent) return;
  await sql`INSERT INTO app_state(key,value) VALUES('price_fx_attempt','{}'::jsonb) ON CONFLICT(key) DO UPDATE SET updated_at=now()`;
  for(const currency of ['USD','EUR']) {
    const [current]=await sql`SELECT currency FROM price_fx_rates WHERE currency=${currency} AND fetched_at>now()-interval '12 hours'`;
    if(current) continue;
    try {
      // Fixed currency pairs and host; no client-controlled outbound URL.
      const response=await fetch(`https://api.frankfurter.dev/v2/rate/${currency}/AUD?providers=ECB`,{
        signal:AbortSignal.timeout(15000),headers:{Accept:'application/json'}});
      ensure(response.ok,502,`Exchange-rate provider returned HTTP ${response.status}.`);
      const reader=response.body.getReader();let size=0;const chunks=[];
      try { while(true) {const {done,value}=await reader.read();if(done) break;size+=value.length;ensure(size<=20000,502,'Exchange-rate response too large.');chunks.push(value);} }
      finally {await reader.cancel();}
      const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      ensure(data.base===currency&&data.quote==='AUD'&&typeof data.rate==='number'&&Number.isFinite(data.rate)&&data.rate>0&&data.rate<100&&/^\d{4}-\d{2}-\d{2}$/.test(data.date),502,'Unexpected exchange-rate response.');
      await sql`INSERT INTO price_fx_rates(currency,aud_rate,rate_date) VALUES(${currency},${data.rate},${data.date})
        ON CONFLICT(currency) DO UPDATE SET aud_rate=excluded.aud_rate,rate_date=excluded.rate_date,fetched_at=now()`;
    } catch(error) {console.error('Price FX:',currency,error.message);}
  }
}
export async function runPriceJob(job,report,stopping) {
  const sql=db();
  ensure(pricingConfiguration().enabled,409,'Price tracking is disabled.');
  await refreshFx();
  const cards=await cardsDue(job.payload.card_id??null),errors=[];let done=0;
  await report(job,0,cards.length,cards.length?'Refreshing market prices':'Prices are already checked; no cards due');
  for(const card of cards) {
    if(stopping()) {
      await sql`UPDATE jobs SET status='queued',lease_token=NULL,message='Price refresh paused for restart' WHERE id=${job.id} AND lease_token=${job.lease_token}`;
      return;
    }
    try {
      const raw=await fetchProvider(card.language,'cards/'+card.provider_id);
      ensure(raw?.id===card.provider_id,502,'Price response card identity does not match.');
      await storePricing(card.id,raw.pricing);
    } catch(error) {await priceFailure(card.id,error);errors.push({card_id:card.id,message:String(error.message).slice(0,300)});}
    done++;await report(job,done,cards.length,`Checked prices for ${done} of ${cards.length} cards`,errors);
    await sleep(configuration().requestInterval);
  }
  await sql`UPDATE jobs SET status=${errors.length?'failed':'completed'},message=${errors.length?`${errors.length} price checks failed; previous prices retained with error status.`:'Price refresh complete'},
    errors=${sql.json(errors)},lease_token=NULL,finished_at=now() WHERE id=${job.id} AND lease_token=${job.lease_token}`;
}
