# CardShelf 0.6.0 — collector-to-collector marketplace beta

## Scope

A signed-in card classifieds marketplace: one physical card per listing, an AUD
asking price, seller-described condition, actual front/back photos, delivery details
and private listing enquiries. This is not checkout or a completed-payment system.
There is no payment processor, escrow, seller payout, fee collection, shipping label,
authentication service, grading guarantee, buyer protection or verified sale badge.
An enquiry is not an order and does not reserve a card. Sellers arrange completion
with the interested collector and report a listing's availability themselves.

The existing website and every collection/tracking binder remain unchanged in scope.
Nothing automatically publishes existing collection records or private account details.

## Membership and tester access

The plan definitions give `marketplace_browse` to Collector and Collector Plus, and
`marketplace_sell` to Collector Plus. The server checks seller access, not only the UI.
The existing `ACCESS_ENFORCED=false` testing policy remains in place: all authenticated
testers can try both sides without payment. Existing non-expiring grants are untouched.
A future enforcement policy must preserve tester grants; the pure permission resolver
includes tests for that behaviour. No membership assignment or billing switch is added.

## Routes and workflow

- `/marketplace`: signed-in browse with card/set/number/city search, language/condition
  filters, asking-price sort and pagination. Reserved cards remain labelled; sold,
  withdrawn and moderator-hidden listings leave the browse view.
- `/marketplace?mine=1`: your own listing management, including inactive/hidden listings.
- `/marketplace/new`: select an imported printing, supply a public seller alias and
  actual front/back photos, describe condition, enter AUD price/postage and affirm
  ownership, authenticity and photo rights before publishing.
- `/marketplace/:id`: listing details, seller management, private enquiry and report form.
- `/marketplace/inbox`: participant-only conversations, price-at-enquiry reference,
  bounded message history and manual refresh. No email/push notifications in this version.
- `/marketplace/moderation`: administrator-only report queue. Listing detail provides
  audited hide/restore actions with a reason shown to the seller.

Users do not need detailed inventory records before posting, but must confirm they
actually own the card. The printing picker prioritises the user's recorded holdings.
Images in that picker are catalogue references, not the seller's sale evidence.

Prices are entered as decimal AUD values in the UI and stored as integer cents.
Asking prices are independent of upstream market estimates; there is no currency
conversion, fee, tax or settlement calculation in the marketplace. Postage is a
seller-entered amount, not a carrier quote. Actual arrangements must be confirmed.

Publishing makes only the selected listing details and photos visible to signed-in
members. Account email, legal/profile name, private quantities, conditions, notes,
credentials and unrelated binders are not disclosed automatically. Sellers choose
an explicit public alias; buyers are shown a conversation-specific collector label.
Messages are plain text. Information a participant types into a message is deliberately
shared with the other participant; users are warned not to send sensitive credentials.

## Availability, persistence and safety

Seller state is active -> reserved/sold/withdrawn, with reserved -> active/sold/withdrawn
and withdrawn -> active supported. Sold is terminal in this release and labelled
seller-reported. Listing updates use revisions and locks to reject conflicting edits.
Card identity and photos cannot be replaced after publication; withdraw and create
another listing when those details were wrong. Moderation is a separate flag that a
seller cannot clear by editing or reactivating an advertisement.

Listing creation uses per-seller request IDs and content identity for safe in-session
retries. Enquiries are unique per listing/buyer, and message retries retain request
IDs. Existing enquiries are reopened as views, not duplicated; closed conversations
cannot be restarted. Message updates are serialized and do not claim real-time delivery.
Either participant can close a conversation to stop further messages. Administrators
can review reported advertisements, but cannot browse private messages unless they
are themselves participants. Moderation pauses messaging on hidden listings.

All APIs and photos require an authenticated session. Mutations retain the existing
same-origin protections and add endpoint-specific rate limits, bounded streamed JSON,
strict field allowlists and participant/owner checks. Lists and messages are paginated.

Sale photos accept JPEG/PNG/WebP, at most 2 MB each. The server decodes and re-encodes
them to WebP (up to 1600px and 1 MB per photo), removing metadata and original filenames.
Images are served through permission-checked, no-store endpoints, not public static URLs.
Limits: 100 live and 500 total listings per seller, 64 MB of stored sale photos per seller,
1,000 initiated enquiries per buyer, and 500 messages per conversation. These are beta
abuse/storage limits, not subscription charges. Withdrawn unused listings can be deleted
with their photos. Listings with conversations or reports are retained for discussion
or moderation; broader retention/account-erasure tooling needs separate operator review.

**No marketplace action changes `collection_entries`, binder slots or tracking marks.**
After completing a sale, a seller must reconcile their collection themselves. There
is no physical-stock reservation or overselling guarantee because this is an enquiry
marketplace rather than an order system. Repeated listings of a physical item should
be avoided by the seller; the application cannot prove physical possession.

Migration `006_marketplace.sql` only adds marketplace tables and indexes. No existing
accounts, sessions, grants, plan amounts, inventory or binders are converted/deleted.
All listings, photos, messages and reports are in PostgreSQL and included in the
existing database backup. Treat these backups as sensitive. No new container,
third-party account, API key or JavaScript dependency is required.

## Upgrade and acceptance

Merge the PR only after its complete CI passes. From the existing server checkout:

```sh
git pull --ff-only origin main && sudo sh scripts/upgrade.sh
```

The existing helper builds first, takes its automatic local safety backup, applies
migration 006 and restarts app/worker. Do not rerun configure.sh or remove volumes.

Use two invited test accounts to publish one listing, open an enquiry, reply, change
availability, and verify that neither collection is changed. Test a report with an
administrator and confirm the hidden listing disappears for unrelated members. Check
photos and message controls on an actual phone before inviting broader participation.
Use test listings and avoid real-money transactions while evaluating this release.

Before enabling paid membership or integrated transactions, decide operator policies,
seller verification, dispute/refund handling, moderation/retention, taxes and payment
provider onboarding. This release does not claim legal or payments-platform readiness.

## Validation

New pure tests cover monetary inputs, strict schemas, state transitions, permissions,
photo payloads, private routes and the additive migration. Image tests exercise actual
Sharp decoding/re-encoding. New API/PostgreSQL integration tests cover session checks,
photos, immutable account identity, duplicate submissions, participant isolation,
price snapshots, concurrency, moderation, terminal sales and unchanged inventory.
Existing platform tests explicitly expect all eleven current tester feature codes.
Full repository validation must run alongside existing tests; local fixtures alone
are not a substitute for the production Nuxt build and integration suite.

Primary engineering references:
- https://nuxt.com/docs/4.x/directory-structure/server
- https://www.postgresql.org/docs/17/explicit-locking.html
