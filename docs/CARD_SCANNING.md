# Card photo scanning (v0.37.0)

CardShelf can send one card-front photo to the OpenAI API, read visible identifying
text, and suggest matching records from the imported catalogue. English and
Japanese Pokémon cards are supported. The user chooses the catalogue card,
printing/finish, condition and number of copies before any inventory changes.
An optional Collection or Tracking binder pocket can be empty or already show that
printing. Choose the binder once to keep using it while scanning further cards.
Tracking placement also marks the chosen checklist pocket collected.

## Enable after upgrading

1. Run the normal upgrade procedure, including migrations `020_card_scanning.sql`
   `021_card_scanning_settings.sql` and `023_scan_tier_limits.sql`. New installations start disabled, with a
   zero budget and no credential. Existing installations keep their connection,
   budget, model, prompt and request defaults when migration 021 is applied.
2. Preserve the existing `CARDSHELF_INTEGRATION_KEY`. If none exists, use
   `sh scripts/configure-integrations.sh`, retain a secure backup of `.env`, and
   recreate the application container with that environment. Do not replace a key
   already used by another integration.
3. Open **More → Administration → Card scanning** as an administrator. Add an OpenAI project API key
   with Responses API access, set a monthly USD budget and per-tier member allowances,
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

## Membership allowances

Set each tier's monthly allowance in **Monthly scans by membership tier**.
The Plus row also covers Stripe products named Collector Pro. Complimentary
covers administrators and protected tester grants. `0` means unlimited scans per
member; a zero shared USD budget still stops scanning.

Limits do not grant new permissions. Free remains catalogue-only and Collector
cannot scan when collection access is excluded by tier enforcement. The public
pricing table reflects these restrictions. Protected testers retain their access
and use the Complimentary allowance.

Migration 023 copies the previous global allowance into every tier. Current-month
receipts are retained, so upgrading, downgrading or changing limits does not reset
usage. UTC calendar-month boundaries reset the allowance, independently of Stripe
billing cycles. All analysis attempts count, including failures; a receipt retry,
confirmation or Undo does not count again. Old settings clients may preserve but
cannot change the retired global cap; reload to use the new tier inputs.

## Model, reasoning and prompt controls

**More → Administration → Card scanning → Recognition settings** accepts a model ID, reasoning
effort/mode, maximum output tokens, image detail and a multiline recognition prompt.
The initial model remains `gpt-4.1-mini-2025-04-14`. Choose a model with image input
and strict structured-output support. Aliases are accepted; usage reports show
both the requested ID and the model returned by OpenAI. Model availability and
supported options depend on the project and selected model.

Leave reasoning effort and mode at **Model default · omit setting** for GPT-4.1
mini. This omits the corresponding API parameters; selecting `none` explicitly
sends `reasoning.effort: "none"`, which is a different choice. Supported effort
levels vary by model. `pro` mode is available only on models that support it and
can increase token use and latency. Temperature is omitted to avoid incompatibility
with reasoning models. The application does not automatically switch models.

Output tokens include reasoning and the visible result. The default 768-token cap
can be too small for reasoning models; increase it as needed, up to 32,768 tokens.
An incomplete response reports the output-limit problem and still accounts for
reported usage. **Request limits** offers a 15–180-second timeout (default 45) and
a 16,384–131,072-token input reservation (default 16,384). The latter is an
accounting estimate, not a provider-side input limit.

The prompt can contain up to 8,000 characters. **Restore default prompt** edits the
form; it takes effect only after saving with the administrator password. CardShelf
always adds a short instruction to treat image contents as untrusted and return
identification fields. The response schema, catalogue lookup and explicit collection
confirmation remain enforced independently of the editable prompt.

Enter the selected model's current input/output USD prices in **Budget and model
pricing**. These are manual values and do not change automatically with the model.
The reservation preview updates with the unsaved token limits and prices. Every
new request snapshots its configuration and prices before dispatch, so a settings
change cannot reprice or alter a scan already running. Receipts store a prompt hash
and settings revision rather than duplicating prompt text; audit records omit the
prompt and API key. Only administrators can read/edit the saved prompt. Member
scan requests cannot override any provider controls.

An unsupported model/parameter combination returns a generic configuration error;
it does not retry with another model. Test a representative card after saving.

## Automatic binder placement

Choose **Add scanned cards to** before taking the first photo, or **Add to a binder**
when reviewing a recognised card. Both Pokémon Collection and Tracking binders
are listed when permitted by the member's access. The binder's **Scan a card**
button opens the scanner with that destination selected. Scanning still requires
collection access; a standalone checklist subscription does not gain inventory or
paid recognition access through a Tracking binder.

After choosing the exact printing, **Automatic** looks across every page for a
pocket already displaying that printing. If none exists, it selects the first
empty pocket. A full binder can still accept a scan when it has a matching pocket.
Already-owned printings and already-collected checklist pockets remain selectable:
confirmation adds the requested copies once and reuses that pocket.

The destination page/pocket is shown before confirmation and on the saved receipt.
Choose **Choose a pocket myself** to use another allowed position. Collection
binders permit an additional placement of the same printing in an empty pocket.
Tracking binders reuse their existing checklist entry; they do not create duplicate
checklist rows for the same printing. A different printing is never replaced, even
if it belongs to the same card. A full binder without a match requires a different
binder or **Collection only**; no partial inventory addition occurs.

Tracking placement marks the selected pocket collected in the same transaction as
the inventory addition. This is an explicit action for that scan; later independent
checklist marks do not automatically change inventory. Undo removes a pocket created
by the scan, or restores a previously missing Tracking mark. A mark that was already
collected stays collected. Later edits to a pocket/checklist changed by the scan
prevent Undo from overwriting those changes.

**Scan another card** retains the binder, returns to automatic placement and reloads
its current pockets. The URL also retains the binder across page reloads. The server
checks binder ownership, game, membership, revision and available pockets again
under the collection lock before saving. Retrying an automatic confirmation uses
the original receipt and cannot pick another pocket or add copies again.

## Flow and limits

- The camera/file input accepts JPEG, PNG or WebP. The browser resizes to at most
  1600 pixels per side; source files are limited to 12 MB. HEIC must be converted
  to a supported format. No continuous video is captured.
- The server accepts at most 4 MB of decoded image data and 16 megapixels, validates
  image bytes, rotates/resizes and re-encodes to JPEG without metadata. One analysis
  runs at a time across the installation; a busy response can be retried.
- Recognition uses the saved model, extraction prompt and request limits with a
  strict JSON schema, one image and no tools. Only printed observations become
  matching hints. The model
  cannot choose database IDs, add inventory, make network/tool calls, or grade cards.
- Catalogue matches show supporting details rather than a fabricated probability.
  Reprints and number/name collisions remain possible. Missing sets can be imported
  separately; manual catalogue search is available on the review screen.
- The same scan request ID and image return the same receipt without another
  provider call. Confirmation is also idempotent. A conflicting quantity, inventory
  revision, binder revision or occupied pocket is rejected transactionally.
- Every confirmed addition increases the requested condition's quantity. Existing
  notes and wishlist flags are preserved. The binder is a layout, not physical-copy
  allocation. Undo restores the prior quantity, removes a newly created pocket or
  restores a checklist mark changed by this scan, provided relevant ownership and
  binder revisions have not changed.
- Receipt history allows resuming after a lost connection or page reload. A scan
  is marked interrupted after its saved timeout plus 75 seconds of processing
  grace (two minutes with the default timeout). Undo remains available after
  membership loss; new analysis/additions require collection access for Pokémon.

## Budgets and later GPU comparison

Budget enforcement happens in CardShelf before dispatch, under a database lock.
Each request reserves an estimated maximum using its saved input token reservation
plus the output cap. At the initial limits and rates ($0.40 / million input
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
cost, uncertain requests, per-member and per-model volume, confirmed additions, monthly history
and average response time. The application estimate is not an invoice-level hard
cap: provider prices can change, taxes/other API clients are outside it, and an
unexpected usage can exceed a reservation. Such a valid response pauses the same
settings revision automatically; it cannot disable a newer configuration saved
while that request was running. Check the token bounds and accounting rates before
enabling it again. Malformed usage keeps the conservative reservation. The provider
invoice is authoritative. Positive rates from $0.000001 to $1,000 per million tokens
are accepted to support different models; accurate pricing is the administrator's
responsibility.

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
- [Reasoning parameters and output allowances](https://developers.openai.com/api/docs/guides/reasoning)
- [Reported output token usage](https://developers.openai.com/api/docs/guides/token-counting)
- [API data controls](https://platform.openai.com/docs/guides/your-data)

## Validation

`npm test` includes recognition contract, input, matching, image and credential
checks with synthetic data. `npm run test:integration` includes the production HTTP
routes and real PostgreSQL transactions for admission, quotas, concurrent requests,
replays, settings persistence, configuration/price snapshots during edits, longer
timeouts, automatic/manual binder placement, prepared Tracking marks, full-binder
conflicts, Undo, membership and secret redaction; recognition is
injected inside the test process and never contacts OpenAI. There are no public
mock/provider override parameters. `npm run test:scanning-ui` exercises the built
scan/admin screens in Chromium at desktop and phone sizes with synthetic API
fixtures. Live OpenAI quality, provider billing and physical mobile camera capture
require deployment acceptance with your own API key and representative cards.
