## 0.29.0 — Arena lobby and deck workshop

- Give the lobby illustrated deck covers, a prominent return to an open table, clearer play modes, and separate open/past match lists.
- Rebuild the deck workshop with catalogue-wide support filtering, category/type/set/stage filters, composition, mobile tabs and accessible card inspection.
- Review pasted lists and CardShelf JSON exports before applying them to a draft. Report missing, ambiguous and unsupported cards; require explicit replacement of an existing draft.
- Duplicate a saved deck into a separate unsaved draft. Preserve private deck ownership, revision checks, creation retries and physical collection records.
- Keep unavailable saved cards visible for removal, block them from match entry, and protect unsaved edits when leaving the workshop.

## 0.28.0 — Arena on the public website

- Introduce a public Pokémon Arena page with product screenshots, play modes, interface highlights and answers to common questions.
- Feature the new Arena on the homepage, platform page, navigation, plans page and shared calls to action.
- Explain Arena membership requirements separately from free catalogue browsing and invited collection access.
- Add responsive screenshot assets, a social sharing image and the public Arena page to the sitemap while keeping playable matches private.

## 0.27.0 — Arena illustrated tabletop

- Add locally served room, walnut, woven playmat and blue card-back artwork to the first-person Arena.
- Illustrate the original Ember/Tide teaching cards without changing their rules; catalogue cards retain their own image URLs.
- Enlarge the hand, texture the card stacks, compact the match chrome and move the turn controls into the foreground action dock.
- Preserve hidden-card privacy, explicit action confirmation, projected drop targets, responsive layouts and reduced-motion/forced-colour alternatives.


## 0.26.1 — Mobile tabletop drag spacing

- Keep the near Bench comfortably outside the auto-scroll edge when the touch drag handle is centred.
- Strengthen the existing touch regression to require an interior drop point.
## 0.26.0 — First-person Arena tabletop

- A perspective playmat with a distant opponent field, a larger foreground hand, wood-edged table depth, and separate face-down Prize and deck stacks.
- A flat hand/action dock with full-width table space, public discard-top artwork and the existing Inspect dialog for card details.
- Container-aware narrow-screen layouts and a flat reduced-motion view retain readable cards, touch scrolling, keyboard access and legal-target confirmation.
- Existing game rules, saved matches, privacy checks, action requests and confirmed battle effects are preserved.

## 0.25.0 — Arena UI refresh, Phase 5

- Add focused table viewing without browser fullscreen, new storage or scroll locking. Keep Exit focus, action controls, inspection and required decisions accessible.
- Add contextual setup/turn/connection/decision/result guidance and viewer-relative public Prize counts, without reading hidden arrays or inferring a winner.
- Confirm manual End turn through the existing modal. Bind review to the current match/revision/rules/seat/turn, recheck the current legal action on confirmation and cancel on locks, state changes, blur or hidden tabs.
- Move Help and History into scrollable dialogs; add bounded newest-first history search and player filters using only already-disclosed event text and revealed names.
- Clear recovered read errors only when no uncertain action is pending. Preserve the identical request ID and payload for uncertain-response retries.
- Add pure/component regression tests and a signed-in Chromium/WebKit production-build suite on isolated PostgreSQL, while retaining the full existing CI and browser gates.
- Synchronise release stamps. No engine, compiler, API, database migration, dependency, billing, Postal or deployment change. See docs/ARENA_UI_PHASE5.md for validation scope.

## 0.24.0 — Arena UI refresh, Phase 4

- Add a bounded effects layer for acknowledged card movement, attacks, exact server damage, conditions, healing, coin results, Stadium changes, turns and match results. The real board updates immediately and remains interactive.
- Animate faces only for surviving disclosed card IDs. Draw and Prize movement uses anonymous backs; rekeyed discards and removed targets are never matched by card name or assigned to replacement Pokémon.
- Replace the old latest-event flash with a compact battle activity recap. Suppress duplicate polls, stale views and historical replay; coalesce long event bursts rather than queueing animations.
- Add a per-table Battle effects toggle and OS reduced-motion text feedback. Clear decoration and listeners on connection loss, viewport interruption, hidden tabs, changed tables and unmount.
- Retain the existing rules, private views, action/retry idempotency, audio and all previous validation gates. Add pure privacy/routing, actual component-script, real Core/Expanded engine-view and Chromium/WebKit effect regressions.
- Synchronise release stamps. No new dependency, server/API/database change, migration, service, browser persistence or production deployment is introduced. See docs/ARENA_UI_PHASE4.md for exact coverage and acceptance boundaries.

## 0.23.1 — Arena counter and touch-capture validation

- Remove outgoing count text immediately so rapid public-count updates render exactly one current value, including with reduced motion. Retain the incoming highlight rather than weakening browser assertions.
- Distinguish implicit touch-capture transfer from genuine capture loss so the dedicated touch handle can continue its drag safely.
- Add rapid-counter and capture-transfer regressions plus a Chromium touch-input drag/confirmation check. Keep the existing Chromium/WebKit cases, strict typecheck and full-stack gates.
- Correct the synthetic Energy fixture, capture the mobile confirmation at its real viewport size and synchronise release stamps. No rules-engine, server or database changes.

## 0.23.0 — Arena UI refresh, Phase 3

- Highlight playable hand cards and their exact public destinations using only the current server-provided legal moves, for both retained rules versions and both seats.
- Add mouse card dragging and an explicit touch drag handle with a movement threshold, captured pointer, bounded edge scrolling and a private noninteractive drag preview. Ordinary card-face touch scrolling and tap selection remain native.
- Dropping opens a review, never an immediate game mutation. Keyboard/tap Choose target reaches the same confirmation. Forward the original server action through the existing guarded writer only after confirmation.
- Cancel local gestures/reviews on changed disclosed tables, selections, locks, prompts, visibility loss, additional pointers and capture cancellation. Identical polling preserves review; no optimistic board move, extra request or new browser persistence is added.
- Add subtle public-count feedback with reduced-motion support. Preserve Phase 2 previews, resumable decisions, the action tray and all existing CI gates, including the bounded browser-startup fixture.
- Add routing/privacy and actual component-state regressions plus Chromium/WebKit drag, confirmation, invalidation and touch-alternative checks. Synchronise release stamps. No engine, API, database, dependency or live-configuration change is required.

## 0.22.1 — Arena component label validation

- Provide consistent fallback player names for reusable field, pile, Stadium and turn labels when the alias list is incomplete.
- Correct the strict Vue prop type error without weakening typechecking. Add rendered missing-alias regressions for both seats and synchronise release stamps.
- Retain the Phase 2 interaction scope, server action guards and all existing validation gates.

## 0.22.0 — Arena UI refresh, Phase 2

- Extract reusable table, player/field zones, hidden-count stacks, discard piles and the private hand fan without changing server rules or saved matches.
- Add a bounded overlapping hand fan with hover/focus/selection lift, native horizontal scrolling and Left/Right/Home/End keyboard navigation. Tapping selects only; no gesture plays a card.
- Add the explicit server-provided action tray, a fixed mobile dock and larger card/discard previews using native modal dialogs. Remove the mobile inspector scroll jump.
- Present required decisions in a resumable dialog. Returning to the table preserves choices, identical polling preserves progress, and a new acknowledged decision resets selections.
- Drop unavailable selected-card previews when a newer disclosed view arrives; exclude opponent hands from the inspector index and retain request idempotency, locking and private-state cleanup.
- Extend layout/state/render and Chromium/WebKit checks, including mobile touch emulation, focus restoration, long hands/searches, Core snapshots and hidden-card safety. Keep the existing full-stack CI gates and coordinated release stamps.
- No new dependency, database migration, rules-engine change or production configuration change is required. Drag-and-drop and card-travel/attack effects remain later phases.

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
