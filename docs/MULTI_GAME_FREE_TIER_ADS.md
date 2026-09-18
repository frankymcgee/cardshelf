# Multi-game catalogues, Free accounts and sponsor placements — v0.13.0

Base: `4ef73b43218a801681710eac478e71d09b2f8405` (CardShelf v0.12.0).

## Release scope

This release adds a free public reference catalogue, an explicit Free account type,
three supported card games, subscription-aware game management, and optional
first-party sponsored placements. It does not change Stripe products, prices,
accepted subscription snapshots, billing activation or referral payouts.

The public catalogue at `/explore` is available without an account or subscription.
It exposes shared card metadata, permitted catalogue artwork and cached source
prices. It does not expose a collector's quantities, notes, inventory, private
binders, email address, ownership state or account identity. An imported catalogue
entry is not a claim that anyone owns that card.

## Games and free sources

| Game | Source | Initial coverage |
| --- | --- | --- |
| Pokémon | Existing TCGdex connection | Existing English/Japanese imports and pricing remain intact. |
| Yu-Gi-Oh! | YGOPRODeck v7 | English set-number/rarity records, locally cached artwork, available guide prices. Edition and alternate-art matches are not inferred. |
| Magic: The Gathering | MTGJSON v5 SetList, individual set JSON and AllPricesToday | English paper printings, normal/foil/etched finishes and available daily retail references. Double-faced cards are one inventory identity with available faces displayed publicly. |
| Magic artwork | Scryfall, looked up by the MTGJSON-provided printing identifier | Matching English artwork is downloaded and stored locally. No fuzzy name replacement. |

These integrations do not require a paid API key. They use the providers' free
endpoints/downloads, not subscription-only GraphQL, third-party API marketplaces,
website scraping or unofficial copies of paid services. Provider availability,
coverage and terms can change. API access does not convey blanket rights to the
underlying game artwork, rules or trademarks. Review the provider and rights-holder
terms before a commercial launch; public availability of the catalogue is not a
legal clearance certificate.

Reference documentation checked for this implementation:
- TCGdex: https://tcgdex.dev/faq and https://tcgdex.dev/markets-prices
- YGOPRODeck: https://ygoprodeck.com/api-guide/
- MTGJSON downloads: https://mtgjson.com/downloads/all-files/
- MTGJSON card/price models: https://mtgjson.com/data-models/card/card-set/
  and https://mtgjson.com/data-models/price/price-list/
- Scryfall: https://scryfall.com/docs/api and
  https://scryfall.com/docs/faqs/i-m-having-trouble-accessing-the-scryfall-api-or-i-m-blocked-17
- Wizards Fan Content Policy: https://company.wizards.com/en/legal/fancontentpolicy

The site displays provider attribution and an independent-site/rights-holder
notice. Paid memberships govern CardShelf's private management tools, not access
to public reference information. Do not remove that distinction or attribution
without reviewing the terms again.

## Membership behaviour

| Effective access | Public lookup | Private game management | Sponsor eligibility |
| --- | --- | --- | --- |
| Signed out | All supported games | None | No |
| Explicit Free account | All supported games | No new private edits; retained records can be read/exported and binders deleted | Yes, only while ads are enabled and no paid/pending subscription or protected grant overrides Free |
| Collector | All supported games | One selected game, using the existing Collector features | No |
| Collector Pro | All supported games | All supported games, using the existing premium collection/binder features | No |
| Administrator, existing testers, Complimentary | All supported games | All supported games/full existing access | No |

Collector Pro remains the existing internal `plus` tier. No subscription is
renamed, migrated or created by this update. A Stripe product named Collector Pro
can use the existing `cardshelf_plan=plus` metadata mapping. Marketing names alone
are not entitlements. "All games" means all games currently supported by CardShelf;
it does not remove normal per-request, binder-capacity or import-size limits.

Open **Card games** in the signed-in navigation to select a Collector game.
Existing accounts default to Pokémon until they choose another game. A Collector
can change the selected game after explicitly acknowledging that other-game
records become read-only. The change never deletes or converts those records.
Pro/protected accounts do not need to select a game to unlock it.

Each binder belongs to one game. The database rejects mixed-game pockets and
changing an existing binder's game. Create another binder for another game.
Tracking generation, quick marking, conversion to a collection-backed binder,
manual ownership edits and import writes check the applicable game permission
on the server. Existing read/export/delete operations are preserved. These checks
do not depend on hiding a button in the browser.

## Existing data and access

Migration 013 assigns existing cards, sets and binders to Pokémon without changing
their IDs, cards, quantities, conditions, notes, marks, appearance or sharing links.
The new identity format is `yugioh:en:...` or `mtg:en:...`; legacy `en:...` and
`ja:...` Pokémon IDs continue to work.

No old user is automatically converted into Free. The existing administrator
"Add a collector" / tester invitation workflow retains its protected tester grant.
A Free account is deliberately different from a Complimentary account.

A new Free account has an explicit marker separate from tester and paid grants.
The legacy automatic tester grant is removed only inside the transaction that
creates that brand-new Free user; an existing email can never be used to strip
someone else's grant. Paid/manual entitlements and protected grants take priority
over the Free marker. After a registered Free user's paid access ends, their Free
status can resume. Unknown or unresolved access is never guessed to be ad-eligible.

The existing global billing/testing switches are not changed. Explicit Free
accounts remain limited even while paid-tier enforcement is disabled for testing.
Legacy invited testers retain their original full-feature evaluation access.

## Importing additional games

1. Deploy only after validating the PR and applying migration 013 with the existing
   upgrade helper. Keep the original database volume and all secrets.
2. Open **Game catalogue imports** in the administrator navigation.
3. Choose Yu-Gi-Oh! or Magic and select **Load available sets**.
4. Search for a set, review the provider/rights notices, and queue that set.
5. Watch the job in **Data & settings**. Open `/explore` and choose the same game to
   check the public result. Use the signed-in Cards page or binder builder to use
   those records privately under the appropriate membership.

Pokémon still uses its existing Data & settings import. Do not reimport Pokémon
solely for this migration. The shared worker handles the new `import-game-set`
jobs alongside existing imports and price refreshes. Reimporting refreshes
catalogue metadata without resetting ownership or deleting manual printings.
Missing artwork does not require throwing away valid card metadata.

Start with a small set. Imports and prices can be incomplete: a failed image,
price-feed request or unsupported card is reported rather than replaced by an
unrelated card. A job can finish with issues and still have imported valid entries.
Review it and retry after resolving the reported issue.

## Caching, resource use and pricing

- Additional-game JSON is shared across all users and cached for 24 hours.
  Scryfall metadata is cached for 30 days; downloaded art is re-encoded to WebP,
  stripped of metadata and stored once in the database. Browsers do not hotlink
  YGOPRODeck or Scryfall images. Existing Pokémon artwork handling is unchanged.
- Requests use fixed provider operations, a descriptive User-Agent and Accept
  header, response-size bounds, a 45-second request timeout and cross-process
  host pacing. Redirects are not followed to arbitrary hosts. HTTP 429/503 pauses
  further uncached requests to that host for one hour, shared through database
  state; a caught error cannot roll back that cooldown.
- The worker refreshes tracked additional-game prices on a daily cache cycle.
  Manual checks reuse a fresh provider cache; pressing Refresh does not force
  another external download or make a provider's old quote current.
- Magic's first price import downloads and parses the shared daily price file.
  It is bounded at 256 MiB decoded / 40 MiB compressed for cached JSON. A full
  parse can require considerably more memory than the downloaded file; provision
  ample worker memory (at least 2 GiB of available headroom is a sensible starting
  point to test, not a guaranteed maximum), disk and database-backup capacity.
  A feed beyond the size bound is rejected; resource exhaustion is still possible
  on undersized servers. Metadata imports are retained if prices fail. One parsed
  daily feed is reused in-process rather than reparsed for every owned card.
- A daily MTGJSON retail value is not a realised sale. Normal, foil and etched
  remain separate. Buylist/MTGO values are not reused for paper collections.
- YGOPRODeck set/rarity prices and its general lowest-across-versions vendor values
  are explicitly approximate. They do not establish condition, edition, exact
  alternate artwork or transaction date. A retrieval timestamp is not substituted
  for a missing source-update date.
- Available TCGplayer, Cardmarket and Card Kingdom values retain their source,
  metric and currency. One selected estimate contributes per copy; sources are
  not added together. Existing Cardmarket approximate-value behaviour, including
  last-known warnings, is preserved. Missing/outdated AUD exchange rates still
  prevent an AUD total; no price or conversion rate is invented.

## Free accounts and registration

Open **Free tier & ads** in the administrator navigation. Registration starts
**off**. Administrators can create a new Free account there while public signup is
closed. This is separate from the existing protected tester invitation workflow.

To open self-registration, review your privacy/support arrangements, enable the
registration checkbox, enter a reason and your current administrator password,
and save. `/register` then accepts a new name, email, password and affirmative
notice acknowledgement. Input is bounded and rate-limited. No credit card or
Stripe customer is created during signup.

This release does not add email verification, invitation email delivery, password
reset emails, CAPTCHA or a full account-recovery service. Email addresses are not
claimed to be verified. Do not open general public registration until you have a
support/recovery and abuse-response process appropriate to your audience. Invited
credentials must be provided securely; do not commit them or post them publicly.

## Advertisements: Free-only first-party sponsorship

Ads start **off** and are independent of the registration checkbox and all billing
switches. Configure a sponsor name, plain-text message, reviewed HTTPS destination,
call-to-action and optional image in Free tier & ads. Confirm permission to
use the creative, a reason and your current administrator password before saving.

The first implementation is a single administrator-managed sponsor banner, not
Google AdSense, AdMob, programmatic bidding or automatic ad-network enrolment.
There is no arbitrary HTML/script slot and no third-party advertising JavaScript,
advertising cookie, personalised targeting or advertising-specific impression/
click ledger. Normal server access logs can still exist. Clicking the reviewed
sponsor link opens the sponsor's own website, whose privacy rules also apply.

Save text settings first. To add an image, re-enter your administrator password
and upload a still JPEG/PNG/WebP smaller than 1 MiB. The server decodes, bounds,
re-encodes and removes metadata before storing it locally. Uploading an image does
not submit other unsaved text changes. Removing the image does not remove the
text advertisement. Settings use revisions to reject stale saves.

Placements are limited to the signed-in overview, card catalogue and public card
browser/detail screens. Only an authenticated account whose **effective tier is
Free** can receive the creative. Collector, Pro, administrators, testers and
Complimentary users receive no ad payload. Signed-out visitors are not assumed to
be Free customers. Current/pending or still-paid Stripe subscription records
suppress ads across environments. Errors and uncertain eligibility fail closed.

The image route independently repeats the eligibility check and uses private,
no-store responses. An ordinary paid user cannot fetch it by copying a Free user's
image URL. Administrators have a separate, protected creative-preview route.
The client removes old creative while checking eligibility and rechecks on route,
account, focus/visibility and periodic refresh. An already-rendered banner may
remain until the next check after an out-of-band tier change; no cache policy can
recall an image already delivered to a browser.

No sponsor money, marketplace payments or referral payouts are processed here.
Adding an external ad network later requires a deliberate provider integration,
consent/privacy assessment, content-security policy changes and the same
server-confirmed paid/protected-user exclusion. A sponsor banner does not by itself
generate advertising income.

## Acceptance before release

Run the unchanged Validate CardShelf workflow for the pushed branch and PR. Both
triggers execute the same unit, strict Nuxt typecheck, production build, migration,
server-health and API/PostgreSQL integration steps. No checks are removed.

Use separate administrator, protected tester, new Free, Collector and Pro test
accounts. Verify free public lookup while signed out, Free limits, all paid/tester
ad exclusions, image access controls, one-game switching and preserved read-only
records. Exercise set import, failed/retried images, source outages and prices
against actual small provider sets. Check desktop/mobile and both light/dark modes.

Do not enable live billing, advertise unverified source coverage or treat fixture
prices as real acceptance evidence. The external providers are not exercised by
synthetic integration fixtures. Read the accompanying validation report for the
exact checks actually executed when this patch was prepared.
