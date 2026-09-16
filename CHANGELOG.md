# Changelog

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
