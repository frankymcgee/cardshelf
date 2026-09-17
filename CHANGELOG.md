## 0.10.0 — Stripe-only subscriptions and administrator activation

- Retire the Square connector, customer controls, endpoints and background processing.
  Historical migrations, verified paid periods and accounting records remain read-only.
- Add password-confirmed Test/Live subscription controls with separate membership
  enforcement, environment/Live acknowledgements, readiness checks and optimistic locking.
- Preserve existing tester, administrator and Complimentary access. Pausing new
  subscriptions does not cancel renewals, invalidate issued checkout links or stop reconciliation.
- Publish only enabled Live Stripe offers on the public plans page; keep sandbox offers private.
- Add activation/access/retirement regressions and retain all Stripe payment/referral tests.

# Changelog

## 0.3.0 — appearance update candidate

- Add conservative finish effects and separate ex/EX/GX/V/VMAX/VSTAR/BREAK badges.
- Display exact printing previews; do not apply a guessed finish to multi-printing designs.
- Add per-binder colours, uploaded wallpapers, opacity/fit/dim/blur controls and an appearance preview.
- Save wallpaper and settings atomically, with owner checks and stale-revision protection.
- Re-encode JPEG/PNG/WebP uploads with size/pixel limits; store one bounded image per binder in PostgreSQL.
- Apply themes to shared binders with revocable image access and optional printer-friendly backgrounds.
- Preserve reduced-motion preferences, existing pockets, collection quantities and market pricing.
- Add migration 003, appearance/image tests and API integration coverage. Full CI validation remains required.
- Add sharp 0.35.4; reconcile retained lockfiles within the Docker build, without changing the host source.

## 0.2.0

- Add cached printing prices, separate Cardmarket references, AUD conversion, recorded history and coverage-aware collection/planned-binder estimates.
- Refresh tracked cards through the existing worker; retain source timestamps and failure states.
- Generate new binders from imported sets/series with owned-only options, preview, natural ordering and automatic volume splits.
- Add request idempotency, stale-preview checks and partial-import acknowledgement.
- Add a migration, regression/integration tests and an upgrade helper with an automatic local safety backup.
- Card scanning and physical-copy allocation remain out of scope.


## 0.1.1 — 2026-09-16

Prepare the standalone source for a private `frankymcgee/cardshelf` repository
and deployment at `https://tcg.webwire.cloud`. Repository creation and remote
publication remain pending; no server or DNS changes have been made.

- Set the configuration helper and example environment to the intended HTTPS
  domain, keeping explicit local-evaluation origins supported.
- Update runtime/UI version stamps and the service-worker cache version.
- Add LF/binary Git attributes for cross-platform source checkout.
- Add configuration-script regression tests and GitHub setup instructions.
- Keep credentials generated only on the deployment server, outside source control.

The original feature scope is unchanged. See `docs/GITHUB_PREPARATION.md` for
executed checks and the remaining full-stack validation.

## 0.1.0 — 2026-09-16

Initial standalone implementation, independent of Frappe/Verto.

Introduces Nuxt/Vue client and API, PostgreSQL migrations, authenticated private
collections, condition/printing ownership, TCGdex per-set import worker,
configurable binder planning and pocket swaps, read-only sharing, portable
ownership JSON/CSV, printable placeholders/checklists, Docker Compose/Caddy
packaging and backup/restore tooling.

55 dependency-free core tests executed successfully. Full dependency resolution,
Nuxt typecheck/build, PostgreSQL/API integration, Docker startup, mobile browser
acceptance and restore rehearsal remain unexecuted in the authoring environment.
This release is a deployment candidate, not full BinderBuilder feature parity.
