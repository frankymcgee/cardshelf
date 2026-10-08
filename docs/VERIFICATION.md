# Production release inspection — CardShelf 0.51.0

Inspection date: 8 October 2026 (UTC). Live system observed: **0.50.0** at
`https://cardshelf.cloud`; baseline source: `115c7d3b57cde4668886e373e46d94177949b163`.
The release changes are on `release/production-readiness` and are not installed
on the live server merely because they pass source checks.

## Release decision

**A full public launch and full feature parity are not yet certified.** This
release fixes observed defects and adds reusable inspection coverage. Opening
registration, successful code CI and removing beta copy are separate from
verifying real payments, delivered email, device push, restoration and complete
rules coverage. Preserve protected tester grants and existing subscriptions.

## Defects corrected

| Finding | Change |
|---|---|
| Arena walkthrough exhausted its 4,000-action safety limit by turn 6 | CPU was repeatedly resetting its prepared opening before the human selected who starts. It now waits, including saved Core v1 matches; the UI polls without idle writes until that choice. The safety cap remains. |
| Conceding player saw “The opponent conceded” | Use a viewpoint-independent concession reason. |
| Public pages invited private-beta testers despite Live subscriptions | Normal registration/contact CTAs and launch copy; protected grants remain unchanged. Registration pause is still honestly shown. |
| Old access-form URL was the only support destination | Canonical `/contact`; permanent legacy redirect preserves only validated purposes and drops arbitrary query parameters. |
| Server settings reported hard-coded 0.5.0 while the app ran 0.50.0 | Read installed package version; remove outdated loading fallback. |
| Static pages mixed Collector Pro/Plus and SMTP/Postal descriptions | Align static product and service names; Stripe-supplied product snapshots are still authoritative. |
| Privacy page omitted photo recognition, push and complete ad information | Explain these implemented data flows and include provider-specific advertising notices. |
| No consolidated production inspection view | Administrator-only `/admin/readiness` returns 17 derived checks, plus six separate acceptance checks. It performs no external calls or writes and exposes no credentials or account identities. |

## Live evidence and outstanding gates

| Area | Evidence observed on live 0.50.0 | Gate still open |
|---|---|---|
| Access/public launch | Existing administrator session works; public and private routes are reachable. Free self-registration is switched **off**. | Enable the reviewed Free registration setting on the deployed release and complete a fresh new-member flow. Do not replace protected grants with paid requirements. |
| Catalogue/worker/prices | 8 imported sets, 781 cards, 1,128 printings; worker online and recent completed price jobs. English TCGdex returned 220 sets and Japanese 184, excluding the selector placeholder. Binder has dated AUD values and coverage labels. | Current catalogue does not establish exhaustive card/printing coverage. Yu-Gi-Oh! returned selectable source sets; Magic returned 796 source sets without an error. |
| Stripe | Live connection test **passed without creating a charge**; checkout and enforcement enabled; both paid tiers published; portal configured; signed Live webhook and current reconciliation heartbeat visible. | New member checkout → signed invoice → correct tier → portal cancellation/renewal acceptance. No money was charged or subscription changed during this inspection. |
| Postal | Sending enabled and credentials configured. Historical test/recovery emails show provider acceptance. DNS diagnostics checked SPF/hostname/return-path; DMARC is in review. DKIM diagnostic input and the trusted Postal webhook verification public key are **not configured**. | Obtain and save Postal’s exact trusted HTTP signing public key to allow event verification. Verify sender DKIM and correlated signed delivery events, then receive a real recovery email and redeem it. Acceptance by Postal is not proof of inbox delivery. |
| Recognition | Enabled OpenAI integration; successful historical scans and additions; monthly cost/budget counters and scan-resume UI work. | Fresh camera/upload recognition and confirmed addition on the deployed release. This inspection did not spend provider budget or alter collection holdings. |
| Push/PWA | Device page renders installation, preferences and permission handling. This cloud browser has notifications blocked. | Opted-in physical iPhone/Android install and actual notification delivery. Browser layout tests do not establish delivery. |
| Arena | Eligible assignment, saved deck, workshop/tournament navigation, hidden opening cards, server-validated placement, Inspect and history observed. A new training match reproduced the reset loop and was closed by concession. | Deploy the fix, repeat a long opening wait and complete a game; run two eligible accounts through private-match reconnect and tournament advancement. Unsupported effects/Special Energy still prevent full official rules parity. |
| Recovery/hosting | Baseline GitHub validation succeeded, including supplied release gates. | No host shell/current database backup access in this inspection. Restore a current production backup in isolation; do not restore over the live database. |
| Advertising | Configured provider and administrator previews are inspectable. | Verify signed-out/Free live creative fill and consent on actual devices; repeat private/paid exclusions after deployment. |

No production credentials, account emails, private collections or messages are
included in this report. The Arena screenshot contains only original training
cards and the inspection alias.

## Route inspection coverage

The new real-server browser suite inspects 11 public routes and 33 authenticated
member/administrator routes at desktop and phone sizes. Each inspection waits
for mounted reads, detects JavaScript errors and same-origin API server errors,
and checks horizontal overflow. It also checks the safe legacy contact redirect,
paused-registration contact purpose and the complete readiness view. It uses a
disposable localhost `_test` database, never production credentials.

| Route group | Inspection scope |
|---|---|
| Public | Homepage, features, pricing, Arena information, contact/privacy, catalogue, registration/sign-in/recovery/reset; canonical metadata and public sitemap |
| Member | Dashboard, account/membership/referrals, emails/push, games/cards, binder shelf, scanner/settings, marketplace/create/inbox |
| Administrator | Home, readiness, pricing/Test preview, Stripe, memberships, Arena, provider imports, scanning, emails/recovery, website requests, Free/sponsors, affiliates, advertising, moderation |
| Dynamic workflows | Existing dedicated integration/browser suites cover card detail/editing, binder detail/completion/sharing/printing, marketplace detail/photos/conversations, Arena deck/match/tournament/watch routes and access failures. A populated binder and an actual training match were also inspected live. |
| Retired assisted play | `/battle` routes redirect to `/arena` and `/admin/battle` redirects to `/admin/arena`; old records remain stored and old APIs return 410. Existing version/archive tests remain in place. |

Booting a route does not prove every mutation, external connection or device
workflow. CI fixtures test actual SQL/application behavior with deterministic
provider doubles; they do not prove external provider delivery.

## Executed checks

| Check | Result | Boundary |
|---|---|---|
| Baseline Node suite | 2,094 passed; no failures/skips | Actual source on Node 24.19.0 |
| Baseline Nuxt typecheck/build | Passed | Volar plugin warning is nonfatal |
| Arena idle-loop regression and UI suite | 45 passed; no failures/skips | Both engines wait unchanged through 150 polls, then complete a game; browser tick uses reads while first choice is pending |
| Final release Node/typecheck/build | **2,106 passed, 0 failed, 0 skipped; typecheck and production build passed** | New readiness contracts and existing regressions; Node 24.19.0 |
| PostgreSQL/real browser/image CI | Results updated on the pull request | This local environment cannot initialize native PostgreSQL as a non-root owner and cannot download Playwright engines; no tests were bypassed. |
| Live browser inspection | Findings above | Retained administrator session; read-only configuration plus one disposable training match |

The baseline successful workflow is
[Validate CardShelf](https://github.com/frankymcgee/cardshelf/actions/runs/37697064181).
Only a successful workflow on this release’s exact commit establishes its CI
result. New integration tests verify admin/member/anonymous authorization,
private no-store responses, no leaked secrets, no writes, applied migrations,
correct installed version, contact SSR/redirect and sitemap behavior.

## Deployment acceptance sequence

1. Review and merge only after all release CI gates pass; use the repository’s
   existing tested container release/upgrade path.
2. Back up the current deployment and verify restoration on an isolated host.
3. Install the release; check health, app/worker version and migrations, then
   open Administration → Release readiness.
4. Complete Postal sender/event and receiving-inbox acceptance, including
   password recovery without exposing the token in logs or reports.
5. Complete Live membership purchase/tier/portal/renewal acceptance using the
   operator’s payment process, and the physical-device push/scan checks.
6. Complete both-seat Arena and tournament acceptance and actual guest/Free
   advertising/privacy acceptance.
7. Enable Free registration with its existing administrator verification and
   audit reason; confirm a fresh member can register and reach their intended
   membership. Release announcements must match the implemented scope.

For specific feature gaps see [PARITY_CHECKLIST.md](PARITY_CHECKLIST.md). The
original September source-only report is retained as
[history/INITIAL_VERIFICATION.md](history/INITIAL_VERIFICATION.md).

![Live training match closed after inspection](evidence/arena-inspection.jpg)
