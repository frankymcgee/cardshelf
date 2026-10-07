# Stripe-managed products — CardShelf 0.11.0

This update targets CardShelf 0.10.0 at commit
`bf4c380c52928025b7e5eee7630bf52337b96a98`.

## What changes

Stripe becomes the source for new membership offers and their customer-facing content
when the administrator explicitly opts in. Manage product names, descriptions, uploaded
images, unit labels, marketing feature lists, monthly/yearly prices and tax configuration
in Stripe. CardShelf reads those settings on a manual sync or an optional daily sync.

The patch does not activate billing, enable access enforcement, change user roles or
remove tester/Complimentary grants. It never edits a Stripe product, price, tax setting
or existing subscription. Marketplace payments and referral payouts remain external.

A successful sync publishes compatible offers for **new** subscriptions. Existing
subscriptions keep the price and terms snapshot that was accepted when they started.
Changing a marketing feature is not an entitlement change: Collector and Collector Plus
continue to use CardShelf's defined capabilities. Marketing copy must describe those
capabilities accurately.

## One initial setup in CardShelf

Open **Platform administration → Stripe product catalogue**. Connect Stripe first through
the existing Stripe integration screen; existing keys and portal settings are reused.

1. Select **Test / Sandbox** to evaluate the workflow. Test and Live workspaces are separate.
2. Enable **Manage products and new offers in Stripe**. Confirm the administrator password
   and the acknowledgement shown on screen.
3. Choose whether to enable the automatic 24-hour sync. Manual **Sync now** remains available.
4. For the Live workspace only, optionally enable the platform-plan mirror. This makes the
   Collector and Collector Plus plan records read-only and updates them from Stripe.
5. Select **Save settings & sync**. Read the result and any warnings before enabling sales.

This is an opt-in because taking over the catalogue can replace previously published
manual offers. While Stripe-managed mode is on, manual offer creation and publication
are disabled. Existing manual offers can still be paused, and unused manual drafts can
be deleted in **Stripe integration**. This allows an accidentally mapped price to be
removed before **Sync now** imports it under the correct Stripe product's tier, without
turning off product sync. Offers with any checkout or subscription history are retained.
Stripe-managed rows must be maintained in Stripe and synced; it is not necessary to
manually publish every individual price again in CardShelf.

After setup, normal product maintenance is done in Stripe. The CardShelf screen is needed
only for an immediate manual refresh, sync health, or changing these initial preferences.
Subscription activation still has its own password-confirmed **Subscription controls**.
A catalogue sync is not an instruction to activate subscriptions.

## Identify the two products

Products named **Collector** and **Collector Plus** are recognised automatically on first
sync (case-insensitive, ignoring surrounding spaces). Use metadata on the Stripe product
for other display names:

| Stripe product metadata key | Value / purpose |
| --- | --- |
| `cardshelf_plan` | `collector` or `plus`; `ignore` explicitly excludes an unrelated product. |
| `cardshelf_monthly_price` | Optional `price_…` ID when several eligible monthly prices exist. |
| `cardshelf_annual_price` | Optional `price_…` ID when several eligible yearly prices exist. |
| `cardshelf_tax_mode` | `automatic` (default), `fixed`, or explicit `none`. |
| `cardshelf_tax_rate` | An active `txr_…` ID, required only for `fixed`. |
| `cardshelf_terms` | Optional extra cancellation/refund/operator information appended to the generated recurring terms. |

Renaming a linked product keeps its existing mapping. A linked product cannot silently
change from Collector to Plus through metadata; create a new product instead. The full
history of synced offer mappings is considered, not just the currently displayed product.
Administrator, testing and Complimentary tiers cannot be created by Stripe metadata.

Only one product per tier is selected. Two active products mapped to the same tier produce
a clear error rather than publishing an arbitrary product. Mark unrelated products with
`cardshelf_plan=ignore` or archive products that should no longer be offered.

## Monthly and yearly prices

Create both recurring prices **under the same Stripe product**. Supported prices are fixed
AUD amounts, quantity one, monthly or yearly, with interval count one and no usage tiers,
quantity transforms or trials. A single supported price in each cadence is selected.

For example, a Collector product with **AUD 20.00/month**, **AUD 225.00/year** and an archived
old price produces one product card with monthly and yearly choices. The archived price is
not offered. The yearly card can show the AUD 15 saving against twelve comparable monthly
payments. This is a comparison of the configured display prices, not a personalised tax quote.

When several active prices have the same cadence, CardShelf uses a matching default price
or the explicit metadata ID above. Without an unambiguous choice, the entire sync fails
and preserves the previous catalogue. It does not guess the cheapest or newest price.

Create a new Stripe price and archive the previous price to change the offer for future
customers. Existing paid subscribers are not moved to that new price by CardShelf. Archiving
a price or product stops new purchases after sync; it does not cancel existing renewals.
New checkout also rechecks the selected product/price rather than trusting browser amounts.

## Description, image, unit label and marketing features

The public pricing page and authenticated membership choices use:

- Product `name` and `description`.
- The first supported product image, with a no-image fallback on the pricing/member views.
- `unit_label` next to the recurring price, such as “per member”. This is a label, not
  a new seat-management system; checkout quantity remains one.
- `marketing_features` in Stripe's order. Clearing the list removes those displayed
  features; CardShelf does not invent replacement features for a synced product.

Up to eight valid image references and fifteen marketing features are retained. For this
release, upload product images through Stripe: the browser image allowlist is restricted
to `files.stripe.com` and `stripe-camo.global.ssl.fastly.net`. Arbitrary external image hosts,
inline data, HTTP URLs, credentials in URLs and non-standard ports are not rendered. No
server-side image proxy or arbitrary network fetch is introduced. Description/feature text
is escaped by Vue, not rendered as HTML. Product metadata and API credentials are excluded
from the customer-facing presentation snapshot.

The public table keeps the existing sales gate: only published **Live** offers are shown
as purchasable when Live subscriptions are enabled. Test offers never appear publicly.
When new subscriptions are paused, the public page retains its pre-launch/testing view;
the synced catalogue is still visible privately in Platform administration.

## Tax is managed in Stripe

### Automatic Stripe Tax (default)

Complete Stripe Tax setup in the selected environment, including the business address,
appropriate tax registrations, product tax code or default tax code, and price tax behaviour.
CardShelf checks that Stripe Tax settings are active and then requests automatic tax on
hosted Checkout. The billing address is collected and saved by Stripe for this flow.

An inclusive price is displayed as including applicable tax; an exclusive price is labelled
“plus applicable tax calculated by Stripe at checkout”. Stripe confirms the actual tax and
total before payment. The local catalogue's automatic-tax amount is the configured display
price, not a hard-coded GST/VAT amount or a claim that tax is always zero.

Actual invoice verification checks the agreed base price, tax calculation status, inclusive/
exclusive behaviour, tax breakdown, customer, card payment, subscription and paid period.
Refund/referral calculations use the verified tax amount, not the catalogue placeholder.
Existing fixed-tax subscription snapshots continue to use their previous verification rules.

A tax code identifies the product's tax category; it is not a fixed percentage assignment.
CardShelf does not create tax registrations or decide where your business must collect tax.
Configure those obligations with your tax adviser and in Stripe. Stripe Tax may have its own
provider charges; check your Stripe arrangement before activation.

### Explicit fixed rate

To use a fixed Stripe Tax Rate instead of automatic calculations, set product metadata:

```text
cardshelf_tax_mode = fixed
cardshelf_tax_rate = txr_YOUR_RATE_ID
```

The rate must belong to the same environment, be active, and use a supported fixed percentage
(up to two decimal places). Its inclusive/exclusive treatment must agree with the price.
The price page displays the calculated configured total. A later sync applies rate/offer
changes to new subscriptions only.

### Explicit no-tax collection

To deliberately collect no tax on a product, set:

```text
cardshelf_tax_mode = none
```

Remove `cardshelf_tax_rate` in automatic or none mode. Missing Tax permissions, incomplete
Tax setup or ambiguous metadata **never** silently become a no-tax offer. Use `none` only
when it is the intended collection policy, not to hide a tax configuration error.

## Restricted API key permissions

Keep the existing subscription/Checkout/portal/invoice/webhook permissions documented in
`docs/STRIPE.md`. Add or confirm **read** access to Products and Prices. Automatic-tax sync
also requires **read** access to Stripe Tax Settings (`GET /v1/tax/settings`); fixed-rate
sync requires Tax Rates reads. Account and Balance reads verify the saved business and mode.

The new Products and Tax Settings API paths are GET-only in CardShelf's provider client.
The sync itself makes no POSTs to Stripe and never needs product-write, payout or transfer
permissions. No new webhook event subscriptions are required for daily/manual product sync.
The pinned Stripe API version stays **2025-06-30.basil**.

## Scheduling, failures and concurrency

After a successful sync, the next automatic run is due 24 hours later. The existing app
container checks due work every minute; no additional cron service or container is required.
On restart, overdue enabled jobs become eligible again. The schedule is an interval after
success, not a fixed local-midnight task.

Only an opted-in environment is scanned. A database lock prevents overlapping manual,
scheduled and multi-process jobs from publishing twice. The interface can report that a
sync is already running. Source-selection edits and legacy manual publication use compatible
locks. Sync does not block or rewrite existing subscription payment reconciliation.

All provider pages are fetched and validated before local offers change. Publication, product
snapshots, optional plan mirroring and success state are one database transaction. A partial
read, wrong-mode response, ambiguous price, credential problem or failed transaction retains
the last complete catalogue and records an error. Scheduled failures retry after approximately
one hour. Ordinary successful jobs retain the 24-hour interval. Provider/page/time limits
fail explicitly rather than silently truncating the catalogue.

An actual complete empty catalogue retires all new synced offers without deleting users,
existing subscription records, paid history or grants. A product with no supported prices
is retained as a non-purchasable product with a warning. Product names alone are not proof of
payment. Existing uncertain checkout requests remain reserved: a later product edit cannot
be used to release a request that might already have reached Stripe.

Disabling sync leaves the last offers in place; it does not stop subscription purchasing.
Use **Subscription controls** to pause new subscriptions. Pausing new subscriptions does
not cancel existing renewals or invalidate an already-issued hosted checkout link.

## Apply, validate and deploy

From a clean CardShelf checkout, save the supplied patch in the parent directory:

```sh
git switch main
git pull --ff-only origin main
git switch -c feature/stripe-product-sync
git apply --check --index ../cardshelf-0.11.0-stripe-products.patch
```

Stop on any failed check; do not force or partially apply it. After the check succeeds:

```sh
git apply --index ../cardshelf-0.11.0-stripe-products.patch
git diff --cached --check
git commit -m "feat: Stripe-managed products, daily sync and pricing content (v0.11.0)"
git push -u origin feature/stripe-product-sync
```

Open a PR to `main`. Require the complete **Validate CardShelf** workflow before merging:
unit tests, Nuxt typecheck/build, migrations 001–011, startup and API/PostgreSQL integration.
The supplied integration tests use injected provider responses and must only run against a
throwaway database ending in `_test` with `ALLOW_TEST_DATABASE=yes`.

After green CI and merge, run on the existing Ubuntu server checkout:

```sh
git pull --ff-only origin main && sudo sh scripts/upgrade.sh
```

Retain `.env`, the database volume, existing accounts and `CARDSHELF_INTEGRATION_KEY`.
Migration 011 is additive. Previously applied migrations are not edited. No new dependency,
container or key is introduced. The existing upgrade helper takes its local safety backup.

## Actual Stripe Test-mode acceptance before Live

Check with a separate subscription-ready account, not a protected tester:

1. Sync the example monthly/yearly product; inspect description, uploaded image, unit label
   and features in the private Test preview. Confirm Test data never appears publicly.
2. Change those fields in Stripe and manually sync; clearing a field should clear the copy.
   Archive and replace a price. Confirm an ambiguity produces an error, not guessed pricing.
3. Test both inclusive/exclusive automatic tax with valid addresses, or the deliberate fixed/
   none policy you use. Confirm the final Checkout total, invoice tax and paid access agree.
4. Test hosted checkout, card authentication/failure, return without payment, renewal and
   cancellation, partial/full refund, and signed webhooks. Confirm referrals exclude tax and
   sandbox payments cannot create payable rewards. Do not generate live charges merely to
   manufacture referral test data.
5. Check mobile/keyboard layout, an unavailable product image, reload/restart persistence,
   scheduled due-run behaviour, restored database/key pairing and unchanged tester grants.

The accompanying validation report distinguishes tests run locally from full CI and real
Stripe acceptance. A source patch is not evidence that live payments or tax calculations
have been exercised against your merchant account.

## Primary provider references

- Product fields: https://docs.stripe.com/api/products/object?api-version=2025-06-30.basil
- Price objects: https://docs.stripe.com/api/prices/object?api-version=2025-06-30.basil
- Tax settings: https://docs.stripe.com/api/tax/settings/object
- Tax codes and price behaviour: https://docs.stripe.com/tax/products-prices-tax-codes-tax-behavior
- Hosted Checkout tax: https://docs.stripe.com/payments/checkout/taxes
- Invoice/tax breakdown: https://docs.stripe.com/api/invoices/object?api-version=2025-06-30.basil
