## 0.21.0 — Arena UI refresh, Phase 1

- Introduce an opposite-table shell with the opponent above the player, Active Pokémon facing the centre, five Bench positions and clearly labelled deck, discard and Prize zones.
- Move the existing shared Stadium to the battlefield centre. Keep the original card inspector, server-provided moves, private views, tutorial hooks and Core/Expanded match compatibility.
- Add subtle table depth, public-count opponent hand backs, compact narrow-screen pile shelves, keyboard-accessible hand scrolling and reduced-motion styling.
- Add layout and Vue-render regressions plus a separate Chromium/WebKit component workflow with responsive checks and screenshot artifacts. Retain every existing full-stack CI gate.
- Synchronise release stamps. No database migration, rules-engine change, new card mechanics or production configuration changes are required. See docs/ARENA_UI_REFRESH.md for scope and validation boundaries.

## 0.20.5 — Japanese catalogue release validation

- Synchronise the installer, example environment, Compose image default, workspace version labels and README with the package release version.
- Add release-consistency regressions covering every coordinated deployment/UI stamp and the latest changelog entry, so partial version bumps fail explicitly.
- Retain the Japanese catalogue ID fix and all existing CI gates. Existing installation settings, credentials and database records are unchanged.

## 0.20.4 — Japanese Pokémon catalogue IDs

- Accept TCGdex's literal-plus Japanese set and card IDs so loading the set index does not fail on expansions such as SM1+.
- Encode validated provider path segments once and keep imported Pokémon identities compatible with card lookup and game access; retain strict handling for other games and unsafe URLs.
- Add deterministic Japanese/English catalogue, request-encoding and input-safety regressions. No database migration is required.

## 0.20.3 — Correct Postal web health check

- Send Postal's configured web hostname in the local web health probe so Rails host authorization does not reject a running server with HTTP 403.
- Retain HTTP failure detection and local probing without following the login redirect; expose curl errors in Docker's health log.
- Add a regression exercising the deployed curl command against host authorization, login redirects and server errors, and document how to recreate the web container after updating.

## 0.20.2 — Preserve queue fixture timestamp precision

- Restore integration-test queue schedules through a text parameter so the
  PostgreSQL driver preserves all six fractional timestamp digits.
- Seed a notification with explicit microsecond precision to cover the native
  PostgreSQL cleanup failure in local email integration tests as well.

## 0.20.1 — Postal integration test isolation

- Isolate the email integration suite from notifications queued by earlier tests,
  restoring existing queue schedules during cleanup.
- Add a regression with an older unrelated notification so the administrator
  delivery test also exercises a shared database with pending email.
- Keep the production queue behavior and all CI validation gates unchanged.

## 0.20.0 — Postal email administration

- Add **More → Emails** for Postal settings, password-confirmed credential changes,
  sender identity, DNS diagnostics, administrator delivery tests, recent delivery
  history, safe notification retries and recipient suppression management.
- Encrypt Postal API credentials with the existing server integration key. Submit
  text email over HTTPS to the deployment-configured Postal host; retain legacy
  TLS SMTP only until Postal settings are first saved.
- Add a durable notification outbox and per-user preferences. Notify opted-in
  members about marketplace enquiries/replies and administrator membership changes;
  send security notices for signed-in password changes. Preserve the secure
  password-reset workflow and its generic public response.
- Verify Postal delivery callbacks against a configured RSA public key, reject
  invalid signatures, deduplicate events and correlate delivery/bounce metadata
  with known messages. Never store raw callback bodies or private message content
  in notification records.
- Add the optional Postal Docker deployment, domain-authentication instructions,
  certificate handling and backup guidance for `cardshelf.cloud`. Installation
  defaults use `cardshelf.cloud`; existing `.env` values are preserved.
- Add migration `018_postal_email.sql`. No existing accounts, collections, Arena
  matches or billing records are rewritten. Email starts disabled and optional
  notification preferences start off.

## 0.19.0 — Arena expansion

- Add versioned expanded rules for supported EX/ex, Mega Evolution, Abilities,
  Pokémon Tools, Stadiums, ACE SPEC restrictions and multi-step Trainers.
- Preserve the original Core compiler, engine and CPU decisions for saved matches
  and waiting lobbies; new games use `pokemon-expanded-v2`.
- Use saved catalogue cards for Matched, Mirror and chosen computer opponent decks,
  with disclosed mirror fallback and isolated snapshots.
- Expose shared Stadiums, attachments, card classes, effective HP/retreat and
  ability controls on the table while preserving private hands and prompts.
- Add focused mechanics, legacy compatibility, CPU, opponent selection and
  integration regressions. See `docs/ARENA_EXPANSION.md` for the tested boundary.

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
