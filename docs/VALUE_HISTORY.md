# Value history

Open **Collection overview** for the estimated value of owned quantities, or a
**Collection binder** for its planned layout value. Each graph has 7, 30 and 90 day
views, exact values through a keyboard-accessible observation slider, and a data table.
Card details in both the signed-in and free catalogues show provider price histories.

## Recording and accuracy

- Migration `027_value_history.sql` adds private daily snapshots. Existing quantities,
  binders, prices and memberships are unchanged. No pre-upgrade holdings are inferred.
- The existing catalogue worker records collections and Collection binders without
  requiring visits. It takes up to 25 due scopes per minute and refreshes a scope at
  most once every six hours. Opening or refreshing a price summary also observes it.
- There is one observation per scope per UTC day. Today's observation can change;
  earlier days are preserved. Missed days are not filled in. Retention is 366 days;
  graphs return at most the latest 90 days, with one point per recorded day.
- `PRICE_TRACKING_ENABLED=false` pauses new snapshots as well as price refreshes.
  Existing history remains viewable. A stopped worker cannot record unattended days;
  a later request records only that current day.
- Each snapshot keeps owned/planned quantities, the selected unrounded per-copy AUD
  value, its source/variant/currency/metric, source timestamp, and actual FX rate/date.
  Totals are never recalculated with current holdings or today's FX.
- Current pricing rules still apply: missing prices or expired/missing AUD rates are
  excluded, as are stale or failed exact quotes. Labelled approximate references may
  be included even when stale or failed. Coverage counts stay with each observation.
  Entirely unpriced and empty snapshots have no numeric total, rather than a made-up
  zero. Missing dates and unpriced totals break the line.

## Reading changes

Changes compare the first and last **recorded** days within the selected period;
the displayed dates make a partial history explicit. A single day is not a trend.

| Part | Calculation |
| --- | --- |
| Prices & currency rates | Retained copies × change in per-copy AUD value, only when both prices exist and use the same source, variant, currency, metric and approximation status. |
| Cards / pockets added or removed | Added copies valued at the ending basis; removed copies valued at the starting basis. Added and removed quantities are also shown, including unpriced copies. |
| Coverage & source changes | Retained copies affected by missing/new prices or a switch of provider, currency, metric or approximation status. Also includes any sub-cent rounding residual. |

These are changes in an estimate, not profit or investment returns. When either
endpoint is entirely unpriced, no numeric overall change or percentage is claimed.
Daily snapshots cannot establish intraday purchase/sale times or prices. Period copy
changes compare the endpoints; cards added and removed between them may net out.

## Binders, cards and privacy

Collection binder history counts planned pockets, including repeated printings. The
existing represented-ownership reference remains separate and is retained with each
snapshot. It does not allocate physical copies and binder totals are never added to
owned collection totals. Tracking binders remain checklists without valuations.

Card graphs use the last provider observation per UTC day for each separate source,
variant, currency and metric. The series selector prevents mixing EUR and USD, holo
and normal, or market prices and averages. They use original source currencies; no
historical AUD conversion or daily sale history is manufactured. Previously recorded
card observations within 90 days can appear immediately after upgrading.

Private history is returned with `/api/prices/summary`, under its existing sign-in,
`prices` membership entitlement and binder-owner checks. Responses expose aggregate
history and changes, not saved per-printing holdings. Shared binder URLs never expose
private value history. Public card history contains only provider observations.
Account and binder deletion cascade to the associated snapshots. Database backups
include the new table automatically.

## Validation

`npm test` covers valuation bases, change decomposition, null coverage, rounding,
series separation and chart gaps. `npm run test:integration` exercises daily upserts,
concurrency, private/public access, snapshot retention and deletion in the disposable
PostgreSQL database. `npm run test:value-history-ui` covers desktop/phone light/dark
graphs, source selection, keyboard inspection, first-day, unpriced, paused and error
states. CI also builds and smoke-tests both native container architectures.
