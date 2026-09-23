# Arena UI Phase 6 — first-person tabletop

Release: **0.26.0**. Based on merged Phase 5, main `ae80c070`.

The approved visual direction is a seated-player view across a dark playmat with
a wood-coloured edge: the opponent recedes into the distance, the player's hand
is closest, the two Active zones face the shared centre, and public piles flank
each field. This is CSS perspective on actual interactive components.

## Layout and controls

- `ArenaTable` projects only its field plane. The private hand and named action
  slot are outside that plane, so selection controls and the foreground fan stay
  upright. There is no camera loop, WebGL dependency or local game simulation.
- The match uses the available width, with the selected-card action tray beside
  the hand on wide tables. Inspect still opens the existing detailed card modal.
  Small viewports retain the fixed action dock and native hand/page scrolling.
- Container queries switch narrow tables to a flat field with full-width Bench
  rows and compact pile shelves. Reduced motion and forced colours also flatten
  the field. The existing keyboard paths and explicit touch drag handle remain.
- Discard piles show only the last disclosed, non-hidden discard's artwork, or
  a text fallback. Empty piles remove their face. Private hands, deck order and
  Prize contents are never supplied to the pile components. Decorative backs
  still derive only from bounded public counts.
- The original field drop attributes and event contracts are retained.
  `elementFromPoint` resolves actual projected targets; confirmed effects read
  their rendered rectangles and continue to clear on scrolling and resizing.
  Effects, drag ghosts and modal dialogs remain outside the transformed field.

The Stadium remains shared and inspectable, and its original server-provided
action buttons remain available. Core snapshots without a Stadium are supported.
Selection, legal-move confirmation, end-turn confirmation, pending decisions,
uncertain-request retries, CPU/PvP actions and saved match rules are unchanged.
No engine, API, database, dependency or deployment configuration is changed,
apart from coordinated release-version stamps.

## Validation

The existing unit, typecheck, build, database/API, component browser and signed-in
match workflows remain intact, including original assertions, timeouts and zero
retries. Added coverage checks perspective geometry for both seats, projected
card hit targets, upright hand/actions, narrow containers, reduced motion, public
discard artwork and removal of hidden/empty discard faces.

Local authoring validation uses Node 24.19.0. The full 1,899-test unit/render suite,
strict Nuxt typecheck and production build passed. Local browser validation uses
a separate Chromium 153 binary because the standard Playwright browser download
is unavailable in the authoring environment; the repository's pinned Playwright
dependency and CI browser installation are unchanged. See the PR for completed
browser results and the authoritative Chromium/WebKit, database and signed-in
workflow results for the pushed commit. An unexecuted workflow is not a pass.

Screenshots use synthetic training cards and exercise real components/styles.
They do not represent real catalogue artwork or physical iOS/Android acceptance.
The presentation follows the approved mockup's layout; decorative room scenery
and invented card text from the concept image are not application assets.
