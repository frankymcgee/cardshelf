# Security and operational scope

This is not an independent penetration-test report or a security certification.
Pure-function tests and source review are not substitutes for testing the deployed
Nuxt/PostgreSQL stack. Use the provided integration suite and acceptance checklist,
then perform further review before exposing this as a broadly public service.

## Included controls

- Bootstrap-token-gated first setup with a database lock; no public registration.
- Salted scrypt password hashes and opaque random session tokens stored hashed.
- HttpOnly/SameSite cookies, with Secure derived from configured HTTPS origin.
- Exact-origin and custom-header checks for mutations, including login/setup.
- Database-backed login/setup/password attempt counters with 15-minute windows.
- Per-user ownership/binder scoping in server-side SQL; client user IDs ignored.
- Expected revisions and transactions on ownership and layout modifications.
- Read-only, random bearer share links with rotation/revocation; personal notes
  and quantities are excluded from the public DTO.
- Parameterised SQL; bounded import/request sizes; fixed-host catalogue fetches.
- Native Vue text rendering for user content; no user-supplied HTML rendering.
- Restricted application container user/filesystem/capabilities; no published DB port.

These controls are implemented in source. API and database-level tests are
included but were not executed in the authoring environment.

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

There is no MFA, SSO, email verification, invitation delivery or email-based
password reset in this version. Administrators create accounts directly. User
password changes revoke other sessions. A historical database restore can revert
password/account state; the restore script explicitly deletes restored sessions.

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
