# CardShelf 0.8.0 — administrator Square connector

## Release status and scope

This is a source update candidate. It must pass the complete **Validate CardShelf**
workflow and the sandbox acceptance checks below before production use. Local logic
checks are not evidence of a real Square connection or a successful Docker upgrade.

The new **Square integration** page is at `/admin/integrations/square`. An administrator
can enter application settings, authorize the platform's Square business, verify the
connection, select an AUD location and choose an existing compatible Square subscription
variation for an unpublished CardShelf offer.

Only administrators connect the platform merchant. Marketplace sellers do not connect
payment accounts. Existing subscription checkout remains Square-hosted recurring
**invoices**. No embedded card fields, stored-card onboarding, marketplace payment
processing or automated referral transfers are introduced.

## Access and activation boundaries

- Existing non-expiring tester and complimentary access is preserved. Migration 008
  adds integration tables; it does not alter grants, memberships, inventory or listings.
- Connecting, testing and choosing a location never create a subscription or change the
  server's billing/enforcement switches. Only an explicit subscription request through
  the existing membership workflow can create a subscription.
- Keep `SQUARE_BILLING_ENABLED=false` and `MEMBERSHIP_ENFORCEMENT_ENABLED=false` during
  initial evaluation. An already-enabled server switch remains enabled: connecting valid
  credentials can make that pre-enabled configuration usable. Do not confuse an enabled
  switch with a connection test.
- Editing Sandbox or Production in the page **does not** change `SQUARE_ENVIRONMENT` on
  the server. The two credential records are separate. Existing billing, offer mapping
  and the webhook endpoint use the server's one active environment.
- This version intentionally leaves live activation and enforcement in server
  configuration. It does not expose a one-click production launch switch.

## One-time server preparation

After this update has passed CI and been merged, run from the existing server checkout:

```sh
git pull --ff-only origin main && \
  sudo sh scripts/configure-integrations.sh && \
  sudo sh scripts/upgrade.sh
```

The new key helper adds a random 32-byte `CARDSHELF_INTEGRATION_KEY` to the existing
private `.env` only if one is absent or blank. It preserves a valid existing key and
other settings. It rejects invalid/duplicate key entries rather than silently replacing
one. It does not print the key or activate billing. The application container receives
this key; the catalogue worker and migration container do not.

New installations using `scripts/configure.sh` receive a generated key automatically.
Do **not** rerun the initial configuration script over an existing `.env`.

The existing upgrade script builds, takes its local safety backup and migrates before
restarting. Keep the database volume and existing accounts. Back up `.env` separately
and securely: the PostgreSQL dump includes encrypted integration records but not the
key needed to unlock them. Losing or replacing the key makes the stored credentials
unreadable. Automatic key rotation is not implemented.

## Configure through the website

### 1. Create the Square developer application

Sign in to Square Developer Console and create/use an application dedicated to this
CardShelf deployment. Use the credentials for the environment being configured. The
**application secret** is not the personal access token.

Register the exact redirect URL shown by the CardShelf page on the Square application's
OAuth settings. For this deployment it is:

```text
https://tcg.webwire.cloud/api/admin/integrations/square/callback
```

Return to **Square integration → Application & webhook setup**. Enter the application ID
and application secret, then confirm your current CardShelf administrator password.
Leave a secret input empty to retain its saved value. Saved secrets are not returned to
the browser; values typed into the form are cleared after each operation.

Existing environment credentials remain in use until OAuth authorization succeeds.
The application ID, merchant and subscription history are checked during migration and
reconnection; an existing customer/subscription mapping cannot silently move to another
Square business. Use the original business for reconnection.

### 2. Register the webhook in Square

OAuth merchant tokens cannot administer Square's application-level webhook subscription
settings. This release uses a manual Developer Console step instead of collecting a
personal access token.

For the active environment, register the exact URL shown in the connector:

```text
https://tcg.webwire.cloud/api/billing/square/webhook
```

Select these events (where supported by the application's pinned API version):

```text
subscription.created
subscription.updated
invoice.published
invoice.updated
invoice.payment_made
invoice.refunded
invoice.scheduled_charge_failed
payment.updated
refund.created
refund.updated
dispute.created
dispute.state.updated
oauth.authorization.revoked
```

Save that webhook's signature key in the protected CardShelf form. A signing key cannot
be recovered or generated from an OAuth access token. Use the same developer application
and matching environment. Do not send inactive-environment events to the live active
handler: use a separate staging deployment to test end-to-end sandbox notifications
while production billing is in use.

A successful signed delivery for the configured merchant updates **Webhook received**.
The page does not claim webhook registration is complete merely because a key was saved.
No signature key or raw webhook contents are displayed.

### 3. Connect and verify the business

Click **Connect Square** (or reconnect), confirm your current CardShelf administrator
password and approve the authorization in Square. The return must use the same signed-in
CardShelf browser session. A declined, expired, used or unrelated authorization response
does not replace the working connection.

Click **Test connection** after returning. This checks permissions and business identity
and reads the locations list; it does not charge anyone or create a subscription. Select
an active AUD location and confirm your password to save it. Its timezone comes from
Square. After published offers or customer/subscription history exist, the location
cannot be switched through this page.

Square permissions include customer, catalogue, subscription, invoice, order and payment
scopes needed by the existing subscription service, plus dispute reading for reconciliation.
The permission list is visible in the connector. Some Square subscription operations
require write permissions even though this connector does not process marketplace payments.

### 4. Choose subscription plans

Click **Load Square plans**. Results are paginated and incompatible variations are
identified rather than silently converted. Supported variations match the existing
v0.7.0 contract: single-phase STATIC AUD pricing, monthly or annual, without trials,
discounts, finite phases, custom billing anchors or proration.

In the active environment, select a compatible variation, choose Collector or Collector
Plus, enter the tax and recurring subscription terms, then create an **unpublished**
offer. No public price, subscription or charge is created automatically.

Review the offer under **Membership administration → Subscription offers**. The existing
**Verify & publish** operation rechecks the selected Square variation. Publishing and
server activation remain separate. The connector discovers existing plans; it does not
create or edit Square catalogue variations itself.

## Token health, renewal and recovery

The app checks renewal eligibility approximately once a minute while running. Managed
OAuth tokens are renewed after seven days or when five days or less remain. A database
lock serializes renewal across instances. Provider failures retain the previous encrypted
credentials, set an actionable status and back off for 15 minutes. API operations fail
closed when valid required credentials cannot be obtained.

The status page shows the **recorded** token state, expiry, last refresh, last successful
connection check and signed webhook receipt. **Test connection** probes the provider.
No dashboard can prove a token remains valid indefinitely after its last check. This
release does not send email/push alerts for connector problems.

Keep the master key stable. Missing or unreadable credential storage does not remove
non-expiring tester/complimentary grants. Current paid access remains determined by the
existing verified paid period, not by the OAuth connection button.

Receiving a valid authorization-revoked notification clears managed access and refresh
tokens. Duplicate events are harmless; notifications dated before the most recent
connection do not erase a new authorization. Revocation does not cancel Square invoices.

## Disconnecting is not cancellation

**Disconnect locally** removes stored access/refresh tokens and suppresses fallback to
old environment access tokens. Application settings, the pinned business/location and
webhook key are retained for controlled reconnection and notification validation.

Optional **Also revoke this application's Square authorization** invokes Square's remote
revocation API. This affects all installations using the same Square application/business,
not just this server. It requires a separate affirmative choice. Failure to confirm remote
revocation does not silently erase local tokens.

Before either disconnect action, the active environment's new-subscription switch must
be off and there must be no current or pending subscriptions for that environment.
Cancel and reconcile subscriptions explicitly first. Historical invoices may still need
review in Square after cancellation. The operator can also revoke the application's
access through Square Dashboard → My Applications, independently of CardShelf.

## Security implementation

Sensitive connector changes require an authenticated administrator, same-origin browser
requests, current-password confirmation, bounded/strict JSON and an expected revision.
Read-only probes are administrator-only and rate-limited. Public users cannot select
the merchant, substitute an access token or change activation switches.

OAuth state is random, stored only as a hash, expires after ten minutes and is bound to
both the administrator and the current session. It is consumed before code exchange.
Callback redirects have a fixed local destination and do not reflect provider errors,
authorization codes or arbitrary return URLs. Avoid recording callback query strings in
external reverse-proxy access logs.

Application, access, refresh and webhook secrets are encrypted using AES-256-GCM with
random nonces and purpose/environment-specific authenticated data. Provider endpoints
are fixed, redirects are refused, responses are bounded, and transport errors do not log
or expose raw provider bodies. Stored token length is bounded for resource safety;
validity and identity are checked with Square rather than inferred from token shape.

These safeguards are implementation details, not a claim of an external security audit.
The frontend's masked fields alone are not the security boundary; authorization and
credential handling run on the server.

## Required acceptance checks

1. Run the full CI workflow, including all existing unit, type, production-build,
   migration and API/database tests. Run the new connector integration contracts in the
   disposable `_test` database only; they use injected Square responses and block real
   external Square calls.
2. On a sandbox deployment, save settings, complete/decline OAuth, retry an old callback,
   check another-session rejection and ensure no secrets appear in browser API responses.
3. Verify the business/permissions, choose an AUD location and discover at least one
   compatible and one incompatible Square variation. Confirm drafts remain unpublished.
4. Deliver actual sandbox webhooks using the matching signing key. Verify a forged
   signature and wrong merchant are rejected. Verify duplicates do not duplicate state.
5. Exercise refresh and revoked authorization with the operator's test business. Reconnect
   the same business and verify billing/tiers/tester grants were not changed.
6. Complete the v0.7.0 invoice/payment/refund/cancellation/referral sandbox acceptance
   procedure separately before any real subscription launch. The connector does not
   replace that verification.
7. Check the admin UI on desktop/mobile, browser reloads, stale revisions and error cases.
   Validate a database-plus-key restoration on a separate instance. Never restore test
   data over the live server.

## Primary provider references

- OAuth overview: https://developer.squareup.com/docs/oauth-api/overview
- Code exchange and refresh: https://developer.squareup.com/reference/square/o-auth/obtain-token
- Token management: https://developer.squareup.com/docs/oauth-api/receive-and-manage-tokens
- Token introspection: https://developer.squareup.com/reference/square/o-auth-api/retrieve-token-status
- OAuth permissions: https://developer.squareup.com/docs/oauth-api/square-permissions
- Webhook subscriptions: https://developer.squareup.com/docs/webhooks/webhook-subscriptions-api
- Catalogue listing: https://developer.squareup.com/reference/square/catalog-api/list-catalog

The connector inherits the existing application's `SQUARE_VERSION` constant. Confirm
compatibility with the Square application and its configured webhook API version during
the actual sandbox tests; this source package is not evidence of live API acceptance.
