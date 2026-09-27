// Synthetic ownership and provider data in the disposable CI database only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db, closeDatabase } from '../../lib/db.mjs';
import { randomToken, digest } from '../../lib/security.mjs';
import { storePricing, priceSummary, getCardPrices } from '../../lib/prices.mjs';
import { observeValue, recordDueValueHistory } from '../../lib/value-history.mjs';
const base = process.env.TEST_BASE_URL;
if (process.env.ALLOW_TEST_DATABASE !== 'yes' || !base || !new URL(process.env.DATABASE_URL || 'http://invalid').pathname.endsWith('_test')) throw new Error('Use only a disposable _test database.');
const sql = db(), owner = randomUUID(), stranger = randomUUID(), binder = randomUUID(), tracker = randomUUID();
const tokens = [randomToken(), randomToken()], share = randomToken(), provider = 'history-' + randomUUID().replaceAll('-', '');
const set = 'en:' + provider, card = set + '-001', date = new Date().toISOString(), day = date.slice(0, 10);
const savedRates = await sql`SELECT * FROM price_fx_rates`, savedSchedule = await sql`SELECT * FROM app_state WHERE key='value_history_schedule'`;
const originalEnabled = process.env.PRICE_TRACKING_ENABLED;
async function request(path, user = 0) { const r = await fetch(base + path, { headers: user === null ? {} : { Cookie: 'cardshelf_session=' + tokens[user] } }); return { status: r.status, data: await r.json() }; }
await test('observed value history persists privately without inventing holdings', async t => {
  let printing, baseline;
  try {
    for (const [i, id] of [owner, stranger].entries()) {
      await sql`INSERT INTO app_users(id,email,name,password_hash) VALUES(${id},${id + '@example.test'},'History fixture','unused synthetic hash')`;
      await sql`INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(${digest(tokens[i])},${id},now()+interval '1 hour')`;
    }
    await sql`INSERT INTO card_sets(id,provider_id,language,name) VALUES(${set},${provider},'en','History fixture')`;
    await sql`INSERT INTO cards(id,provider_id,set_id,language,local_id,name) VALUES(${card},${provider + '-001'},${set},'en','001','History card')`;
    [printing] = await sql`INSERT INTO printings(card_id,key,label,source) VALUES(${card},'normal','Normal','tcgdex') RETURNING id`;
    await sql`INSERT INTO collection_entries(user_id,printing_id,condition,quantity) VALUES(${owner},${printing.id},'NM',2),(${owner},${printing.id},'LP',1)`;
    await sql`INSERT INTO binders(id,user_id,title,columns,rows,page_count,binder_type,share_token)
      VALUES(${binder},${owner},'Planned value',3,3,1,'collection',${share}),(${tracker},${owner},'Checklist',3,3,1,'tracking',NULL)`;
    await sql`INSERT INTO binder_slots(binder_id,position,printing_id) VALUES(${binder},0,${printing.id}),(${binder},1,${printing.id}),(${binder},2,${printing.id}),(${binder},3,${printing.id}),(${tracker},0,${printing.id})`;
    await sql`INSERT INTO price_fx_rates(currency,aud_rate,rate_date) VALUES('USD',1.5,${day}) ON CONFLICT(currency) DO UPDATE SET aud_rate=1.5,rate_date=excluded.rate_date`;
    await storePricing(card, { tcgplayer: { unit: 'USD', updated: date, normal: { marketPrice: 10 } } });
    await t.test('first visit records only today, sums owned conditions and keeps private holdings off the response', async () => {
      const response = await request('/api/prices/summary'); assert.equal(response.status, 200);
      assert.equal(response.data.valuation.aud_total, 45); assert.equal(response.data.history.points.length, 1);
      assert.equal(response.data.history.points[0].snapshot_date, day); assert.equal(response.data.history.changes[30], null);
      assert.equal('holdings' in response.data.history.points[0], false); assert.equal('user_id' in response.data.history.points[0], false);
    });
    await t.test('concurrent summary refreshes update one observation per scope and UTC day', async () => {
      await Promise.all(Array.from({ length: 6 }, () => observeValue(owner)));
      assert.equal((await sql`SELECT count(*)::int AS n FROM value_history_snapshots WHERE user_id=${owner} AND binder_id IS NULL`)[0].n, 1);
    });
    await t.test('binder history counts planned repeats, separately from represented ownership', async () => {
      const data = await priceSummary(owner, binder); assert.equal(data.valuation.aud_total, 60); assert.equal(data.valuation.quantity, 4);
      assert.equal(data.owned_reference.aud_total, 45); assert.equal(data.history.points[0].owned_reference.quantity, 3);
      assert.equal((await priceSummary(owner)).valuation.aud_total, 45);
    });
    await t.test('authentication, ownership and Tracking boundaries remain enforced', async () => {
      assert.equal((await request('/api/prices/summary', null)).status, 401);
      assert.equal((await request('/api/prices/summary?binder_id=' + binder, 1)).status, 404);
      assert.equal((await request('/api/prices/summary?binder_id=' + tracker)).status, 400);
      assert.equal((await request('/api/prices/summary?binder_id=invalid')).status, 400);
      const other = await request('/api/prices/summary', 1); assert.equal(other.data.valuation.quantity, 0); assert.equal(other.data.valuation.aud_total, null);
      const publicShare = await request('/api/shared/' + share, null); assert.equal(publicShare.status, 200);
      for (const key of ['history', 'holdings', 'valuation', 'owned_reference']) assert.equal(key in publicShare.data, false);
    });
    await t.test('closed days preserve original quantities and FX; same-day changes replace only today', async () => {
      // Move a synthetic observation to yesterday to exercise the real boundary.
      await sql`UPDATE value_history_snapshots SET snapshot_date=${day}::date-1 WHERE user_id=${owner} AND binder_id IS NULL`;
      [baseline] = await sql`SELECT * FROM value_history_snapshots WHERE user_id=${owner} AND binder_id IS NULL`;
      await sql`UPDATE collection_entries SET quantity=3 WHERE user_id=${owner} AND printing_id=${printing.id} AND condition='NM'`;
      await sql`UPDATE price_fx_rates SET aud_rate=1.6 WHERE currency='USD'`;
      await storePricing(card, { tcgplayer: { unit: 'USD', updated: date, normal: { marketPrice: 12 } } });
      const data = await priceSummary(owner); assert.equal(data.valuation.aud_total, 76.8); assert.equal(data.history.points.length, 2);
      assert.equal(data.history.changes[7].price_fx_aud, 12.6); assert.equal(data.history.changes[7].quantity_aud, 19.2); assert.equal(data.history.changes[7].total_aud, 31.8);
      const [unchanged] = await sql`SELECT * FROM value_history_snapshots WHERE id=${baseline.id}`;
      assert.deepEqual(unchanged, baseline);
    });
    await t.test('missing FX excludes values and does not fabricate a market loss', async () => {
      await sql`UPDATE price_fx_rates SET rate_date=${day}::date-20 WHERE currency='USD'`;
      const data = await priceSummary(owner); assert.equal(data.valuation.aud_total, null); assert.equal(data.valuation.fx_missing_quantity, 4);
      assert.equal(data.history.changes[30].total_aud, null);
      await sql`UPDATE price_fx_rates SET rate_date=${day} WHERE currency='USD'`;
    });
    await t.test('disabled pricing pauses snapshots and worker but retains previously recorded history', async () => {
      process.env.PRICE_TRACKING_ENABLED = 'false';
      const before = await sql`SELECT * FROM value_history_snapshots WHERE user_id=${owner}`;
      const data = await observeValue(owner); assert.equal(data.history.enabled, false); assert.equal(data.history.points.length, 2);
      assert.equal(await recordDueValueHistory(), 0);
      assert.deepEqual(await sql`SELECT * FROM value_history_snapshots WHERE user_id=${owner}`, before);
      process.env.PRICE_TRACKING_ENABLED = 'true';
    });
    await t.test('worker records unvisited scopes, skips Tracking binders and bounds repeated work', async () => {
      await sql`DELETE FROM value_history_snapshots WHERE user_id IN (${owner},${stranger}) AND snapshot_date=${day}`;
      await sql`DELETE FROM app_state WHERE key='value_history_schedule'`;
      const count = await recordDueValueHistory(); assert.ok(count > 0 && count <= 25);
      const rows = await sql`SELECT binder_id FROM value_history_snapshots WHERE user_id=${owner} AND snapshot_date=${day}`;
      assert.ok(rows.some(row => row.binder_id === null)); assert.ok(rows.some(row => row.binder_id === binder)); assert.ok(!rows.some(row => row.binder_id === tracker));
      assert.equal(await recordDueValueHistory(), 0);
    });
    await t.test('card history keeps distinct series and most recent daily observation within 90 days', async () => {
      const recent = new Date(Date.now() - 86400000).toISOString();
      for (const [variant, metric, currency, stamp, amount] of [
        ['normal','marketPrice','USD',recent,7], ['holo','marketPrice','USD',recent,20], ['normal','avg7','EUR',recent,9],
        ['normal','marketPrice','USD',new Date(Date.now() - 100 * 86400000).toISOString(),2],
        ['normal','marketPrice','USD',new Date(Date.now() + 86400000).toISOString(),999]
      ]) await sql`INSERT INTO card_price_history(card_id,source,variant,currency,metric,amount,source_updated_at)
        VALUES(${card},'TCGplayer',${variant},${currency},${metric},${amount},${stamp})`;
      const { history } = await getCardPrices(owner, card); assert.equal(history.length, 4); assert.ok(history.every(row => row.amount !== 2 && row.amount !== 999));
      const publicData = await request('/api/public/catalogue/cards/' + encodeURIComponent(card) + '/prices', null);
      assert.equal(publicData.status, 200); assert.ok(Array.isArray(publicData.data.history)); assert.equal('holdings' in publicData.data, false);
    });
    await t.test('retention removes old observations without backfilling gaps', async () => {
      await sql`UPDATE value_history_snapshots SET snapshot_date=${day}::date-367 WHERE id=${baseline.id}`;
      await sql`DELETE FROM app_state WHERE key='value_history_schedule'`;
      await recordDueValueHistory(); assert.equal((await sql`SELECT id FROM value_history_snapshots WHERE id=${baseline.id}`).length, 0);
      assert.equal((await priceSummary(owner)).history.points.length, 1);
    });
    await t.test('deleting a binder and account cascades their private history', async () => {
      await sql`DELETE FROM binders WHERE id=${binder}`;
      assert.equal((await sql`SELECT id FROM value_history_snapshots WHERE binder_id=${binder}`).length, 0);
      await sql`DELETE FROM app_users WHERE id=${owner}`;
      assert.equal((await sql`SELECT id FROM value_history_snapshots WHERE user_id=${owner}`).length, 0);
    });
  } finally {
    if (originalEnabled === undefined) delete process.env.PRICE_TRACKING_ENABLED; else process.env.PRICE_TRACKING_ENABLED = originalEnabled;
    await sql`DELETE FROM app_users WHERE id IN (${owner},${stranger})`;
    await sql`DELETE FROM printings WHERE card_id=${card}`; await sql`DELETE FROM cards WHERE id=${card}`; await sql`DELETE FROM card_sets WHERE id=${set}`;
    await sql`DELETE FROM price_fx_rates`; for (const row of savedRates) await sql`INSERT INTO price_fx_rates ${sql(row)}`;
    await sql`DELETE FROM app_state WHERE key='value_history_schedule'`; for (const row of savedSchedule) await sql`INSERT INTO app_state ${sql({ ...row, value: sql.json(row.value) })}`;
    await closeDatabase();
  }
});
