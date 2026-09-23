# Arena UI Phase 5 — match usability and signed-in validation

Release: **0.25.0**. Builds on Phase 4 (`65076a45`, merged PR #28).
The original four-stage UI refresh is complete; this follow-on stage improves the
whole match page and adds a real authenticated browser validation boundary.

## Player-facing changes

**Focus table / Exit focus** is a per-page, in-memory view choice. It removes the
surrounding Arena navigation/footer and the secondary desktop preview, giving the
board a single-column layout. It is not browser fullscreen and never locks page or
hand scrolling, changes orientation, stores gameplay, requests permission, or makes
an API call. The exit button, tools, connection/uncertain-action notices, selected
card action tray, Inspect modal, tutorial, and required decisions remain available.
Other Arena pages keep their existing shell by default.

**Match status** distinguishes setup, sending, uncertain replies, connection loss,
required decisions, the opponent's turn and confirmed completion. Public Prize
counts are relative to the seated player. Invalid counts stay unknown; zero does
not invent a win. No hidden hand, deck or Prize array is read. Status is a polite
live region rather than a new game timer or a local rules engine.

**Manual End turn** now opens a confirmation with Keep playing focused by default.
The dialog does not send an action. Confirmation re-resolves the current exact
server-provided End turn payload before using the existing guarded match writer.
The local review is tied to match/revision/rules/seat/turn and cancels when the
context changes, the legal action disappears, a lock/decision intervenes, or the
window is hidden/unfocused. Identical polling preserves it. A second confirmation
cannot emit another move. Other global moves and practice autoplay retain their
existing contracts; attacks do not acquire an extra end-turn confirmation.

**History** and **How to play** use the existing native, scroll-contained modal.
History shows at most the latest 120 supplied events, newest first, with local
text/revealed-name search and All players / Your actions / Opponent actions / Table
events filters. Only disclosed event text and already-revealed names are displayed.
This is not a complete replay, export, spectator view or recovered hidden history.
A newly acknowledged required decision closes incidental Help/History dialogs.

A successful table read clears a recovered error only when no uncertain action is
pending. An uncertain write retains its existing saved request ID and identical
payload; the user still explicitly chooses Retry same action. No retry is inferred
from an animation or from opening a dialog.

## Scope

No rules/compiler/CPU/API/persistence change, migration, new runtime dependency,
new audio asset, entitlement change, billing/Postal configuration, cleanup-helper
change, merge or deployment is performed by these source files. Existing Core and
Expanded matches keep their versions. The existing full CI and 101 component
browser cases are not replaced or weakened.

## Validation

Run the full existing gates:

```sh
npm test
npm run typecheck
npm run build
npm run migrate
npm run test:integration
npm run test:arena-ui
npm run test:arena-effects
```

The new `.github/workflows/arena-match-ui.yml` builds the real Nuxt application,
starts it against a separate local PostgreSQL 17 `_test` database and runs:

```sh
npm run test:arena-match
```

Fixtures require `ALLOW_TEST_DATABASE=yes`, `ARENA_BROWSER_TEST=yes`, loopback
application/database hosts, an `_test` database suffix, and an APP_ORIGIN exactly
matching TEST_BASE_URL. Never point them at a production installation. They create
and remove synthetic users/sessions and controlled Arena entitlements/settings;
there are no real subscription payments, mail deliveries or publisher downloads.

The new Chromium/WebKit tests use actual authentication, production-rendered Nuxt
pages, real HTTP mutation handlers and real engine state. Cases cover focus/help,
manual End turn, cross-client revision invalidation, a deliberately lost response
after the server commits, same-request retry, history, revoked-session cleanup and
narrow touch viewports. The complete training-game case activates the actual Auto
play checkbox and advances its browser timer under Playwright's clock; the server
still resolves every action and declares the result. It does not replace the
engine with a mock, supply damage/RNG results, or claim that a person manually
played every move.

Ordinary UI assertions retain 5-second waits, tests use 30 seconds and zero retries,
and initial page startup has its own 60-second fixture budget. The new complete
training game alone has a 120-second / 100-step cap; this is a new long-flow budget,
not a relaxation of an existing regression. Other tests and workflows are unchanged.
Screenshots and traces use synthetic training cards and disposable sessions only.

The authoring environment ran the 62 new dependency-free/component-script tests
with Node 22 and the available TypeScript compiler. That subset is not the full
Node 24 production build/integration/browser gate. The PR and its workflow runs are
the authoritative execution record; the presence of a test file is not a pass.

## Acceptance boundaries

Signed-in automated browser tests are not physical iOS/Android acceptance. Check
real device portrait/landscape scrolling, safe areas, keyboard navigation, audio,
large hands, real catalogue artwork, and human two-player matches before broad
rollout. Practice training-game completion is not a new guarantee of coverage for
all catalogue cards or all possible game sequences. Preserve the existing .env,
integration key and database when deploying through the established upgrade helper.
