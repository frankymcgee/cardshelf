# Arena UI refresh — Phase 4 (0.24.0)

## Confirmed battle feedback

ArenaEffects wraps the existing ArenaBoard. The authoritative board renders the
latest acknowledged state immediately; short-lived decoration adds card travel,
attack beams and exact logged damage, conditions, healing, Abilities, coin results,
Stadium changes, turn notices, Knock Outs and results. It replaces the old single
latest-event flash rather than running a second competing flash/audio system.
The existing audio controls, action tray, drag confirmation, decisions and writer
are unchanged. No new sound files or playback channels are added.

The Battle effects button toggles this layer for the current table mount. It does
not change a game setting or write browser storage. OS reduced-motion preferences
suppress the motion layer while retaining a compact text recap. Static card/target
indicators and the pre-existing Phase 3 feedback are independent of this toggle.

## Identity, privacy and timing

Movement connects only the same disclosed instance ID in consecutive acknowledged
views. Supported examples are the viewer's hand to Active/Bench, hand to attached
Energy/Tool, hand to Stadium, and existing Active/Bench swaps. The renderer measures
the old and new DOM positions; faces are looked up from the CURRENT disclosed view,
not copied from an old HTML node or retained card snapshot. Removed, hidden or
rekeyed identities cannot remain as face-bearing decoration.

The engine rekeys cards entering hidden zones and many discard transitions.
Phase 4 deliberately does not guess these relationships from names, catalogue IDs
or artwork. Opponent plays without an old disclosed ID update normally without a
face flight. A draw/Prize event with corresponding public net count changes may
show a single anonymous back between the appropriate piles; no hidden face or
specific draw identity is inferred. Complex draw/discard sequences without a clear
net change can omit travel. This is feedback, not a replay or complete animation
of every underlying effect.

Attack damage uses the server event's amount, not a local damage calculation or
combined HP delta. The effect points only at the same surviving field instance;
a defeated target is never silently replaced by the newly promoted Active Pokémon.
Knock Outs without a surviving target have a textual cue. Healing uses the generic
Damage removed label because a net state difference is not necessarily one effect's
heal amount. Special Conditions use only confirmed, supported status fields.

Only one bounded metadata frame is retained: no card names, artwork, opponent hand,
deck/Prize contents or raw event bodies. New effects replace old ones; no animation
queue delays input, prompts, polling, CPU decisions or the server response. Limits
are eight movements, six impacts and four recap cues per update. Travel expires
at 460 ms; all remaining decoration clears at 1.4 seconds. Large/truncated event
bursts coalesce to a History notice instead of replaying an old backlog.

Initial loading, match/seat/rules/round changes, reconnecting and long unobserved
gaps establish a quiet baseline. Equal-revision successful polls keep a slow turn
fresh but never replay it. Scroll, resize, focus/visibility changes and unmount
clear stale geometry and timers. Offscreen or clipped anchors skip travel rather
than scrolling the page or flying an image from an invented position.

The decorative layer is inert, aria-hidden and noninteractive. A separate polite
status recap carries the text. Controls retain focus and remain usable during
feedback; animation completion is never a prerequisite for playing a valid move.

## Operational scope

No game engine, compiler, API, database, migration, server process, third-party
library, entitlement, collection, Postal or billing change. No new network polling,
telemetry, local storage or saved event stream. The existing server validation,
revision checks, request IDs, lost-response retry and access cleanup are retained.
The standalone server cleanup helper is not part of this Arena release.

## Validation

```sh
npm test
npm run typecheck
npm run build
npx playwright install --with-deps chromium webkit
npm run test:arena-ui
npm run test:arena-effects
```

The original full-stack workflow and all Phase 1–3 browser cases remain. Additional
unit tests cover exact amounts, metadata/privacy poison getters, surviving/rekeyed
IDs, duplicate events, revisions, bounded bursts, current-face invalidation and
lifecycle cleanup. Real Core and Expanded engine views from original training decks
exercise setup privacy, attachment and attacks. The new localhost-only browser
fixture compiles the actual effects/board components and loads the real styles.
Chromium/WebKit cases cover both seats/rules versions, motion, click-through,
anonymous backs, updates, reduced motion, toggling, reconnection and narrow touch
viewports. The 30-second test budgets, zero retries and separate browser-page setup
fixture are retained.

Use the PR Actions results and validation comment as the execution record. Test
source alone is not proof of a passed check. Synthetic component fixtures and
engine/API integration do not replace a signed-in full-match browser play-through
or physical iOS/Android acceptance. Before deployment, check actual card artwork,
long hands, portrait/landscape, scrolling during effects, decisions during an attack,
reconnects, reduced motion and CPU/PvP play on the devices used by members.

Merging and deploying are separate. Nothing in this change deploys itself, rewrites
existing matches, modifies .env secrets, or changes upgrade backup/retention policy.
