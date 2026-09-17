# Stripe subscriptions alongside Square — CardShelf 0.9.0

## Scope and release boundary

Stripe is an additional payment gateway for CardShelf memberships. It does not replace
Square or migrate existing subscribers. Card-sale payments remain between collectors.
No checkout for marketplace cards, escrow, seller payouts, Stripe Connect onboarding,
referral transfers or automatic movement of funds between users is implemented.

This release uses **Stripe-hosted Checkout** for new recurring card subscriptions and
the **Stripe customer portal** for payment methods, invoices and end-of-period cancellation.
Unlike the existing Square invoice flow, this Stripe flow collects explicit consent for
automatic recurring charges at checkout. Full card numbers never enter CardShelf APIs.

The source is a deployment candidate until its full GitHub Actions workflow and the
operator's actual Stripe Test-mode acceptance checks have passed. Automated fixtures
are not evidence of a successful connection or payment against a real Stripe account.

## Safe defaults and protected access

- `STRIPE_ENVIRONMENT=sandbox`, `STRIPE_BILLING_ENABLED=false`.
- Existing `SQUARE_*` configuration and subscription records are retained.
- `MEMBERSHIP_ENFORCEMENT_ENABLED` is not changed by this update or by connecting Stripe.
- Existing legacy/beta tester grants and hidden Complimentary assignments retain priority.
  Those users cannot initiate a paid Stripe or Square subscription accidentally.
- The administrator assigns Collector, Collector Plus or Complimentary as before. Granting
  a tier does not create charges; granting Complimentary does not cancel an existing subscription.
- Production enforcement can be configured with production Stripe alone, production Square,
  or both. Enabling enforcement is separate from testing providers. Stored verified paid
  access and tester grants do not depend on successful credential decryption on every request.

Both gateways take the same per-account database lock before reserving a new request.
An existing or unresolved production subscription, or a remaining paid period, prevents a
second request through the other provider. Test and production accounts remain separate.
Do not move a member between providers by deleting their billing records. Cancel renewal,
reconcile the original provider, and wait until the paid period ends before switching.

## Deployment

After the PR has passed all workflow checks and been merged, run from the existing server checkout:

```sh
git pull --ff-only origin main && sudo sh scripts/configure-integrations.sh && sudo sh scripts/upgrade.sh
```

The integration-key script is idempotent. Do not replace a working
`CARDSHELF_INTEGRATION_KEY`; keep it securely backed up separately from the database.
Migration 009 adds Stripe tables and extends the shared commission ledger with provider-
specific invoice foreign keys. Original Square commissions retain provider `square`.
Existing payout references, users, binders and collections are not replaced.
The normal PostgreSQL backup includes the new records and encrypted credentials.

No new container, runtime dependency or public publishable key is required. The app service
receives the Stripe mode/switch and the existing integration encryption key. Catalogue-worker
and migration containers do not receive payment credentials. Do not post keys in chat or GitHub.

## Administrator setup

1. Open **Stripe integration** from the administrator sidebar or Membership administration.
2. Choose **Test / Sandbox**. This selects which stored connection you edit, not the server's
   active mode. Enter a Stripe Test secret or restricted key. Restricted keys must allow the
   operations below; incorrect permissions are reported, never silently bypassed.
3. Create a snapshot-event webhook destination in Stripe Workbench for **your account**,
   not connected accounts. Use the exact Test endpoint displayed by CardShelf:
   `https://tcg.webwire.cloud/api/billing/stripe/webhook/sandbox`.
   Use API version `2025-06-30.basil` and these events:
   - `checkout.session.completed`, `checkout.session.expired`
   - `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`
   - `invoice.paid`, `invoice.payment_failed`, `invoice.updated`
   - `charge.refunded`, `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed`
   - `refund.created`, `refund.updated`
4. Enter that endpoint's `whsec_...` signing secret in CardShelf. The API key and signing
   secret are encrypted with AES-256-GCM, scoped to provider, environment and field.
   They are never returned to the frontend after saving. Blank replacement fields retain
   existing values. Saving requires the administrator's current password and revision.
5. Configure Stripe's customer portal: enable payment-method updates, invoice history and
   cancellation **at period end**. Disable subscription updates/plan switching. Enter its
   `bpc_...` configuration ID. CardShelf validates it when saving and before every portal session.
6. Verify and save, then Test connection. These operations read account data; they do not
   create customers, subscriptions, charges or transfers. The key's account and mode are verified.
   Key rotation is supported for the same Stripe business; silent remapping to another business
   is rejected. Revoke compromised keys in Stripe, then save replacements here.
7. Create fixed recurring AUD prices in Stripe, with monthly or annual cadence. Load prices
   in CardShelf, map each to Collector or Collector Plus, and add reviewed subscription terms.
   Optional fixed tax rates can be specified using a Stripe `txr_...` ID. No tax is added if
   none is configured. Verify the total and included tax shown on the draft before publishing.
8. Publish only reviewed offers. Publication does not enable checkout. When ready for Test
   mode, set `STRIPE_BILLING_ENABLED=true` in the server `.env`, keep
   `STRIPE_ENVIRONMENT=sandbox` and `MEMBERSHIP_ENFORCEMENT_ENABLED=false`, and recreate
   the app container using the existing upgrade helper. In the frontend enable **Accept new
   Stripe checkouts**. Pausing that setting stops new checkouts, not existing renewals.

Required API families: account and balance reads; product/price/tax-rate reads; customer
creation/reads; Checkout session creation/reads/expiry; subscription reads and cancellation
updates; invoice/payment-intent/charge/refund/event reads; portal configuration reads and
portal session creation. CardShelf does not request transfer or payout operations. A limited
Test connection check cannot prove every possible future API permission; the full acceptance
workflow is required with restricted keys.

Live setup uses separate Live keys, portal configuration, prices and webhook signing secret:
`https://tcg.webwire.cloud/api/billing/stripe/webhook/production`.
Stripe key mode is verified by an authenticated balance read; the original business account
remains pinned even when keys are rotated. Do not reuse a Test webhook secret for Live mode.

## Member workflow and payment confirmation

In **Account → Manage membership**, members can choose an available Stripe offer, review
its recurring amount, terms and optional disclosed referral, then continue to Stripe.
CardShelf creates a server-selected fixed-price session. A client cannot supply the payable
amount, customer ID, account, redirect URL, tier entitlement or referral reward amount.
The return URL only returns to the membership page; it is not proof of payment.

Signed webhooks are persisted quickly and reconciled in the app background loop. Raw-body
HMAC verification includes Stripe's timestamp with a five-minute tolerance. Duplicate events
are ignored, and provider objects are re-read with the saved account's API key to handle stale
or out-of-order notifications. No raw card/customer payloads are retained in the event queue.
The loop also checks tracked subscriptions periodically. Manual **Refresh status** and admin
**Reconcile** actions are available. Queue failures are visible and retryable by administrators.

Only verified captured card payments for an expected invoice extend access. Invoice amounts,
customer, subscription, price, currency and original billing period must match. `active`, a
checkout-success redirect, a sent invoice or an invoice manually marked paid is not sufficient.
The paid period ends at its actual Stripe UTC timestamp, not the browser's local midnight.

Cancelled renewal keeps already-paid access until its end. A full refund removes the refunded
period from paid entitlement; partial refunds reduce commissions without proportionally
shortening the paid period. Disputed or pending-refund invoices are held. A lost connection
retains already-verified dates rather than manufacturing a fresh paid period.

## Referrals and manual payouts

The existing approved, opt-in programme applies to **verified production Stripe payments**
as well as Square. The shared ledger identifies the original provider. Rate/type, first
billing cycles, hold period and accepted terms use the existing administrator configuration.
Tax and refunds are excluded; payment processing fees are not deducted. Test-mode payments,
free access and marketplace card sales never generate payable rewards.

The first production subscription request across BOTH providers determines eligibility.
Switching providers or creating a second subscription does not restart the reward allowance.
The requirement to claim before the first production request is deliberate: an abandoned first
request may need programme review, not automatic new attribution.

Approval/reconciliation calls the invoice's original provider. A recorded external payment
never initiates a transfer. Refunds after payout reduce earned value while preserving recorded
payments, exposing a negative balance for manual reconciliation. Subscriber email/name and
payment links are not shown to referrers. Administrators review the shared ledger as before.

## Retry and failure boundaries

Checkout intent is committed before provider writes. Repeated requests use the same account-
bound idempotency key. Unknown outcomes remain reserved instead of permitting another charge.
For a known session use Refresh, Resume checkout or Cancel checkout. The cancellation return
URL alone does not expire a still-open session. A completed session is managed as a subscription.
If the session ID was lost but its customer was saved, reconciliation searches that customer's
bounded session history for the exact request identity.

**Do not blindly retry an unknown request after 23 hours.** Stripe can prune idempotency keys
after 24 hours. CardShelf blocks that retry and new subscriptions until the operator checks the
Stripe dashboard and reconciles the original record. Unknown customer creation without a saved
customer ID may require operator investigation; no destructive reset button is provided.

Supported: one fixed recurring AUD price, quantity one, optional fixed percentage tax,
card payments, standard monthly/yearly non-prorated periods, hosted Checkout, cancellations.
Not supported: trials, promo codes, coupons, Automatic Tax, metering, multiple invoice items,
customer credit balances, manual/offline payments, arbitrary subscription edits, immediate
plan changes/proration or embedded Elements. Unexpected invoices are flagged for review and do
not silently grant a different plan. Dispute resolution may require operator review; do not
assume a closed dispute instantly releases a previously blocked commission.

## Required acceptance checks before Live

Use a newly created **subscription-ready TEST account**, not an existing protected tester.
Keep production billing and enforcement off while checking the following in Test mode:

1. Connection save, current-password rejection, key rotation for the same account, wrong-mode
   rejection, secret redaction and a valid signed webhook arriving at the displayed endpoint.
2. Collector and Plus checkout; explicit recurring consent; cancellation before payment;
   return without payment; failed card; authentication-required card; successful payment.
3. A paid invoice grants the exact plan/period only after reconciliation. Retried checkout
   and duplicate/out-of-order events do not create another customer/subscription/reward.
4. Existing Square subscribers cannot start Stripe subscriptions, and vice versa. Existing
   testers/complimentary users retain access and are not required or able to buy redundant access.
5. Portal payment-method update, invoice display, end-period cancellation, renewal failure,
   successful renewal (Stripe test clocks may require dedicated test setup), partial/full refunds.
6. Referrer approval, opt-in and attribution. Test payments must create **no payable rewards**.
   Use contract fixtures for production accounting logic; do not create live charges just to
   produce referral test data. Reconcile any controlled live acceptance separately before launch.
7. Admin queue diagnostics and retries, service restart, database restore with its matching
   integration key, mobile browsers, keyboard interaction and member privacy.

## Primary API references used

- https://docs.stripe.com/payments/checkout/build-subscriptions
- https://docs.stripe.com/customer-management/integrate-customer-portal
- https://docs.stripe.com/webhooks
- https://docs.stripe.com/api/idempotent_requests
- https://docs.stripe.com/api/invoices/object?api-version=2025-06-30.basil
- https://docs.stripe.com/api/invoice-payment/object?api-version=2025-06-30.basil
- https://docs.stripe.com/api/invoice-line-item/object?api-version=2025-06-30.basil

Stripe API version is intentionally pinned, not guessed from an SDK's newest default.
