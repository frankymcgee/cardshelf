import { db, collectionLock } from './db.mjs';
import { ensure } from './errors.mjs';
import * as v from './validate.mjs';
import { valueRows } from './price-logic.mjs';
import { snapshotValuation, valueHistoryChange } from './value-history-logic.mjs';

// Both the worker and the signed-in summary use this path. Reads update only
// today's observation; closed days are immutable and missed days stay missing.
export async function observeValue(userId, binderId = null, includeHistory = true) {
  if (binderId) binderId = v.uuid(binderId);
  const enabled = process.env.PRICE_TRACKING_ENABLED !== 'false';
  return db().begin(async sql => {
    await collectionLock(sql, userId);
    if (binderId) {
      const [binder] = await sql`SELECT binder_type FROM binders WHERE id=${binderId} AND user_id=${userId} FOR SHARE`;
      ensure(binder, 404, 'Binder not found.');
      ensure(binder.binder_type === 'collection', 400, 'Tracking binders do not have pricing valuations.');
    }
    const [{ observed_at, day }] = await sql`SELECT observed_at,(observed_at AT TIME ZONE 'UTC')::date::text AS day FROM (SELECT clock_timestamp() AS observed_at) clock`;
    const rates = await sql`SELECT currency,aud_rate,rate_date,fetched_at FROM price_fx_rates ORDER BY currency`;
    const rows = binderId
      ? await sql`SELECT p.id AS printing_id,p.key,p.source,pc.quotes,pc.reference_prices,pc.fetched_at,pc.last_error,
          count(*)::integer AS quantity,
          coalesce((SELECT sum(e.quantity)::integer FROM collection_entries e WHERE e.user_id=${userId} AND e.printing_id=p.id),0) AS owned_quantity
          FROM binder_slots s JOIN printings p ON p.id=s.printing_id LEFT JOIN card_price_cache pc ON pc.card_id=p.card_id
          WHERE s.binder_id=${binderId} GROUP BY p.id,pc.card_id ORDER BY p.id`
      : await sql`SELECT p.id AS printing_id,p.key,p.source,pc.quotes,pc.reference_prices,pc.fetched_at,pc.last_error,sum(e.quantity)::integer AS quantity
          FROM collection_entries e JOIN printings p ON p.id=e.printing_id LEFT JOIN card_price_cache pc ON pc.card_id=p.card_id
          WHERE e.user_id=${userId} AND e.quantity>0 GROUP BY p.id,pc.card_id ORDER BY p.id`;
    const now = observed_at.getTime(), snapshot = snapshotValuation(rows, rates, now);
    const ownedReference = binderId ? valueRows(rows.map(row => ({ ...row, quantity: Math.min(row.quantity, row.owned_quantity) })), rates, now) : null;
    if (enabled) {
      const record = { user_id: userId, binder_id: binderId, snapshot_date: day, recorded_at: observed_at,
        valuation: sql.json(snapshot.valuation), owned_reference: ownedReference ? sql.json(ownedReference) : null,
        holdings: sql.json(snapshot.holdings), rates: sql.json(rates) };
      // Partial unique indexes isolate the collection from each planned binder.
      const conflict = binderId
        ? sql`(binder_id,snapshot_date) WHERE binder_id IS NOT NULL`
        : sql`(user_id,snapshot_date) WHERE binder_id IS NULL`;
      await sql`INSERT INTO value_history_snapshots ${sql(record)} ON CONFLICT ${conflict}
        DO UPDATE SET recorded_at=excluded.recorded_at,valuation=excluded.valuation,
          owned_reference=excluded.owned_reference,holdings=excluded.holdings,rates=excluded.rates`;
    }
    const result = { rates, valuation: snapshot.valuation, owned_reference: ownedReference, generated_at: observed_at.toISOString() };
    if (!includeHistory) return result;
    const history = await sql`SELECT snapshot_date::text,recorded_at,valuation,owned_reference
      FROM value_history_snapshots WHERE user_id=${userId} AND binder_id IS NOT DISTINCT FROM ${binderId}::uuid
        AND snapshot_date>=${day}::date-89 AND snapshot_date<=${day}::date ORDER BY snapshot_date`;
    const windows = {};
    for (const days of [7, 30, 90]) {
      const cutoff = new Date(Date.parse(day) - (days - 1) * 86400000).toISOString().slice(0, 10);
      windows[days] = history.filter(row => row.snapshot_date >= cutoff);
    }
    // Only the period boundaries need per-printing holdings. Do not load 90
    // complete copies of a large collection merely to draw its daily totals.
    const dates = [...new Set(Object.values(windows).flatMap(points => points.length > 1 ? [points[0].snapshot_date, points.at(-1).snapshot_date] : []))];
    const boundaries = dates.length ? await sql`SELECT snapshot_date::text,holdings FROM value_history_snapshots
      WHERE user_id=${userId} AND binder_id IS NOT DISTINCT FROM ${binderId}::uuid AND snapshot_date IN ${sql(dates)}` : [];
    const holdings = new Map(boundaries.map(point => [point.snapshot_date, point.holdings]));
    const changes = {};
    for (const days of [7, 30, 90]) {
      const points = windows[days], first = points[0], last = points.at(-1);
      changes[days] = points.length > 1 ? valueHistoryChange(
        { ...first, holdings: holdings.get(first.snapshot_date) }, { ...last, holdings: holdings.get(last.snapshot_date) }
      ) : null;
    }
    return { ...result, history: {
      enabled, currency: 'AUD', today: day, retention_days: 366,
      points: history, changes
    } };
  });
}

// One bounded batch per minute, at most one refresh per scope every six hours.
// A database lock coordinates multiple workers; unfinished scopes remain due.
export async function recordDueValueHistory() {
  if (process.env.PRICE_TRACKING_ENABLED === 'false') return 0;
  const scopes = await db().begin(async sql => {
    const [lock] = await sql`SELECT pg_try_advisory_xact_lock(72490321) AS acquired`;
    if (!lock.acquired) return [];
    const [recent] = await sql`SELECT 1 FROM app_state WHERE key='value_history_schedule' AND updated_at>now()-interval '1 minute'`;
    if (recent) return [];
    await sql`INSERT INTO app_state(key,value) VALUES('value_history_schedule','{}') ON CONFLICT(key) DO UPDATE SET updated_at=now()`;
    await sql`DELETE FROM value_history_snapshots WHERE snapshot_date<(now() AT TIME ZONE 'UTC')::date-365`;
    return sql`SELECT scopes.user_id,scopes.binder_id FROM (
        SELECT id AS user_id,NULL::uuid AS binder_id FROM app_users
        UNION ALL SELECT user_id,id AS binder_id FROM binders WHERE binder_type='collection'
      ) scopes LEFT JOIN value_history_snapshots h ON h.user_id=scopes.user_id
        AND h.binder_id IS NOT DISTINCT FROM scopes.binder_id AND h.snapshot_date=(now() AT TIME ZONE 'UTC')::date
      WHERE h.recorded_at IS NULL OR h.recorded_at<now()-interval '6 hours'
      ORDER BY h.recorded_at NULLS FIRST,scopes.user_id,scopes.binder_id NULLS FIRST LIMIT 25`;
  });
  for (const scope of scopes) {
    try { await observeValue(scope.user_id, scope.binder_id, false); }
    catch (error) {
      // Accounts or binders can be deleted while the batch is being processed.
      if (![404, 400].includes(error.status) && error.code !== '23503') throw error;
    }
  }
  return scopes.length;
}
