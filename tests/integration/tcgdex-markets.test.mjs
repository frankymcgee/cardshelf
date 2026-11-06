import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db,closeDatabase } from '../../lib/db.mjs';
import { storePricing,priceSummary } from '../../lib/prices.mjs';
import { saveWishlistAlert,evaluateWishlistAlert } from '../../lib/wishlist-alerts.mjs';
import { randomToken,digest } from '../../lib/security.mjs';
const base=process.env.TEST_BASE_URL;
if(process.env.ALLOW_TEST_DATABASE!=='yes'||!base||!new URL(process.env.DATABASE_URL||'http://invalid').pathname.endsWith('_test'))throw Error('Use only a disposable _test database.');
const sql=db(),owner=randomUUID(),token=randomToken(),provider='markets-'+randomUUID().replaceAll('-',''),set='en:'+provider,card=set+'-001';
const at=new Date().toISOString(),day=at.slice(0,10),savedRates=await sql`SELECT * FROM price_fx_rates`;
const tcg=(amount,updated=at)=>({unit:'USD',updated,normal:{productId:123,marketPrice:amount,lowPrice:1,midPrice:4,highPrice:90,directLowPrice:2}});
const cm={unit:'EUR',updated:at,trend:4,avg7:5,avg30:6};
const prices=async()=>{const r=await fetch(base+'/api/cards/'+encodeURIComponent(card)+'/prices',{headers:{Cookie:'cardshelf_session='+token}});assert.equal(r.status,200);return r.json();};
await test('TCGdex detailed markets persist safely through partial and older provider responses',async t=>{
  try {
    await sql`INSERT INTO app_users(id,email,name,password_hash,role) VALUES(${owner},${owner+'@example.test'},'Market fixture','synthetic unused hash','admin')`;
    await sql`INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(${digest(token)},${owner},now()+interval '1 hour')`;
    await sql`INSERT INTO card_sets(id,provider_id,language,name) VALUES(${set},${provider},'en','Market fixture')`;
    await sql`INSERT INTO cards(id,provider_id,set_id,language,local_id,name) VALUES(${card},${provider+'-001'},${set},'en','001','Market fixture card')`;
    const [p]=await sql`INSERT INTO printings(card_id,key,label,source) VALUES(${card},'normal','Normal','tcgdex') RETURNING id`;
    await sql`INSERT INTO collection_entries(user_id,printing_id,condition,quantity,wishlist) VALUES(${owner},${p.id},'NM',2,true)`;
    for(const [currency,rate] of [['USD',1.5],['EUR',1.7]])await sql`INSERT INTO price_fx_rates(currency,aud_rate,rate_date) VALUES(${currency},${rate},${day}) ON CONFLICT(currency) DO UPDATE SET aud_rate=excluded.aud_rate,rate_date=excluded.rate_date`;
    let received,history;
    await t.test('detailed finish wins; only market price contributes matched value',async()=>{
      await storePricing(card,{tcgplayer:tcg(100),cardmarket:cm},[{type:'normal',size:'standard',variantId:'normal-123',thirdParty:{tcgplayer:123},pricing:{tcgplayer:tcg(10)}}]);
      const data=await prices();assert.equal(data.printings[0].price.amount,10);assert.equal(data.printings[0].price.mapping_basis,'detailed_variant');assert.equal(data.printings[0].price.product_id,123);assert.equal(data.market_metrics.length,4);
      assert.equal((await priceSummary(owner)).valuation.aud_total,30);assert.equal(data.providers.TCGplayer.state,'available');received=data.printings[0].price.received_at;
      history=(await sql`SELECT count(*)::integer AS n FROM card_price_history WHERE card_id=${card}`)[0].n;
    });
    await t.test('missing TCGplayer keeps its old observation and uses a labelled fresh Cardmarket guide',async()=>{
      await storePricing(card,{tcgplayer:null,cardmarket:cm});
      const data=await prices(),q=data.printings[0].price;assert.equal(q.amount,10);assert.equal(q.retained,true);assert.equal(q.fetch_error,true);assert.equal(q.received_at,received);assert.equal(data.references[0].retained,undefined);
      const summary=await priceSummary(owner);assert.equal(summary.valuation.aud_total,13.6);assert.equal(summary.valuation.matched_quantity,0);assert.equal(summary.valuation.approximate_quantity,2);
      assert.equal((await sql`SELECT count(*)::integer AS n FROM card_price_history WHERE card_id=${card}`)[0].n,history);
    });
    await t.test('older source data cannot overwrite a newer price or activate a wishlist target',async()=>{
      const older=new Date(Date.parse(at)-86400000).toISOString();await storePricing(card,{tcgplayer:tcg(1,older),cardmarket:cm});
      assert.equal((await prices()).printings[0].price.amount,10);
      const alert=await saveWishlistAlert(owner,{printing_id:p.id,revision:0,target_aud_minor:2000,watch_market:true,watch_listings:false,conditions:['NM'],enabled:true});
      await evaluateWishlistAlert(alert.id);assert.equal((await sql`SELECT id FROM wishlist_alert_events WHERE user_id=${owner}`).length,0);
      await storePricing(card,{tcgplayer:tcg(10),cardmarket:cm});await sql`UPDATE wishlist_alerts SET checked_at=NULL WHERE id=${alert.id}`;await evaluateWishlistAlert(alert.id);
      assert.equal((await sql`SELECT id FROM wishlist_alert_events WHERE user_id=${owner}`).length,1);assert.equal((await prices()).printings[0].price.retained,undefined);
    });
    await t.test('complete omissions retain history and expose both provider states without changing holdings',async()=>{
      await storePricing(card,null);const data=await prices();assert.equal(data.providers.TCGplayer.state,'missing');assert.equal(data.providers.Cardmarket.state,'missing');assert.equal(data.references[0].retained,true);
      assert.equal((await sql`SELECT quantity FROM collection_entries WHERE user_id=${owner} AND printing_id=${p.id}`)[0].quantity,2);
      assert.equal((await fetch(base+'/api/cards/'+encodeURIComponent(card)+'/prices')).status,401);
    });
  } finally {
    await sql`DELETE FROM app_users WHERE id=${owner}`;await sql`DELETE FROM printings WHERE card_id=${card}`;await sql`DELETE FROM cards WHERE id=${card}`;await sql`DELETE FROM card_sets WHERE id=${set}`;
    await sql`DELETE FROM price_fx_rates`;for(const row of savedRates)await sql`INSERT INTO price_fx_rates ${sql(row)}`;await closeDatabase();
  }
});
