# Security and operational scope

This is not an independent penetration-test report or a security certification.
Pure-function tests and source review are not substitutes for testing the deployed
Nuxt/PostgreSQL stack. Use the provided integration suite and acceptance checklist,
then perform further review before exposing this as a broadly public service.

## Included controls

- Bootstrap-token-gated first setup with a database lock; public free-account
  registration is separately controlled by administrators.
- Salted scrypt password hashes and opaque random session tokens stored hashed.
- HttpOnly/SameSite cookies, with Secure derived from configured HTTPS origin.
- Exact-origin and custom-header checks for browser mutations, including login/setup.
  Only the exact Stripe and Postal webhook endpoints bypass these checks; their
  provider signatures are verified separately.
- Database-backed login/setup/password attempt counters with 15-minute windows.
- Per-user ownership/binder scoping in server-side SQL; client user IDs ignored.
- Expected revisions and transactions on ownership and layout modifications.
- Read-only, random bearer share links with rotation/revocation; personal notes
  and quantities are excluded from the public DTO.
- Parameterised SQL; bounded import/request sizes; fixed-host catalogue fetches.
- Native Vue text rendering for user content; no user-supplied HTML rendering.
- Restricted application container user/filesystem/capabilities; no published DB port.

These controls are implemented in source. Release-specific validation results
describe which unit, API, browser and deployment checks were actually executed;
they are not evidence of a production audit or guaranteed mail delivery.

## Deployment obligations

Protect `.env`, backups, container/host access and your administrator password.
Use HTTPS for a remote installation. Configure `TRUST_PROXY` only behind a proxy
you control. Do not put production data into the integration-test database.
Do not expose PostgreSQL, the Docker socket or the base app HTTP port to the
internet. Keep container/OS dependencies updated through a tested release process.
The initial dedicated PostgreSQL image uses the configured bootstrap database
role; separate restricted runtime/migration roles are a future hardening step.

The current CSP permits same-origin inline bootstrap scripts/styles required by
the chosen application output; it is not a strict nonce-based CSP. Tightening
that policy should include real production-build/browser tests. The service
worker does not persist authenticated API responses or offline edits.

## Recovery and account limitations

Password recovery uses short-lived, single-use random tokens stored only as hashes,
bound to the current password hash. Public requests return a generic response and
queue delivery separately. Successful recovery revokes sessions and old reset links.
Signed-in password changes also invalidate earlier recovery links. Administrators
must confirm their password before issuing assisted recovery or changing sensitive
email settings. There is no MFA, SSO or mailbox-verification workflow in this release.
A historical database restore can revert password/account state; the restore script
explicitly deletes restored sessions.

## Email security and operation

Postal submission uses a fixed, operator-configured HTTPS origin, certificate
validation and an encrypted server-side API credential. Credentials are never
returned to the browser. Keep `CARDSHELF_INTEGRATION_KEY` with the secured deployment
backup: losing or changing it prevents decryption of saved integration credentials.
The legacy SMTP transport still requires certificate validation and TLS 1.2 or newer.

Use **More → Emails** to configure and inspect mail. Postal acceptance means that
Postal queued a message; a delivery webhook means that the receiving server accepted
it. Neither status proves inbox placement or that a person read the email. Mail
delivery can fail after acceptance, and timeouts can produce duplicate attempts.
Do not enable click/open tracking for reset messages. Treat Postal's database,
console and backups as sensitive because the mail server processes email bodies,
recipient addresses and live reset links even when CardShelf does not persist them.

Publish the actual sending-domain SPF, DKIM and DMARC records, verify alignment
using received message headers, and monitor aggregate reports before tightening
DMARC policy. DNS checks in CardShelf are diagnostics, not proof that Postal signs
correctly or that all authorized senders have been identified. SMTP transport to
recipient servers is distinct from HTTPS submission into Postal; inspect delivery
TLS evidence separately. DMARC authenticates domain use and does not encrypt mail.

The operator remains responsible for DNS, certificate renewal, reverse DNS,
outbound network access, server updates, mail reputation, backups and access review.
These controls do not establish compliance with an unspecified framework. See
[Postal setup](POSTAL_EMAIL.md) for the deployment and acceptance procedure.

Account disable/delete, forced session administration, arbitrary role changes and
fine-grained sharing policies are not yet available in the UI. Do not use this
initial implementation as an internet-scale multi-tenant service without further
engineering, abuse controls, access review and recovery tooling.

## Data and upstream services

Images load directly from the allowed TCGdex image host, so the browser contacts
that third party. Catalogue fetches originate from your server. No BinderBuilder
account credentials, source code or private APIs are used. Provider catalogue
correctness, image availability and usage permissions are not guaranteed by this
software; errors must remain visible instead of becoming invented printings.

Private data can appear in backups, ownership exports, browser memory and print
outputs. A read-only sharing link is accessible to anyone who receives it; do
not include private information in a binder title/description before sharing.
Rotating a token revokes server access but cannot delete screenshots or saved
copies on a recipient's device.
