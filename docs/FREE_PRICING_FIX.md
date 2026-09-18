# CardShelf v0.11.1 — free-feed pricing correction

Base: `7d0e77113bf9033d345cab18f8ed423ffed2960e` (v0.11.0).

## What changed

Available Cardmarket prices are now visible directly in the card's Market prices
panel, rather than hidden behind a collapsed section underneath an unavailable
TCGplayer printing price. The panel shows the source, provider category, original
EUR value, approximate AUD conversion when a usable exchange rate exists,
metric and source-update time. Stale values and failed refreshes remain labelled.

The feed parser now retains all ten supported Cardmarket trend/average metrics:
`trend`, `avg`, `avg1`, `avg7`, `avg30` and their `-holo` counterparts.
One reference is highlighted for each provider category. Within that category,
a usable observation is preferred over a stale/failed one, followed by this
metric preference: trend, 30-day average, 7-day average, average selling price,
1-day average. Other available metrics remain expandable. They are not averaged
into a synthetic price, and they do not count as separate independent sources.

The TCGplayer parser now accepts both documented naming conventions:

| Local printing | Accepted feed keys |
| --- | --- |
| Normal | `normal` |
| Holo | `holo`, `holofoil` |
| Reverse holo | `reverse`, `reverse-holofoil` |

Matching duplicate aliases produce one quote. Conflicting positive alias values
produce no matched quote, rather than an arbitrary choice. First-edition,
unlimited-edition and other special categories are not collapsed into a generic
finish. Low, mid, high and lowest-asking prices are not substituted for a missing
TCGplayer `marketPrice`.

Different messages identify never-checked cards, refresh errors, reference-only
pricing and genuinely empty supported feed data. A missing price in this feed
does not claim that the marketplace has no listings.

## Scope and data protection

This uses the existing TCGdex feed only. It adds no paid API, key, scraper,
external provider, package dependency, migration or billing change. All reads
and refreshes keep using the existing authenticated endpoints and rate limits.
The configured refresh interval and tracked-card scheduling scope are unchanged.
This targeted fix does not introduce an all-catalogue sweep.

Cardmarket references are still unconfirmed for a particular finish, edition or
condition and are not added to collection/binder totals or the matched-price
catalogue badge. A holo-category reference is not automatically a reverse-holo
quote. The new TCGplayer aliases can contribute to existing matched-price
badges and totals after a successful refresh, with all the original freshness,
FX and printing-match safeguards retained. No language records are substituted.

Existing collections, quantities, binders, Stripe settings, tester grants and
Complimentary access are untouched. The three version changes only align the
package and fresh-install examples; do not run configure.sh on an existing site
or replace .env.

## Deploy and check

Apply the patch to a clean checkout of the base commit, create a branch and PR,
and wait for both GitHub Actions checks before merging. After merging, from the
existing server checkout on main:

```sh
git pull --ff-only origin main && sudo sh scripts/upgrade.sh
```

Keep the existing .env, encryption key, database volume and accounts.

Cached Cardmarket trend values become visible as soon as the upgraded frontend
is loaded. Newly supported averages and TCGplayer aliases appear after the next
successful price refresh. Use the existing Check prices button; a card checked
within the previous hour still uses the existing cooldown. There is no need to
reimport the set or edit ownership.

For the reported Mega Delphox ex / Pitch Black #008 EN Holo case, verify that the
stored Cardmarket reference is visible without expanding a section. Its actual
amount is whatever the feed supplied; test fixture values in this patch are
synthetic, not a price quote for that card. Whether that card also receives a
TCGplayer quote depends on its actual upstream response. The screenshot's
collapsed section did not expose that response or an exact Cardmarket amount.

Check a card with an exact TCGplayer price as well, then a card with no feed
prices. Confirm that the former retains its matched value and the latter is not
assigned an invented Cardmarket price. Existing reference-only holdings remain
unpriced in matched collection totals by design.

## Validation commands

Existing workflow commands are unchanged: npm test, npm run typecheck,
npm run build, npm run migrate, production-server health check and
npm run test:integration. Database commands belong only in the disposable
`cardshelf_test` environment, never against a live collection.

The patch adds 47 dependency-free regression tests and six API/PostgreSQL
subtests using unique disposable fixtures. No existing test assertions were
removed or relaxed. See the accompanying validation report for actual executed
checks versus outstanding full CI execution.

## Provider references

Checked 18 September 2026:

- https://tcgdex.dev/markets-prices — embedded Cardmarket and TCGplayer pricing,
  trend/average metric examples, and older holo/reverse key examples.
- https://tcgdex.dev/reference/card — documented holofoil/reverse-holofoil keys,
  distinct edition categories, and Cardmarket average fields.
- https://tcgdex.dev/faq — pricing coverage and mapping limitations.

These schemas are not a guarantee that every marketplace listing or exact
printing has an available upstream price.
