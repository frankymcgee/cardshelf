// Synthetic data only, against the existing disposable CI database/server.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { closeDatabase } from '../../lib/db.mjs';
import { hashPassword, randomToken, digest } from '../../lib/security.mjs';
import { storePricing, priceFailure, priceSummary } from '../../lib/prices.mjs';
import { cardmarketHighlights, priceAvailabilityMessage } from '../../shared/price-display.mjs';

const url=process.env.TEST_BASE_URL, databaseUrl=process.env.DATABASE_URL;
if(process.env.ALLOW_TEST_DATABASE!=='yes'||!url||!new URL(databaseUrl||'http://invalid').pathname.endsWith('_test')) {
  throw new Error('Use the disposable _test database only.');
}
const sql=postgres(databaseUrl,{max:3});
await test('free-feed price references, alias matching and preserved valuation boundaries',async t=>{
  const userId=randomUUID(),token=randomToken(),provider='ci-prices-'+randomUUID().replaceAll('-','');
  const setId='en:'+provider,cardId=setId+'-008',date=new Date().toISOString();
  const cookie='cardshelf_session='+token;
  async function prices(authenticated=true) {
    const response=await fetch(url+'/api/cards/'+encodeURIComponent(cardId)+'/prices',{
      redirect:'manual',headers:authenticated?{Cookie:cookie}:{}
    });
    assert.match(response.headers.get('content-type')||'',/application\/json/);
    return {status:response.status,data:await response.json()};
  }
  try {
    await sql`INSERT INTO app_users(id,email,name,password_hash) VALUES(${userId},${provider+'@example.test'},'Price reference tester',${await hashPassword('Synthetic pricing test password 123')})`;
    await sql`INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(${digest(token)},${userId},now()+interval '1 hour')`;
    await sql`INSERT INTO card_sets(id,provider_id,language,name) VALUES(${setId},${provider},'en','Synthetic price reference set')`;
    await sql`INSERT INTO cards(id,provider_id,set_id,language,local_id,name) VALUES(${cardId},${provider+'-008'},${setId},'en','008','Synthetic Cardmarket-only Holo')`;
    const [holo]=await sql`INSERT INTO printings(card_id,key,label,source) VALUES(${cardId},'holo','Holo','tcgdex') RETURNING id`;
    await sql`INSERT INTO printings(card_id,key,label,source) VALUES(${cardId},'reverse','Reverse holo','tcgdex'),(${cardId},'firstEdition','First edition','tcgdex'),(${cardId},'manual-special','Manual special','manual')`;
    await sql`INSERT INTO collection_entries(user_id,printing_id,condition,quantity) VALUES(${userId},${holo.id},'NM',2)`;

    await t.test('existing price endpoint remains authenticated JSON',async()=>{
      assert.equal((await prices(false)).status,401);
      const response=await prices();assert.equal(response.status,200);
      assert.equal(response.data.fetched_at,null);
      assert.match(priceAvailabilityMessage(response.data),/not been checked yet/);
    });
    await t.test('legacy trend-only cache is immediately visible without a refresh or changed totals',async()=>{
      const legacy=[{source:'Cardmarket',variant:'card-reference',currency:'EUR',metric:'trend',amount:5,source_updated_at:date}];
      await sql`INSERT INTO card_price_cache(card_id,reference_prices,fetched_at,attempted_at) VALUES(${cardId},${sql.json(legacy)},now(),now())`;
      const {data}=await prices();assert.equal(cardmarketHighlights(data.references)[0].amount,5);
      assert.ok(data.printings.every(p=>p.price===null));
      assert.match(priceAvailabilityMessage(data),/Cardmarket reference prices are available/);
      const summary=await priceSummary(userId);assert.equal(summary.valuation.aud_total,null);assert.equal(summary.valuation.unpriced_quantity,2);
    });
    await t.test('average-only values survive persistence and retain their history metric',async()=>{
      await storePricing(cardId,{cardmarket:{unit:'EUR',updated:date,avg30:4,'avg7-holo':7}});
      const {data}=await prices();assert.equal(data.references.length,2);
      assert.deepEqual(cardmarketHighlights(data.references).map(q=>q.metric),['avg30','avg7-holo']);
      assert.ok(data.printings.every(p=>p.price===null));
      const history=await sql`SELECT metric FROM card_price_history WHERE card_id=${cardId} ORDER BY metric`;
      assert.deepEqual(history.map(row=>row.metric),['avg30','avg7-holo']);
      await storePricing(cardId,{cardmarket:{unit:'EUR',updated:date,avg30:4,'avg7-holo':7}});
      assert.equal((await sql`SELECT count(*)::integer AS n FROM card_price_history WHERE card_id=${cardId}`)[0].n,2);
    });
    await t.test('documented holofoil aliases match only the correct imported printing',async()=>{
      await storePricing(cardId,{tcgplayer:{unit:'USD',updated:date,holofoil:{marketPrice:10},'reverse-holofoil':{marketPrice:12}},cardmarket:{unit:'EUR',updated:date,trend:100}});
      const {data}=await prices();
      assert.equal(data.printings.find(p=>p.key==='holo').price.amount,10);
      assert.equal(data.printings.find(p=>p.key==='reverse').price.amount,12);
      assert.equal(data.printings.find(p=>p.key==='firstEdition').price,null);
      assert.equal(data.printings.find(p=>p.key==='manual-special').price,null);
      assert.equal(cardmarketHighlights(data.references)[0].amount,100);
    });
    await t.test('failed refresh retains references with warning flags, excluding matched values from totals',async()=>{
      await priceFailure(cardId,new Error('Synthetic provider outage'));
      const {data}=await prices();assert.equal(data.last_error,'Synthetic provider outage');
      assert.equal(cardmarketHighlights(data.references)[0].fetch_error,true);
      const summary=await priceSummary(userId);assert.equal(summary.valuation.aud_total,null);assert.equal(summary.valuation.stale_quantity,2);
    });
    await t.test('successful empty pricing clears old values without changing ownership',async()=>{
      await storePricing(cardId,{});
      const {data}=await prices();assert.equal(data.last_error,'');assert.deepEqual(data.references,[]);
      assert.ok(data.printings.every(p=>p.price===null));
      assert.match(priceAvailabilityMessage(data),/current feed returned no supported price/);
      assert.equal((await sql`SELECT quantity FROM collection_entries WHERE user_id=${userId} AND printing_id=${holo.id}`)[0].quantity,2);
    });
  } finally {
    try {
      await sql`DELETE FROM app_users WHERE id=${userId}`;
      await sql`DELETE FROM printings WHERE card_id=${cardId}`;
      await sql`DELETE FROM cards WHERE id=${cardId}`;
      await sql`DELETE FROM card_sets WHERE id=${setId}`;
    } finally { await closeDatabase();await sql.end(); }
  }
});
