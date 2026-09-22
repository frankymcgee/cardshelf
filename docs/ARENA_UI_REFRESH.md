# Arena UI refresh

## Phase 2 — reusable components and interaction (0.22.0)

Phase 2 builds on the merged Phase 1 opposite-table layout. It changes presentation
and selection/inspection only, not the card compiler, rules engine or persistence.

### Components

ArenaBoard remains the match page's compatible entry point and event boundary.
ArenaTable supplies the table surface and tutorial focus hook. ArenaPlayerZone and
ArenaFieldZone render the opposed Active/Bench zones in DOM order. ArenaCardStack
accepts only public counts for deck/Prize/hand backs; ArenaDiscardPile emits an
inspection event. ArenaHandFan is supplied only the seated player's hand.

The private hand has a bounded overlapping fan for ordinary hands, lifting a card
on mouse hover, keyboard focus or selection. Large hands use a straight scrollable
row. Left/Right and Home/End move focus; Enter selects. No pointer/touch gesture is
prevented and a tap only selects. Selection is local and makes no API request.
Reduced-motion removes fan transforms and transitions.

ArenaActionTray lists only the selected card's server-provided moves, forwarding
the original action unchanged to the existing guarded writer. On mobile it docks
above the safe area without the old jump to an off-screen inspector. Inspect opens
a larger ArenaCardPreview; the same preview also supplies desktop details. Attached
Energy, Tools and evolution cards retain inspection and parent navigation. A newer
snapshot clears selected cards that have left the disclosed view. Opponent hands
are excluded from the inspector index, even if unexpected extra fields are present.

ArenaModal uses a native dialog with a persistent close header, contained body
scrolling, Escape handling and focus restoration. Discard inspection uses the same
modal infrastructure. ArenaPromptModal wraps the existing typed ArenaDecision:
Back to table minimizes it without choosing/cancelling a move, and Resume decision
retains in-progress choices. Equal-revision polling preserves choices; a new
acknowledged revision separates even consecutive same-shaped decisions.

No new runtime or test dependency, migration, billing/Postal configuration change,
optimistic game-state update or local rules implementation is introduced. Existing
idempotency keys, lost-response retries, revision checks, match access and CPU/PvP
boundaries remain in place. Drag-and-drop and card-travel/attack effects are deferred.

### Validation

```sh
npm test
npm run typecheck
npm run build
npx playwright install --with-deps chromium webkit
npm run test:arena-ui
```

The original Validate CardShelf workflow still performs the full unit suite,
Nuxt typecheck/build, migrations and API integration on disposable PostgreSQL.
The Arena table workflow compiles actual Vue components and loads the application,
Arena, table and interaction styles through a localhost-only synthetic fixture.
Its source allowlist is limited to the Arena components, named styles and fixture
modules; it is not a production route or a filesystem proxy.

Retained checks cover both seats at 320/390/768/1024/1440px, DOM/visual order,
Bench/discard target sizes, horizontal page overflow, private cards, Core snapshots,
setup, Stadium payload/lock and reduced motion. Added coverage checks fan focus,
explicit actions, modal focus/Escape/return, minimization and identical-poll choice
retention, new-decision resets, long search prompts, shrinking hands and touch taps.
Actual match-page script regressions verify selection, invalidation and wiring to
the unchanged guarded request/retry mechanism. Source-only layout checks were moved
to the extracted component boundaries; their behavioral/render coverage is retained.

Use the PR's Actions results and validation comment as the execution record. Test
source is not proof of a passing run. Browser evidence is retained in the
arena-table-ui-evidence artifact. Automated screenshots are not manual visual
acceptance. Touch emulation verifies taps and scroll-container availability, not
physical swipe momentum, device safe areas or a signed-in complete game.

### Review before deployment

On a test installation resume both Core and Expanded matches. Select/inspect cards
and attachments, play an Energy/Trainer/attack through the tray, inspect both
public discard piles, minimize/resume a required decision, and exercise a large
hand. Test iOS/Android portrait and landscape and desktop keyboard navigation.
Check the paused/retry controls after a dropped connection and confirm no double
moves. Preserve existing .env, the database and integration key.

## Phase 1 — opposite-table foundation (0.21.0)

The opponent sits above the player. Each side has five Bench positions, an Active
Pokémon nearest the centre, and separate deck, discard and Prize zones. The shared
Stadium and turn caption sit between the two fields. The private hand remains below
the player's field with native horizontal scrolling.

Depth is applied to the table surface, not to the card faces. Narrow tables move
piles to a compact shelf to preserve usable field targets. Empty piles remain
labelled; opponent hand backs and Prize decorations use bounded public counts only.
Core snapshots without a Stadium field remain supported.

Phase 1 established the board CSS and responsive Chromium/WebKit fixture. Its
server rules, saved matches, database and action contracts were unchanged. Phase 2
retains that foundation and splits the presentation into reusable components.

Merging and deploying are separate operations. This source neither deploys itself
nor resets saved matches.
