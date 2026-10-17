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
  Only the exact Stripe webhook endpoints bypass these checks; their
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

Authenticated SMTP uses encrypted server-side passwords bound to the saved
hostname, port, TLS mode and username. Credentials are never returned to the
browser. Keep `CARDSHELF_INTEGRATION_KEY` with secured deployment backups: losing
or changing it prevents decryption. SMTP requires certificate validation and TLS
1.2 or newer. Connections pin validated public DNS addresses and reject private,
loopback and reserved destinations.

Use **More → Emails** to configure and inspect mail. Provider acceptance does not
prove inbox placement or reading. A lost submission acknowledgement is held as
Delivery uncertain instead of being automatically retried. Inspect the receiving
inbox and provider reports before requesting a fresh recovery message.

Publish the sending-domain SPF, DKIM and DMARC records supplied by the mail
provider, verify alignment using received message headers, and monitor reports.
CardShelf's DNS checks are diagnostics; they do not prove message signing or
inbox delivery. Keep replies and provider bounce handling monitored, and use
manual recipient suppressions where necessary. See [email setup](EMAIL_PROVIDERS.md)
and [old mail-resource retirement](MAIL_RETIREMENT.md).

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
