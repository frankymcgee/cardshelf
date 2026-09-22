# Arena UI refresh — Phase 3 (0.23.1)

## Interaction, not a second rules engine

This phase builds on the Phase 1/2 table and reusable components. The existing
ArenaBoard select/discard/action event contract and the match-page guarded writer
are unchanged. No engine, compiler, API, database, dependencies, permissions,
collections, billing or Postal settings are changed.

Playable hand indicators and destination outlines come from the current server
legal list. The client routes setup Active/Bench placement, normal benching,
Energy, evolution, Tools, targeted Trainers, shared Stadiums and other Trainers
to visible zones. It does not decide whether an effect is legal, choose hidden
cards, manufacture targets, calculate damage or pay costs locally. Unknown action
shapes and undisclosed targets have no drag route. Field attacks, retreats and
Abilities continue through the existing action tray; they are not freeform drags.

## Controls

With a mouse, drag a highlighted hand card at least eight CSS pixels to begin.
The selected card's legal destinations have dashed outlines; the current valid
destination has a solid outline. A private, noninteractive card preview follows
the pointer. The page scrolls in bounded steps near the viewport edges while a
drag is active. Releasing over a valid destination opens Confirm card play.
Releasing elsewhere cancels without a game request or a local board move.

Touching a card face still selects or scrolls normally. Touch dragging starts only
from the explicitly labelled Drag selected card handle, whose touch-action policy
is isolated from the card faces and hand/page scroll areas. Choose target is a
keyboard/tap alternative and opens the same confirmation. A tap or keyboard
activation of the drag handle also offers that non-drag path.

Confirmation displays the actual server move and its destination. Only pressing
a confirmation button emits the original action object, once, to the existing
request/revision/idempotency workflow. The local review is cleared before emit.
Searches, costs and replacement decisions still use the established typed prompts.
The original action tray remains a direct alternative to this optional workflow.

## Cancellation, privacy and feedback

A changed disclosed-table stamp, selection change, pending-action/network lock,
new prompt, finished match, visibility loss, resize, window blur, additional pointer,
pointer cancellation or genuine lost capture clears the local intent. The implicit
touch-capture transfer from the handle to the surface is not treated as cancellation.
Escape cancels a live drag; the native review dialog supports Escape, focus
restoration and a persistent close control. Identical polling preserves review.
Confirmation rechecks the latest visible hand and legal list; the server remains
the final authority even when a revision changes without a different visible table.

The stamp never reads an opponent hand, a deck or Prize list, or descendants of a
face-down unit. Drag previews come only from the seated player's currently visible
hand. No new storage, analytics or network calls are added. Listener, pointer
capture and animation-frame cleanup happen on unmount. Follow-on pointer clicks
from a completed drag are suppressed without blocking keyboard activation.

Public hand/deck/discard/Prize count changes receive a short text-highlight effect.
Outgoing count text is removed immediately so rapid updates show one current value.
The highlight does not animate on initial rendering or identical values. Reduced
motion turns that feedback off, retaining static playable/target indicators.
Full card-travel, attack, damage and cinematic effects remain Phase 4.

## Validation and acceptance boundary

Run the existing full application workflow and `npm run test:arena-ui`. The latter
retains all 42 Phase 2 browser cases and adds Phase 3 cases in Chromium/WebKit plus
a Chromium-only CDP touch-input drag check. The separate bounded page-startup
fixture is retained; UI test timeouts remain 30 seconds and retries remain zero.

New unit tests exercise exact action routing for both rules versions/seats, typed
setup targets, public opponent Trainer targets, locks/prompts, malformed shapes,
poisoned private getters, identical polling and changed snapshots. Component-script
tests exercise threshold/capture/cleanup, confirmation-once, cancellation, stale
intents, capture transfer, touch-handle state and keyboard alternatives. Browser
tests exercise actual mouse drags, target outlines, confirmation/no optimistic
moves, payload identity, Escape, stale review, singular count replacements and
touch taps into the non-drag alternative. The extra CDP test supplies browser touch
input to exercise handle capture, movement, release, review and explicit confirmation.

Use the PR's Actions results as the executed validation record, not this document
or test source. Component fixtures use synthetic cards and do not replace an
authenticated full-match test or physical-device acceptance. In particular,
Chromium touch-input emulation is not physical iOS/Android validation. Test drag
capture, swipe momentum and safe-area behaviour in portrait/landscape with long
hands and the fixed action tray before broad rollout. Nothing here deploys
automatically or changes an existing installation's .env or saved matches.
