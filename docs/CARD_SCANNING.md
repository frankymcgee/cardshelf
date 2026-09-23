# Card photo scanning (v0.31.0)

CardShelf can send one card-front photo to the OpenAI API, read visible identifying
text, and suggest matching records from the imported catalogue. English and
Japanese Pokémon cards are supported. The user chooses the catalogue card,
printing/finish, condition and number of copies before any inventory changes.
An optional Collection binder pocket can be empty or already show that printing.
Independent tracking binders retain their separate checklist workflow.

## Enable after upgrading

1. Run the normal upgrade procedure, including migration `020_card_scanning.sql`.
   Scanning starts disabled, with a zero budget and no provider credential.
2. Preserve the existing `CARDSHELF_INTEGRATION_KEY`. If none exists, use
   `sh scripts/configure-integrations.sh`, retain a secure backup of `.env`, and
   recreate the application container with that environment. Do not replace a key
   already used by another integration.
3. Open **More → Card scanning** as an administrator. Add an OpenAI project API key
   with Responses API access, set a monthly USD budget and per-member allowance,
   enable scanning, and confirm with the current administrator password.
4. Import the Pokémon sets that members need, then open **Collection → Scan a card**.
   Test representative English/Japanese cards, reprints, foil finishes, and difficult
   lighting. Check the exact printing before confirming. Try one addition and Undo
   before wider use.

The API is billed separately from a ChatGPT subscription. No GPU or additional
application service is required. The API key is encrypted with AES-256-GCM, never
returned to the browser, and sent only to `https://api.openai.com/v1/responses`.
Use a dedicated project/key for this feature to make provider invoice comparison
clear. HTTPS should already be configured for the site and mobile camera uploads.

## Flow and limits

- The camera/file input accepts JPEG, PNG or WebP. The browser resizes to at most
  1600 pixels per side; source files are limited to 12 MB. HEIC must be converted
  to a supported format. No continuous video is captured.
- The server accepts at most 4 MB of decoded image data and 16 megapixels, validates
  image bytes, rotates/resizes and re-encodes to JPEG without metadata. One analysis
  runs at a time across the installation; a busy response can be retried.
- Recognition uses the pinned `gpt-4.1-mini-2025-04-14` snapshot with a strict JSON
  schema, fixed extraction prompt, one image, no tools, a 768-token output cap and
  a 45-second timeout. Only printed observations become matching hints. The model
  cannot choose database IDs, add inventory, make network/tool calls, or grade cards.
- Catalogue matches show supporting details rather than a fabricated probability.
  Reprints and number/name collisions remain possible. Missing sets can be imported
  separately; manual catalogue search is available on the review screen.
- The same scan request ID and image return the same receipt without another
  provider call. Confirmation is also idempotent. A conflicting quantity, inventory
  revision, binder revision or occupied pocket is rejected transactionally.
- Every confirmed addition increases the requested condition's quantity. Existing
  notes and wishlist flags are preserved. The binder is a layout, not physical-copy
  allocation. Undo restores the prior quantity and removes only a pocket created by
  this scan, provided relevant ownership and binder revisions have not changed.
- Receipt history allows resuming after a lost connection or page reload. A scan
  interrupted for over two minutes is marked failed. Undo remains available after
  membership loss; new analysis/additions require collection access for Pokémon.

## Budgets and later GPU comparison

Budget enforcement happens in CardShelf before dispatch, under a database lock.
Each request reserves an estimated maximum using a conservative 16,384-input-token
ceiling plus the output cap. At the initial accounting rates ($0.40 / million input
and $1.60 / million output tokens), the reservation is **$0.007783**. This is a
reservation, not a prediction of typical scan cost.

Valid reported usage replaces the reservation with rounded-up microdollar cost.
Cached-input discounts are ignored conservatively. A provider timeout or response
without valid usage keeps the reservation, since the upstream request may have been
charged. A local image rejection releases its money reservation. All accepted scan
attempts still count toward the member allowance. Confirmation and Undo cost no
additional API call. Limits reset by UTC calendar month; decreasing limits mid-month
does not remove existing usage. Deleted accounts retain anonymous cost records so
account deletion cannot reset the shared budget.

A new scan is refused if the remaining budget cannot cover its reservation. The
admin screen reports accounted spending (including reservations), measured usage
cost, uncertain requests, per-member volume, confirmed additions, monthly history
and average response time. The application estimate is not an invoice-level hard
cap: provider prices can change, taxes/other API clients are outside it, and an
unexpected model/usage boundary can exceed a reservation. Such a valid response
pauses scanning automatically; check the model and accounting rates before enabling
it again. Malformed usage keeps the conservative reservation. The provider invoice
is authoritative. Rates can be raised in the admin screen but not lowered below
the verified model prices.

Compare observed monthly API cost and scan volume against the **incremental** cost
of GPU hosting, operational work and recognition quality on a representative card
sample. Confirmation counts are not accuracy measurements. A local provider can
replace `lib/card-scan-provider.mjs` behind its observations/usage contract while
retaining catalogue resolution, confirmation and inventory transactions. Its
configuration, resource limits and cost accounting need their own implementation;
there is no local/GPU provider selector in this release.

## Photo and credential handling

The user explicitly agrees to send each photo to OpenAI. Photos stay in browser and
server request memory and are not written to CardShelf's database, disk, audit log
or catalogue. Receipts retain a SHA-256 image digest for retry detection, extracted
identifying text, candidate IDs, usage and confirmed addition details. Treat
backups as private collection data. Reverse proxies should not log request bodies.

Requests use `store: false`. This prevents stored Responses application state; it
is not Zero Data Retention. OpenAI's standard abuse-monitoring retention can still
apply (normally up to 30 days), subject to the project's data controls. The photo
leaves your infrastructure; this mode does not satisfy an all-internal workflow.

Official references, checked 2026-09-23:

- [Image inputs](https://developers.openai.com/api/docs/guides/images-vision)
- [Structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [GPT-4.1 mini model and pricing](https://developers.openai.com/api/docs/models/gpt-4.1-mini)
- [API data controls](https://platform.openai.com/docs/guides/your-data)

## Validation

`npm test` includes recognition contract, input, matching, image and credential
checks with synthetic data. `npm run test:integration` includes the production HTTP
routes and real PostgreSQL transactions for admission, quotas, concurrent requests,
replays, binder conflicts, Undo, membership and secret redaction; recognition is
injected inside the test process and never contacts OpenAI. There are no public
mock/provider override parameters. `npm run test:scanning-ui` exercises the built
scan/admin screens in Chromium at desktop and phone sizes with synthetic API
fixtures. Live OpenAI quality, provider billing and physical mobile camera capture
require deployment acceptance with your own API key and representative cards.
