> HISTORICAL DOCUMENT: this integration was retired in 0.10.0. Do not use these instructions to configure the current release.

# CardShelf 0.7.0 — Square memberships, complimentary access and referrals

For administrator-managed OAuth setup in v0.8.0, use [Square connector setup](SQUARE_CONNECTOR.md).
The legacy environment-token method below remains supported until OAuth is connected.

## Scope and safe defaults

Square is used ONLY for CardShelf platform subscriptions. Marketplace buyers and
sellers continue to arrange card-sale payments themselves. No marketplace checkout,
escrow, transaction fee, seller payout or inventory transfer has been added.

Upgrade defaults are `SQUARE_ENVIRONMENT=sandbox`, `SQUARE_BILLING_ENABLED=false`
and `MEMBERSHIP_ENFORCEMENT_ENABLED=false`. Adding credentials alone does not start
subscriptions. No existing account is subscribed, billed, downgraded or published.
No new dependency or container is required. Migration 007 is additive; historical
migrations and non-expiring legacy/beta tester grants remain unchanged.

**This release uses Square-hosted recurring INVOICES.** It does not onboard a stored
card or silently debit a card. A member explicitly accepts an offer and requests a
subscription; Square issues invoices, and the member pays on Square's payment page.
Automatic card-on-file enrolment and a self-service stored-card portal are NOT included.
The integration is not live-verified until the operator completes the Square sandbox
acceptance procedure below with their own application and test merchant.

## Pages and administrative controls

- Account links to `/membership` and `/referrals`.
- `/membership`: effective access, published offers, complete subscription terms,
  optional disclosed referral code, invoice links, payment refresh and cancellation.
- `/admin/memberships`: people/tiers, new subscription-ready accounts, Square offer
  mapping/publication, approved referrers, commission review, external payment records
  and webhook/subscription reconciliation. Administration is role-protected server-side.
- The original `/admin/platform` retains contact requests and unpublished planning notes.
  Those notes are separate from the versioned offers actually mapped to Square.

Administrators can assign Collector, Collector Plus, Complimentary or Inherit.
Manual grants may expire; Complimentary is non-expiring and has every feature.
It is hidden from public pricing and cannot be selected at checkout. It does NOT
make its recipient an administrator. Tier edits need a reason, expected revision
and acknowledgement that Square billing is unchanged. They neither subscribe users
nor cancel existing invoices. Cancellation is an explicit separate action.

Protected tester grants take precedence over lower manual tiers and subscription
failures. Removing a complimentary override returns an account to its tester,
manual/inherited or paid entitlement, not an automatic new charge. With enforcement
off, all authenticated accounts continue to have full beta access.

The original Add a collector workflow still invites free testers. A separate,
explicit admin Create a subscription-ready account action is for NEW subscribers
without a tester grant. It never converts an existing person; duplicate emails fail
without changing their existing grant, credentials or collection. Public registration,
email verification and automatic invitation emails are not part of this update.

## Square configuration

After merge and green CI, upgrade from your existing server checkout:

```sh
git pull --ff-only origin main && sudo sh scripts/upgrade.sh
```

The existing helper builds first and takes its automatic local safety backup. Do not
regenerate `.env`, re-create users or delete Docker volumes. All new database records
are covered by the existing PostgreSQL backup; treat billing/contact records as sensitive.

Configure the following privately in the server `.env`; never commit or post secrets:

```dotenv
SQUARE_ENVIRONMENT=sandbox
SQUARE_BILLING_ENABLED=false
MEMBERSHIP_ENFORCEMENT_ENABLED=false
SQUARE_ACCESS_TOKEN=
SQUARE_LOCATION_ID=
SQUARE_MERCHANT_ID=
SQUARE_WEBHOOK_SIGNATURE_KEY=
SQUARE_WEBHOOK_URL=https://tcg.webwire.cloud/api/billing/square/webhook
SQUARE_TIMEZONE=Australia/Perth
```

Use a Square developer application and sandbox test account with an active AUD
location. Obtain credentials/merchant/location identifiers through Square's Developer
Console and authenticated API tools. `SQUARE_TIMEZONE` must match the chosen location.
The API version is pinned to `2026-09-16`. Square credentials are passed only to the
application service, not the catalogue worker or migration service.

Register the exact HTTPS webhook URL above and select:

- `subscription.created`, `subscription.updated`
- `invoice.published`, `invoice.updated`, `invoice.payment_made`, `invoice.refunded`
- `payment.updated`, `refund.updated`
- `dispute.created`, `dispute.state.updated`

The handler verifies HMAC-SHA256 over the exact configured notification URL plus
unaltered request bytes, using Square's signature header and the merchant ID.
Only that exact POST endpoint is exempt from browser-origin checks; authentication,
origin checks and body limits remain in force for every other API.

### Configure offers

Create a Square subscription plan variation for each plan/cadence. Supported offers
are single-phase, STATIC AUD, MONTHLY or ANNUAL, without trials, finite phases,
discounts, proration or custom billing anchors. Make it available at the configured
location. Collector and Collector Plus are the only sellable application plans.

In Membership administration, enter the exact variation ID, base amount in AUD,
explicit tax percentage and customer-facing recurring subscription terms. State
amount/cadence, cancellation, refund arrangements and operator contact information.
Tax decisions are operator decisions; no tax rate is guessed. Verify & publish checks
the actual variation and location before exposing it. Pausing an offer affects new
sign-ups only. Use a NEW variation for changed prices/terms; existing subscription
snapshots remain unchanged and are not silently repriced.

Set `SQUARE_BILLING_ENABLED=true` only after configuration and offer review. Keep
`MEMBERSHIP_ENFORCEMENT_ENABLED=false` during sandbox evaluation. Recreate the app
with the existing Compose configuration after editing environment values, for example:

```sh
sudo docker compose up -d --no-deps --force-recreate app
```

This does not rebuild the source or alter the database. If your deployment uses
additional Compose override files, include the same files for the recreation.

### Sandbox acceptance — required before production

Create a NEW subscription-ready test account. Existing testers/Complimentary/admin
accounts are deliberately prevented from purchasing an unnecessary subscription.
Use synthetic profile/test data. The application sends a synthetic sandbox name and
`cardshelf-test-<account-id>@example.test` rather than real profile details to Square.
Use the returned invoice link, not an assumption that sandbox email will arrive.
Only use Square test payment values, never a real card.

Verify the complete cycle with your Square test merchant: publish an offer, accept
its exact terms, create a subscription, refresh to obtain the invoice, pay the invoice
on Square, verify invoice/payment reconciliation, replay a webhook, and cancel renewals.
Also test unsuccessful payment, full/partial refund, an invoice with unexpected amount
or anchor date, a delivery retry and an unrelated merchant payment. Confirm tester
and Complimentary access remains intact throughout. Sandbox payments cannot accrue
real referral commissions. The automated tests use injected provider responses and
block external Square network calls; they do not replace this live sandbox exercise.

Square ACTIVE and charged-through dates are not used as proof of payment. Access
follows captured CARD/BANK_ACCOUNT payments on a registered subscription invoice,
matching customer/location/order/variation and the accepted amount. Cash/manual
payments, unexpected invoice structures, proration or date/price mismatches require
operator review rather than guessed access. Supported invoice due dates must match
the subscription's original monthly/annual calendar anchor. Period ends are exclusive
local-calendar dates; end-of-month/leap-year clamping retains the original anchor.

### Production and enforcement are separate decisions

After sandbox acceptance, configure your production credentials/location and webhook
signature, review and publish production offers, and enable production subscription
creation. Production subscriptions represent real obligations and require your final
customer-facing terms and refund/cancellation policy. No example price is published.

Optional `MEMBERSHIP_ENFORCEMENT_ENABLED=true` requires configured production billing.
Protected testers, Complimentary and administrators retain all features. Collector
receives tracking/generation/sharing/printing/marketplace browsing; Plus adds detailed
inventory, prices, custom binders, condition tools and selling. New paid actions are
checked on the server, not just hidden in the browser. Members can still read/export/
delete existing records and continue existing marketplace conversations after access
expires. The current collector UI remains largely visible; forbidden new actions
show an access message rather than deleting history or silently converting binders.

Disabling new subscription purchasing does NOT cancel Square subscriptions already
created. Cancellation requests stop future renewals according to Square's cancellation
date; they are not refunds and may not void open invoices. Review outstanding invoices
in Square. This update does not implement plan swaps/proration, automatic cancellation
of abandoned/unpaid subscriptions, self-service card updates or a disputes-resolution UI.

## Referral programme

The administrator approves a specific user, sets percentage (basis points internally)
or fixed AUD reward, first N billing cycles (1–120), hold days and written terms.
The user must separately opt in to that revision. Editing terms or status clears the
opt-in and prevents new attributions until accepted again. Participation is voluntary.

The partner copies a link to `/membership?ref=<code>`. The referred signed-in account
must explicitly confirm the code before its FIRST production subscription request.
No hidden tracking cookie, self-referral, reassignment, multi-level reward or automatic
signup commission is used. Existing attributions preserve a snapshot of the accepted
terms. The period is the first N calendar billing cycles of that FIRST subscription,
not a count of payments that happened to arrive. Re-subscribing does not reset it.
An unpaid first cycle does not move the reward window forward.

Commission basis is verified production subscription revenue excluding configured
tax and refunds, BEFORE Square processing fees. Fixed rewards are capped by the
original eligible base and reduced proportionally on refund. Sandbox payments, free
tester/Complimentary access, clicks, requests and marketplace card sales earn nothing.
No backdated reward is created while a partner is suspended or not opted in. Existing
earnings are still reconciled for refunds after opt-out. Hold days start when CardShelf
first verifies the payment, a conservative choice when webhooks were delayed.

Referrers see their own counts and earnings, not subscriber identity or invoice URLs.
Administrators can review the ledger and recheck an invoice against Square before
approving eligible commissions. Approval or payout recording requires fresh verification,
no dispute/refund hold and the current revision. Payouts are MANUAL: pay outside
CardShelf, then record the exact approved outstanding amount with its reference and
an explicit ALREADY PAID acknowledgement. This endpoint only writes bookkeeping.
It never sends a transfer, payout or refund instruction. No bank details are collected.

Refunds can reduce earned commission after payout without rewriting paid history.
A negative balance is a visible refund adjustment, not an automatic clawback. Known
negative balances prevent further payout recording until manually reconciled. Dispute
signals put commissions on a sticky hold; this release has no automatic release of
won disputes. Resolution/recovery is an operator task, not an automated money movement.
No bulk payouts, downloadable tax statements, affiliate identity verification or
terms-of-service legal templates are included.

## Reliability and operational review

Raw-body signature checks, event IDs, expected revisions, transaction locks and saved
request IDs protect webhook/subscription/referral retries. Subscription-creation retries
reuse the original intent; a pending creation is not automatically retried by a worker.
An ambiguous provider timeout requires retrying that original request or admin review,
not deleting the intent and creating another potentially chargeable subscription.

The application polls a durable webhook queue every 15 seconds and reconciles due
confirmed subscriptions hourly. Only configured provider connections run the poller;
new billing can remain off while existing subscriptions are reconciled/cancelled.
Queue retries are bounded; administrator retry controls and last errors remain visible.
Unmapped or unrelated merchant events never create subscriptions or commissions, but
can remain failed for review. Dispute events received before invoice mapping are
retained and checked when the invoice is mapped later. Reconciliation inspects recent
invoices plus any older invoice referenced by an event; this is not an unlimited
historical backfill and prolonged webhook outages require operator review.

UI and APIs share the same session/owner checks. Billing logs never print access tokens,
raw card data or full webhook bodies. Admin tier actions and approvals are audited.
Financial histories use restricted deletion to avoid silently losing ledger evidence;
account erasure/retention must be reviewed separately by the operator.

## Validation

New pure tests exercise signatures, config/defaults, calendar anchors, invoice amounts,
tester/Complimentary preservation, exact tiers, referral calculations and price redaction.
New API/PostgreSQL tests cover admin isolation, subscription-ready account creation,
provider identity, explicit consent, saved retries, paid/unpaid states, refunds, dispute
signals, referral snapshots, bookkeeping idempotency and a separate compiled app with
enforcement enabled. Mocked Square transport is injected in test calls only. Full
repository CI, production build and all old suites must pass before merge. Actual
Square Sandbox acceptance and browser/device verification remain separate requirements.

Primary references (reviewed during implementation):
- https://developer.squareup.com/reference/square/subscriptions-api/create-subscription
- https://developer.squareup.com/docs/subscriptions-api/manage-subscriptions
- https://developer.squareup.com/docs/subscriptions-api/subscription-billing
- https://developer.squareup.com/docs/invoices-api/walkthrough
- https://developer.squareup.com/docs/webhooks/step3validate
- https://developer.squareup.com/docs/devtools/sandbox/overview
