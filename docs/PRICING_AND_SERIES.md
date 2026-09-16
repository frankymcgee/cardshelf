# CardShelf 0.2.0: pricing and series/set binders

## Scope

Adds automatically refreshed market prices, AUD references, recorded price history,
collection and planned-binder estimates, and new binders generated from imported
sets or series. No card scanning, photos, AI services, price alerts, physical-copy
allocation or changes to existing binder layouts are included.

## Create binders

Open **Binders → From set / series**. Select a language, optionally filter by series,
then select one or more sets already imported on this server. Select displayed sets
chooses up to 50. Unimported sets are not silently fetched or added.

Choose a name and pocket grid, then one pocket per card design or per known printing.
Design mode prefers Normal, Holo, then Reverse Holo. Owned-only mode first restricts
the candidates to printings you actually own. Duplicate copies/conditions do not
create duplicate pockets. Full-catalogue mode also plans positions for missing cards.
Known printings are not a verified comprehensive master-set checklist.

Cards sort naturally by collector number within sets, with sets ordered by release
date and name. Optionally start each set on a new page. Pages are calculated for you;
large layouts split into numbered volumes of at most 60 pages each. Limits per request:
50 selected sets, 9,600 candidate printings and 10 generated volumes.

Preview shows page/volume/pocket counts and a sample of positions. Partial imports
require acknowledgement. Changed catalogue/ownership after preview produces a
conflict requesting a new preview. Creation is transactional and retry-safe: retrying
a lost response with its original request ID does not create duplicate binders.

Only NEW binders are created. Existing layouts and ownership quantities are never
modified. Later imports do not automatically rebuild an already generated binder.

## Market pricing

The existing worker fetches card pricing through TCGdex. Only Normal/Holo/Reverse
TCGplayer marketPrice values with matching provider printing keys are used for
printing prices and totals. Manual, edition-unspecified and unsupported printings
remain unpriced; no Normal-price or cross-language fallback is applied.

Cardmarket trend/trend-holo values appear separately as card-level references, not
printing totals, because these aggregate fields do not prove an exact printing match.
Provider mappings may still be incorrect. Estimates are not condition-adjusted,
appraisals, guaranteed selling prices or Australian-market sale records.

Open a card for prices, source currency/update time, last successful check, AUD rate
date and recorded history. Grid tiles show the lowest supported printing price as
From. Overview totals actual owned quantities; binder pages total planned pockets.
Repeated pockets count as repeated planned purchases, not additional owned copies.
History accumulates from activation; historic prices or ownership are not invented.

Headline AUD totals exclude missing/unsupported quotes, source dates older than
three days, fetches older than two days, failed refreshes, and absent/older-than-seven-day
FX rates. Coverage counts identify exclusions. An unpriced collection shows Not priced
yet, not zero. Failed refreshes retain older observations but exclude them from totals.
A successful no-price response withdraws current quotes without deleting history.

AUD conversion uses Frankfurter's ECB-filtered USD/AUD and EUR/AUD reference pairs.
No API keys, additional dependencies, paid account or additional containers are required
by this integration. Availability and data coverage depend on the upstream services.

## Refresh and configuration

Owned, wishlisted and planned cards are tracked in batches of 100. Default recheck
interval is six hours, subject to worker queue load. The scheduler checks due cards
roughly once a minute while the worker is available. Imports capture embedded pricing.
FX checks are periodic with successful responses cached for 12 hours.

Card Check prices requests a single card, no more than once per hour per card.
Overview/binder Refresh reloads estimates; for administrators it also queues due
tracked cards. Recently checked cards are not force-refetched. Job progress/errors
appear in Data & settings alongside catalogue imports.

Optional .env overrides (existing installations use these defaults automatically):

```dotenv
PRICE_TRACKING_ENABLED=true
PRICE_REFRESH_HOURS=6
```

Hours are bounded to 1–168. Disabling new fetches does not erase cached data or dates.
Upstream pricing is hourly-to-daily or daily: this is not a second-by-second feed.

Required outbound HTTPS: api.tcgdex.net and api.frankfurter.dev. Artwork still loads
from assets.tcgdex.net. Requested card IDs go to TCGdex; your account information,
notes and full collection database are not sent to these providers.

## Update the live installation

Merge this release only after its GitHub validation passes. Then run from the existing
CardShelf repository on your server:

```sh
git pull --ff-only
sudo sh scripts/upgrade.sh
```

Do not clone over the existing installation or regenerate .env. The helper builds
before stopping the old site, takes a local database safety dump automatically, stops
app/worker, applies migration 002, updates only APP_VERSION in .env and waits for
app/worker health. Existing credentials, database volume and HTTPS proxy are preserved.
A migration failure leaves app/worker stopped for investigation. The local dump does
not replace an off-server backup. Never use docker compose down -v to upgrade.

Migration 002 is additive: price cache/history/FX and generation-request tables,
extended job types and nullable binder-generation metadata. Existing ownership and
layouts are not transformed or deleted.

## Verification scope

Dependency-free tests cover parsing/matching, freshness and FX checks, coverage,
natural sorting, owned-only layouts, volume splits, partial imports and preview
changes. API/SQL integration tests cover persistence, duplicate history suppression,
provider failure retention, per-user totals, generation replay, stale previews and
unchanged ownership. The workflow must run the new tests, not just reuse a green
result from version 0.1.1.

The authoring runtime cannot reach npm/provider hosts and has no Docker/PostgreSQL.
Full Nuxt typecheck/build, SQL integration, live upstream responses, container startup
and browser/device behaviour require CI and deployment verification.

## Primary references

- TCGdex market fields and refresh rates: https://tcgdex.dev/markets-prices
- Missing/mismapped prices and API authentication: https://tcgdex.dev/faq
- Frankfurter v2 API and provider filters: https://frankfurter.dev/
