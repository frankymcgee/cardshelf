# Arena UI refresh — Phase 1 (0.21.0)

## Scope

The opponent sits above the player. Each side has five Bench positions, an Active
Pokémon nearest the centre, and separate deck, discard and Prize zones. The shared
Stadium and turn caption sit between the two fields. The private hand remains below
the player's field with native horizontal scrolling.

Depth is applied to the table surface, not to the card faces. Narrow tables move
piles to a compact shelf to preserve usable field targets. Empty piles remain
labelled; opponent hand backs and Prize decorations use bounded public counts only.
Reduced-motion preferences remove the new surface perspective and card animation.

This is a presentation change to ArenaBoard, with board-specific CSS. The existing
match page, card inspector, action/prompt handling, sounds, polling, rules versions,
server engines, access controls and database are unchanged. Core snapshots without
a Stadium field remain supported. No database migration is added.

This phase does not add a new fan-selection interaction, drag-and-drop, card travel
animations, attack effects or additional card mechanics. Those belong to later phases.

## Validation

Run with Node.js 24 after installing the repository dependencies:

```sh
npm test
npm run typecheck
npm run build
npx playwright install --with-deps chromium webkit
npm run test:arena-ui
```

The existing Validate CardShelf workflow retains unit tests, typecheck, production
build, migrations and API integration tests against a disposable PostgreSQL database.
Never run integration fixtures against a live database.

The new Validate Arena table UI workflow compiles the actual ArenaBoard/ArenaCard
components and loads the actual application and Arena styles in a local fixture.
It exercises both player seats at 320, 390, 768, 1024 and 1440 pixels in Chromium and
WebKit, including layout order, page overflow, Bench/pile target sizes, selection,
keyboard discard/hand access, Stadium actions, lock state, setup secrecy, Core
snapshots, empty piles and reduced motion. Screenshot/report artifacts are retained
as arena-table-ui-evidence. Synthetic cards avoid live catalogue requests.

The browser fixture is a development-only localhost server, not a production Nuxt
route. It validates the real components, but it is not a full authenticated match
play-through or physical iOS/Android device test. Use each commit's Actions results
as the execution record; the existence of a test does not establish that it passed.

## Review before deployment

Review the PR and both workflows. On a test deployment, resume an existing Core
match and an Expanded match, then check setup, card inspection, discard inspection,
Stadium actions, a prompted decision and a large hand. Check actual mobile scrolling
and the surrounding inspector/prompt controls on the devices used by members.

Merging and deploying are separate operations. Preserve the existing .env, database
and integration key. This change neither deploys itself nor resets saved matches.
