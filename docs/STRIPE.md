# Stripe-only subscriptions — CardShelf 0.10.0

## Scope

Stripe is the only active payment gateway for CardShelf memberships. The Square
connector, OAuth screens, payment handlers, credential renewal and background
processing are retired. Historical migrations and recorded financial data remain;
removal of integration code is not cancellation of an external subscription.

Marketplace buyers and sellers still arrange card payments between themselves.
Referral payouts remain manually completed externally and then recorded in the ledger.
This release does not add marketplace checkout, Stripe Connect, transfers or escrow.

## Deploy safely

Merge only after the full repository workflow passes and the PR has been reviewed.
From the existing server checkout on main:

```sh
git pull --ff-only origin main && sudo sh scripts/configure-integrations.sh && sudo sh scripts/upgrade.sh
```

Keep the current `.env`, `CARDSHELF_INTEGRATION_KEY`, accounts and database volume.
The key helper preserves a valid existing key; the upgrade helper takes a local safety
backup. Never regenerate the encryption key while stored credentials use it. Keep a
secured copy separately from the database backup. No new service or dependency is needed.

Migration 010 only adds the administrator controls table. Applied migrations 001–009
are unchanged, and the upgrade does not seed an enabled policy or modify tester grants.
Existing `STRIPE_*` mode/billing and membership enforcement environment flags are used
until the first control-panel save. Afterwards the saved administrative policy takes
precedence. Old `SQUARE_*` environment values are no longer passed to application code.

## Initial Stripe setup

Sign in as administrator and open **Stripe integration**. Its credential workspace
selector is separate from the active subscription environment in **Subscription controls**.

1. Choose **Test / Sandbox** in the credential workspace. Enter a restricted or secret
   TEST API key and the sandbox webhook's signing secret. Never paste keys in GitHub/chat.
2. Register an account-level snapshot-event webhook (not connected-account events)
   using API version `2025-06-30.basil` and the URL displayed in CardShelf:
   `https://tcg.webwire.cloud/api/billing/stripe/webhook/sandbox`.
3. Subscribe to `checkout.session.completed`, `checkout.session.expired`,
   `customer.subscription.created`, `customer.subscription.updated`,
   `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`,
   `invoice.updated`, `charge.refunded`, `charge.dispute.created`,
   `charge.dispute.updated`, `charge.dispute.closed`, `refund.created`, `refund.updated`.
4. Configure Stripe's customer portal. Enable payment-method updates, invoice history
   and cancellation at period end. Disable subscription plan changes. Copy the `bpc_...`
   configuration ID into CardShelf. The webhook secret begins `whsec_...`, not `rk_...`.
5. Confirm your administrator password, verify/save the connection, and test it.
6. Load active fixed recurring AUD prices. Map each to Collector or Collector Plus,
   add reviewed customer-facing recurring/cancellation/refund terms, and publish.
   Optional fixed percentage tax rates use `txr_...`; no tax is added when omitted.

If a manual draft uses the wrong tier, select **Delete draft** beside it and confirm.
In manual mode, add the same Stripe price again with the correct Collector or Collector Plus tier.
Deletion is available only for unpublished, unused manual offers; checkout and subscription
history is retained. Enabling Stripe product sync does not block deletion of manual drafts
or pausing manual offers. In managed mode, delete the incorrect manual draft, verify the
product's tier in Stripe, then follow **Open Pricing & plans → Sync now**. The link retains
the selected Test or Live environment. Manual creation and publication stay disabled.
Stripe-managed offers must be corrected through product sync; to stop new purchases,
archive the price in Stripe and sync. Existing subscriptions continue. The offer table
shows which offers are manual or Stripe-managed and explains why deletion is unavailable.
The Stripe product and price remain available. Use the matching Test or Live credential
workspace when correcting an offer.

Restricted keys need account/balance reads; product/price/tax reads; customer creation
and reads; Checkout session create/read/expiry; subscription reads/cancellation;
invoice/payment-intent/charge/refund/event reads; portal configuration reads and portal
session creation. Connection testing does not prove every later permission. Exercise
the complete flow using Test mode. No transfer or payout API permissions are requested.

## Enable subscriptions in the frontend

Use **Stripe integration → Subscription controls**:

1. Select **Test / Sandbox** and enable **Enable new subscriptions**.
2. Keep **Enforce Collector / Collector Plus access** off while testing.
3. Review and acknowledge the change, enter a reason and your administrator password,
   then save. This enables both the active policy and that connection's offer gate.
4. Use a newly created subscription-ready test account to exercise membership checkout.
   Existing invited testers and Complimentary users do not need, and cannot accidentally
   purchase, redundant subscriptions.

There is no additional `.env` billing switch to edit after saving these controls.
The separate **Allow offers for this connection** option may pause that connection;
re-enabling subscriptions in the control panel opens both gates after verification.

For Live mode, configure separate Live keys, Live portal, published Live prices and:
`https://tcg.webwire.cloud/api/billing/stripe/webhook/production`.

Live activation requires the same connection/portal/price checks plus a signed Live
webhook received within seven days and a Live event successfully reconciled using the
saved Stripe account. Check the event queue and permissions if activation fails.
Also type **ENABLE LIVE SUBSCRIPTIONS** and confirm recurring billing and any mode change.
The checks are read-only: activating availability does not create a subscriber or payment.
A collector must explicitly accept an offer and complete Stripe Checkout to subscribe.

**Access enforcement is separate.** It is permitted only in Live mode, requires an
explicit acknowledgement, and shows how many accounts lack current Live paid or manual
access. Existing administrators, legacy/beta testers and Complimentary grants take
precedence. An assigned Collector/Plus tier never starts a charge. Complimentary is
non-expiring, hidden from public plans and distinct from administrator permissions.

Accounts are still invited/created by administrators. This update does not add public
self-registration. Use the existing Add a collector workflow for free testers; use
Create a subscription-ready account only for a new intended subscriber. Duplicate
emails cannot convert an existing tester account into a billed account.

## What pausing does — and does not do

Disabling new subscriptions hides saleable offers and blocks creation of new Checkout
sessions. It does not cancel renewals, stop reconciliation, erase paid periods, or
invalidate an already-issued hosted checkout link. Cancel an individual checkout or
subscription through its explicit control to expire the session or stop future renewal.

A pause or enforcement-off save remains available during a Stripe outage; it does not
need another connection probe. Pausing with enforcement still on preserves the current
access policy. Mode changes do not migrate/cancel existing subscriptions. The worker
continues processing saved records and webhooks in both environments.

The optional server flag `STRIPE_CHECKOUT_KILL_SWITCH=true` is an emergency override for
new checkouts only. It cannot cancel Stripe renewals and does not turn paid-tier
restrictions off. Clear it server-side before enabling sign-ups from the frontend again.
It is not the normal activation workflow.

Existing environment values are defaults only before the first UI policy is saved.
Do not delete the saved policy to try to change modes or bypass the admin checks.

## Historical provider records

Original Square invoices, customers, subscriptions, commissions and payout references
remain in PostgreSQL. Already-verified paid periods remain readable until their recorded
expiry; new Square requests, live synchronisation and token renewal have been removed.
Historic commission rows are labelled read-only and cannot be newly approved/paid through
CardShelf without current provider verification. Negative historical balances still count
when validating Stripe referral payouts; retirement cannot erase a financial liability.

An unresolved historical subscription continues to block starting a second subscription.
Resolve any external subscription and its historical record through an audited operator
migration/reconciliation before moving that account. Do not delete records to bypass
this protection. Revoke old provider application credentials and remove obsolete webhook
destinations in that provider's dashboard after reviewing any real subscriptions.

The old provider setup documents are retained under `docs/history/` for audit/context,
not as current setup instructions. Stored historical credentials are unused, not exposed
by the Stripe frontend. Retiring code is not evidence that the provider stopped billing.

## Payment and referral boundaries retained

Stripe-hosted Checkout collects recurring consent and payment details; CardShelf never
stores full card numbers. Customer portal sessions are account-bound and revalidate the
supported portal configuration. Access comes from authenticated, captured invoice payment
records, not a redirect, `active` status or a manually marked-paid invoice.

Retries reuse the original Checkout request. Unconfirmed outcomes remain blocked rather
than risk another subscription. Do not blindly retry an unknown request after 23 hours:
the administrator must reconcile it because provider idempotency keys can expire.

Supported: one fixed recurring AUD monthly/annual price, quantity one, card payments,
optional fixed percentage tax, standard non-prorated periods and period-end cancellation.
Unsupported: trials, promotions/coupons, Automatic Tax, metering, multiple invoice items,
credit balances, manual/offline payments, embedded Elements, immediate plan switches or
proration. Unexpected invoices require review rather than silently granting another tier.

Approved referrers must opt in. Existing attributions keep their agreed terms. Production
verified payments alone can create payable commission, net of configured tax and refunds
but not processing fees. Sandbox money, free access, clicks and card sales do not qualify.
Payout recording never initiates a transfer. Refunds preserve previously recorded payments
and can expose negative adjustments requiring manual reconciliation.

## Acceptance before Live deployment/activation

The CI contracts simulate Stripe. Passing them is not a real Test-mode acceptance result.
Check, using test-only payment details:

- Current-password, administrator, stale-revision, mode, price and webhook safeguards.
- Saving controls takes effect without restarting; server-default flags cannot override
  a saved pause. Live offers alone appear publicly; sandbox offers remain private.
- Existing testers, administrators, Complimentary and manual grants survive enforcement;
  unpaid subscription-ready accounts cannot perform tier-protected operations.
- Checkout success/failure/authentication, return without payment, duplicate requests,
  invoice verification, out-of-order/duplicate webhooks and renewal reconciliation.
- Portal payment method/history/cancellation, refund/dispute handling and paused sign-ups
  while existing subscription management remains available.
- Two concurrent admin saves produce one success and one conflict. A connection or offer
  changed during verification cannot be activated using stale verification results.
- Mobile/desktop administration, keyboard controls, service restart and backup restoration
  with the matching encryption key. Keep enforcement off until those checks are accepted.

## Primary references

- https://docs.stripe.com/payments/checkout/build-subscriptions
- https://docs.stripe.com/billing/subscriptions/webhooks
- https://docs.stripe.com/billing/subscriptions/cancel
- https://docs.stripe.com/customer-management/integrate-customer-portal
- https://docs.stripe.com/webhooks
- https://docs.stripe.com/testing-use-cases

The integration keeps its pinned Stripe API contract. This release does not upgrade it.
