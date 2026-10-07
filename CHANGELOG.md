## 0.48.0 — 2026-10-07

- Add CardShelf card motion to Arena: hover lift, selection waves, card-play landing pulses, Energy attachment rings and evolution bursts.
- Show attack-card lunges, type-coloured trails, impact particles and larger exact damage numbers, plus turn, Knock Out and result banners.
- Animate newly revealed opponent plays at their public destination while preserving private hands and anonymous draw/Prize card backs.
- Add Full/Reduced motion controls and apply Battle effects: Off to selection movement as well. Respect system reduced motion with textual battle feedback.
- Keep effects brief and cancel them on scroll, reconnect and navigation. Uses the existing GitHub build with no new packages or migration.

## 0.47.4 — 2026-10-07

- Show the backend photo-scan allowance on every public and Test pricing card, including Free and Collector. Remove the display gate that hid their saved limits behind a fixed not-included message.
- Show Collector's saved allowance in signed-in membership choices as well. Zero displays as Unlimited photo scans for any tier; missing values stay unavailable.
- Keep scan eligibility explicit beside the allowance. Collection access, scanner enablement, usage enforcement and the shared service budget are unchanged.
- Verify all three tier values, each tier set independently to zero, both billing cadences and paused pricing on desktop and phone. No database migration or server configuration change is required.
- Make the CI artifact transfer check download the exact artifacts it just uploaded, preventing a retry from comparing files against an earlier attempt's archive.

## 0.47.3 — 2026-10-07

- Read current backend photo-scan allowances in signed-in Stripe membership choices, public pricing and the Test preview. Show zero as Unlimited photo scans; finite amounts remain monthly even with yearly billing.
- Replace Stripe photo-scan feature bullets with the backend allowance so a saved product cannot display a conflicting count. Keep other product details and historical subscription snapshots intact.
- Preview each tier's allowance beside its scanning setting, including zero as unlimited, and explain that saved limits do not require a Stripe sync.
- Preserve collection access rules and the shared service budget. No migration or server configuration change is required.

## 0.47.2 — 2026-10-07

- Allow unused manual Stripe drafts to be deleted while Stripe product sync is enabled. Keep manual offers available to pause so incorrect mappings can be cleaned up without disabling product sync.
- Preserve Stripe-managed offers and checkout/subscription history. Manual creation and publication remain disabled while Stripe manages new offers.
- Show offer ownership and reasons an offer cannot be deleted; direct managed-price changes to Pricing & plans in the same Test or Live environment.
- Keep Stripe administration tables horizontally scrollable on phones so offer actions remain reachable.
- Verify the correction workflow from a mislabelled manual price through deletion and successful product sync. No database migration or server configuration change is required.

## 0.47.1 — 2026-10-07

- Add Delete draft to manual Stripe offers so an unused price can be re-added under the correct Collector or Collector Plus tier.
- Require administrator access, confirmation and the current offer revision. Preserve published offers, Stripe-managed offers and every offer referenced by checkout or subscription history.
- Remove only the CardShelf draft mapping, record the deletion in the audit log, and keep Stripe products and prices available. No migration or server configuration change is required.

## 0.47.0 — 2026-10-04

- Add independent outside cover colours and wallpapers to Binder appearance, with inside/outside controls and live previews. Show covers on the binder shelf, dashboard, open binder and shared view.
- Save inside and outside images together with separate fit, opacity, dimming and blur settings. Existing binders retain their colours and page backgrounds, including when the cover colour changes.
- Add bounded cover image storage with owner-only and current-share access, independent removal, and automatic cleanup. Migration 029 ships in the existing GitHub release images; no new dependencies or server settings are needed.
- Verify legacy compatibility, dual uploads, stale edits, shared-link revocation and desktop/mobile appearance controls.

## 0.46.1 — 2026-09-28

- Keep missing-card artwork placeholders readable in light and dark themes, including when every image source fails.
- Serve browser-test card artwork from supported local URLs so Arena, theme, binder and scanning checks exercise loaded images. Verify discard artwork loads and add missing/failed-image contrast regressions without relaxing existing checks.

## 0.46.0 — 2026-09-28

- Recover missing and failed Pokémon artwork with exact set/number/language fallbacks to Pokémon's official card images and Limitless TCG. Initial reviewed mappings cover Mega Evolution Energy, Scarlet & Violet Energy and Mega Evolution.
- Try full-size and PNG TCGdex artwork when a thumbnail fails. Apply the bounded fallback chain to existing catalogue cards, binders, scanning results, marketplace card selection and visible arena/battle cards without re-importing or modifying collection data.
- Allow the exact artwork source paths in the production image policy, credit providers, and add deterministic source-selection and production browser regression coverage. No migration, credentials or new dependencies are required.

## 0.45.0 — 2026-09-28

- Add a dismissible mobile install prompt, native browser installation when available, and iPhone/iPad Home Screen instructions. Installed apps suppress the prompt; App & notifications remains available from More and Account.
- Add device-specific, opt-in Web Push for marketplace enquiries/replies and administrator membership changes, with editable preferences and a self-test. Private message text stays inside CardShelf.
- Generate persistent VAPID keys automatically in PostgreSQL. Add authenticated subscription APIs, session-bound revocation, delivery-time permission checks, bounded retries, expired endpoint cleanup and same-origin notification links.
- Ship the migration and locked Web Push dependency in the existing GitHub AMD64/ARM64 images. No new server environment settings or host deployment changes are needed; HTTPS is required.
- Add protocol, service-worker, database/API and desktop/mobile browser coverage to release validation.

## 0.44.2 — 2026-09-28

- Bound neutral-area screenshot differences by both colour error and changed pixel area to allow subpixel rounding in GitHub's Chromium renderer. Keep the visible foil coverage requirements unchanged.
- Retain paired foil/baseline images and measurements in CI artifacts before assertions, improving diagnostics for any future visual failure. Application rendering is unchanged.

## 0.44.1 — 2026-09-28

- Stabilise the foil pixel comparison by waiting for each image and an explicit baseline repaint. Preserve the exact coverage thresholds, artwork masks and full browser suite.
- Fix the intermittent dark-theme validation failure that blocked release publication. Card rendering and deployment behaviour are unchanged.

## 0.44.0 — 2026-09-28

- Replace faint variant washes and mechanic border outlines with layered artwork foil: rainbow sparkle for Holo, diamond-patterned card stock for Reverse Holo, and full-face prismatic facets and star glints for Holo ex/EX cards.
- Preserve exact printing selection, neutral Normal/unknown artwork, variant badges and missing-image fallbacks. Keep reverse artwork clear even on named mechanics.
- Keep the existing Off, Subtle and Shimmer controls; animate only the hovered or keyboard-focused card on a fine pointer. Touch and reduced-motion views retain static foil, and print/forced-colour views omit effects.
- Add desktop/phone browser checks for rendered foil coverage, printing changes and effect controls. No migration, external assets or dependencies are required.

## 0.43.1 — 2026-09-27

- Use the theme's high-contrast accent for graph lines, remove repeated currency codes, and show readable price-series labels and source dates. Keep the full selected series visible on narrow screens.
- Verify chart contrast against the painted light/dark surfaces and retain desktop/phone graph coverage.

## 0.43.0 — 2026-09-27

- Add private daily collection and Collection binder value snapshots, with 7/30/90-day graphs, exact observation inspection and accessible tables in light and dark themes.
- Separate estimate changes caused by prices/FX, added or removed copies, and changed price coverage or sources. Preserve each day's actual holdings and FX basis; never reconstruct past ownership or replace missing prices with zero.
- Add source/currency/finish/metric-specific card price graphs in signed-in and public card details. Planned binder values remain separate from physical ownership; Tracking binders remain unvalued checklists.
- Record observations in bounded worker batches and on summary views, keep one updatable observation for today, retain closed days for up to 366 days, and cascade private history on account/binder deletion.
- Resolve #51 by pinning all seven GitHub/Docker actions to reviewed Node 24 releases and Ubuntu runners to 24.04. Keep PR workflow deduplication, concurrency and native release gates; verify archive transfer names, merged paths and bytes with a small artifact round trip.
- Add unit, PostgreSQL/API and desktop/phone browser validation. No host configuration change is required; member marketplace listings remain cards-only.

## 0.42.3 — 2026-09-27

- Remove duplicate feature-branch push validation; pull requests keep their application, Arena and native container checks, and main-branch pushes keep the full release pipeline.
- Cancel superseded PR runs in both Arena workflows using separate concurrency groups that do not interrupt release calls or manual runs.
- Document automatic and manual validation triggers. Application behaviour, release gates and host configuration are unchanged.

## 0.42.2 — 2026-09-27

- Use accessible dropdown roles in batch browser tests, matching the existing scanner checks, and run the batch suite earlier in CI for quicker diagnostics. No application behaviour changes.

## 0.42.1 — 2026-09-27

- Wait for batch queue initialization before file selection in browser validation, and stop the suite after repeated failures so diagnostics return promptly. Collection, quota and scanning behaviour are unchanged.

## 0.42.0 — 2026-09-27

- Add a 20-photo batch scanning queue with sequential recognition, pause/resume, duplicate-photo detection and a shared binder destination.
- Keep explicit card, printing, condition and quantity review for each addition. Refresh inventory and binder revisions between reviews and retain existing idempotent confirmation and guarded Undo.
- Recheck membership, per-tier allowances and shared budget for each upload; stop on errors or exhausted limits. Zero still means unlimited member scans, not an unlimited shared budget.
- Recover submitted scans by their original receipt IDs without another analysis. Keep photos only in memory; retain private account-bound queue metadata in the current browser tab and support reattaching original photos after reload.
- Expand Recent scans to 20 receipts and add unit, database and desktop/phone browser coverage. No migration or server configuration changes.

## 0.41.0 — 2026-09-27

- Add Complete this binder with a deduplicated list of missing printings, pocket locations, search, wishlist filters and bulk wishlist additions.
- Preserve inventory-backed Collection progress and independent Tracking checkmarks; design checklists require confirmation of the displayed printings.
- Find active member listings for the exact missing printing, with condition, AUD asking price, postage and pickup details. Exclude your own and unavailable listings.
- Keep existing membership/game permissions, reject stale bulk selections atomically, and leave quantities, notes, binder layouts and sharing unchanged.
- Add an index for exact-printing marketplace matches (migration 026).

## 0.40.0 — 2026-09-26

- Build and validate native AMD64/ARM64 release images in GitHub Actions; publish to GHCR only after the main-branch application, Arena and container upgrade checks pass.
- Pull releases on the server while the site stays online. Preserve automatic backups, migrations and health checks; pin the installed image digest and prevent concurrent upgrades.
- Detect changed host deployment files before stopping services, retain an explicit source-build fallback, and document the one-time private registry login.
- Commit the dependency lockfile from the previously validated release and use reproducible `npm ci` builds.

## 0.39.2 — Marketplace publication validation

- Scope the real publication browser check to marketplace results after navigation, so private administrator preview tiles cannot be mistaken for published products while the route is changing. Preserve the strict active-link count and paused/expired-entry checks.

## 0.39.1 — One marketplace grid

- Mix affiliate products and external shops into the same responsive grid as collector listings. Randomize affiliate positions per visit and keep them steady through ordinary updates; preserve collector sorting, pagination, exact tracking URLs and the single keyed ad slot.
- Move the full affiliate and Amazon disclosures below the results. Mark each external tile as an Affiliate link, retain its retailer button and omit prices or checkout controls.
- Show a populated grid when only affiliate products are available, keep My listings private, and update the administrator Marketplace preview to match the tiles and bottom disclosure. No migration or settings changes are required.
- Verify desktop/phone light and dark layouts, sorting, pagination, image fallback, optional-service failures, empty results and the real publication flow.

## 0.39.0 — Manual affiliate product cards

- Add product cards alongside existing affiliate shop links, with manually entered names, descriptions, locally uploaded images and a View on Amazon / View at shop button. Product cards show no price, stock status or checkout controls and keep their exact destination through marketplace searches.
- Add a Product card display type, image upload/replacement/removal and draft preview to Affiliate shops. Existing entries remain shop links until changed; publishing still requires enablement, placements, a current administrator password and an unchanged revision.
- Migration 025 stores decoded WebP images with metadata stripped. Draft previews require administrator access; public image requests check saved publication and expiry. Global pause, per-entry pause and image replacement/removal revoke subsequent public requests. Reclaim old unused uploads during later saves/uploads and bound stored uploads.
- Keep content explicitly manual; no retailer scraping, automatic import, API credentials or Amazon-owned images are added. Extend unit, real PostgreSQL/HTTP and desktop/phone browser coverage for product publishing, upload failures and image access.

## 0.38.1 — Affiliate visibility and consistent colour themes

- Show the saved marketplace affiliate-link count and shop names in administration, using the same public endpoint as visitors. Refresh after saving, distinguish published links from paused draft previews, and provide a direct marketplace link.
- Use a shared light/dark palette for public website, marketplace and administration surfaces, text, forms, navigation, alerts and pricing controls. Fix undefined panel colour variables and scoped light-only styles while preserving card artwork, custom binder backgrounds and Arena artwork.
- Add desktop/phone browser checks for rendered contrast, theme persistence and device preference, plus a real browser/HTTP/PostgreSQL affiliate save-and-display test covering paused and expired shops, tracking URLs and the global switch.

## 0.38.0 — Amazon starter links and configurable affiliate shops

- Add admin-managed external shop links with optional encoded card searches, referral codes, placement/game filters, ordering and expiry.
- Start Amazon entries for binders, sleeves and card packs; paste supplied Associates links unchanged. Include the Amazon disclosure and explicit Amazon destination labels, with no product scraping, price claims or API credentials.
- Preview links before saving; master and per-shop switches start disabled. Current admin password, revision conflicts and audit events protect changes.
- Show disclosed external shopping options on marketplace browsing, collection card details and public catalogue details, with no external script or automatic purchase.
- Add migration 024; no accounts, API keys, prices or commission rates are seeded. CardTrader buying and data access remain separate from approved referral links.

## 0.37.0 — Free pricing, tier scan allowances and admin navigation

- Show Free beside paid plans in public pricing and the read-only Test preview, even when checkout is paused or no Test products have been synced. No Stripe product is required for Free.
- Add monthly scan allowances for Free, Collector, Plus/Pro and Complimentary/tester tiers. Zero means unlimited member scans; collection/game permissions, shared USD budget and request concurrency still apply. Show the current allowance on pricing and in the scanner.
- Migration 023 copies the existing global allowance to every tier. Usage remains per account per UTC calendar month across tier changes. Replayed requests keep their receipts without consuming another allowance.
- Add a searchable Administration home and section switcher, move product sync/private plan notes to Pricing & plans, simplify the request inbox and remove duplicated subscription links and outdated scanning copy.

## 0.36.0 — Auto ads previews inside card grids

- Insert one card-sized Auto ads preview after the first six cards in public catalogue, Cards and marketplace grids. Preserve card order, result totals and pagination.
- Keep a banner in Cards list view, hide grid previews on empty/private views, and preserve paid/protected eligibility rules. Grid previews use Auto ads only; Google chooses live placement.

## 0.35.0 — Responsive Google Auto ads previews

- Replace generic placeholders with page-appropriate Auto banner sizes, responsive Multiplex grids, dismissible anchors and desktop side rails. All placeholders represent Auto ads; none require manual unit IDs.
- Use compact mobile layouts, protect workspace navigation, hide rails when there is insufficient space and preserve the administrator preview bypass of advertising requests.
- Document the Google-side format controls and distinguish illustrative sizes from live Auto ads decisions. Live loading and private-page exclusions remain unchanged.

## 0.34.1 — Reliable administrator placement previews

- Render the opted-in administrator layout preview from the authenticated session without depending on Google/ad eligibility requests or live-ad CSS classes.
- Use the same secure-cookie configuration as sign-in, verify preference persistence before reloading, and display the saved view and placement location.
- Preserve private-page exclusions and live-ad controls.

## 0.34.0 — Ad placeholders and administrator viewing

- Show local placeholders to eligible Free accounts before AdSense approval, without Google requests.
- Administrators can choose Hidden, Placeholder preview or Live ads for their account in this browser. Private routes stay excluded.
- Placeholder positions are illustrative; Google determines real Auto ads placement. Migration 022 defaults placeholders off.

## 0.33.0 — Automatic scan placement in binders

- Choose a Pokémon Collection or Tracking binder before scanning and retain it for subsequent cards. Automatic placement reuses the exact printing's existing pocket or finds the first empty pocket across all pages.
- Keep already-planned and already-collected pockets available, including in full binders. Allow an extra placement in a Collection binder by choosing another empty pocket manually.
- Mark selected Tracking pockets collected when confirming a scan, with atomic inventory updates and guarded Undo that preserves prior marks and later edits.
- Show the destination page and pocket before and after confirmation, refresh the binder between scans, and expose the scanner from eligible Tracking binders.

## 0.32.0 — Configurable card recognition

- Edit the OpenAI model name, reasoning effort/mode, image detail, output allowance, timeout and recognition prompt from the scanning admin page, with a restore-default prompt action.
- Set model-specific token prices and preview the scan reservation before saving. Retain each scan's original settings and prices while administrators make changes.
- Record requested and returned model names, show usage by model, accept model aliases, and explain unsupported configurations or insufficient output allowances.
- Preserve existing defaults through additive migration 021; keep credentials encrypted, member overrides blocked, and collection additions explicitly confirmed.

## 0.31.2 — Arena browser runner storage

- Free unused preinstalled Android and .NET SDK storage before the signed-in Arena browser job, which exhausted disk space while closing a WebKit tournament session.
- Report disk space, inode availability and browser output sizes to diagnose runner storage failures while retaining the existing test assertions and traces.

## 0.31.1 — Scanner validation and recovery

- Preserve the scanner destination through sign-in and clear stale connection errors when a saved receipt is recovered.
- Settle late recognition costs without restoring private details after account deletion.
- Exercise membership loss with accounts that do not retain the protected tester grant.

## 0.31.0 — Card photo scanning

- Take or upload one English or Japanese Pokémon card photo, resolve visible details against the imported catalogue, and confirm its printing, condition and quantity before adding it.
- Optionally place the printing into an empty or matching Collection binder pocket. Repeated requests are idempotent; guarded Undo restores the previous quantity and removes a newly placed pocket.
- Add encrypted OpenAI configuration, per-user monthly scan allowances, a shared monthly budget, and usage/cost history for evaluating a future local recognition provider.
- Scanning starts disabled, strips image metadata, keeps photos out of persistent storage, and requires explicit consent before external processing. No automatic condition grading or authentication.

## 0.30.1 — Commentary presentation and tournament fixtures

- Keep the commentary table inside tablet viewports, use neutral spectator captions, and identify the source pairing for future bracket slots.
- Resolve the coin toss before completing both opening fields in tournament test fixtures, so either random toss outcome is covered reliably.

## 0.30.0 — Invited tournaments and live commentary

- Add private 2–64-player single-elimination events with in-app invitations, registered deck snapshots, random seeds, byes and automatic winner advancement.
- Support draw rematches, recorded administrator forfeits and event cancellation with transactional revision/idempotency checks.
- Add responsive event/bracket screens and an administrator commentary view using the illustrated tabletop, public scoreboard, card inspection and stream layout.
- Keep both hands, opening setup, face-down Prize identities, deck order and private decisions out of the spectator API. Existing private matches stay private.
- Add the additive tournament migration, unit/privacy coverage, real database progression tests and signed-in browser workflows.

## 0.29.2 — Workshop browser validation

- Locate catalogue dropdowns by their accessible combobox names in the signed-in browser tests. Await the lobby table response before checking the rendered continuation link.

## 0.29.1 — Retain strict match snapshot validation

- Keep repairable workshop deck reads separate from strict match snapshots. Older matches continue to reject newly supported cards with their original compiler and error response.

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
