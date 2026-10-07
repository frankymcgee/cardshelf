# Arena card animations (0.48.0)

CardShelf uses mint/gold selection waves, short projected card lunges, geometric
impact rings and six sparks. Colours follow the disclosed Pokémon's type. These
effects are implemented with CSS and the existing confirmed-view renderer; there
are no imported Hearthstone artwork, frames, sound files or animation assets.

## At the table

- Hover a card with a mouse to lift it. Click or tap to select it, with a brief
  expanding outline. Hand cards settle above their neighbours. Selection still
  opens the existing move tray and requires its normal play confirmation.
- Confirmed plays fly between measured disclosed positions and pulse on landing.
  Newly revealed opponent cards receive a public destination pulse, without a
  guessed private-hand flight. Energy/Tool attachments pulse on the receiving
  Pokémon; evolution gets a rotating geometric burst.
- Attacks show a short lunge using the current disclosed attacker's artwork,
  a type-coloured trail, expanding rings and the exact logged damage number.
  Removed/Knocked Out targets receive no card-targeted damage effect that could
  be mistaken for their replacement. Knock Outs instead receive a table banner.
- Healing, conditions, Abilities, coin flips and Stadiums retain their confirmed
  feedback. Turn changes and results receive a brief table banner.

**Motion: Full/Reduced** switches between the complete animation and static cards
with the textual battle recap. **Battle effects: Off** also disables local selection
movement. Both controls apply for the current table visit. OS reduced motion takes
priority over Full mode. The same wrapper serves tournament spectator tables.
All decorative content is inert and hidden from assistive technology; the existing
polite live region provides accessible battle announcements.

## Timing and state

Artwork comes only from the current disclosed view. Animation metadata stores IDs,
anchors and geometry, not historical artwork or private hands. Draws and Prizes
remain anonymous backs. Effects never compute damage, submit actions, block input
or delay prompts. Duplicate polls don't replay animation. New updates replace the
current effects, and scroll/resize, blur, reconnect or navigation clear them.

Card travel and lunges last at most 640 ms. Other decoration clears within 1.4
seconds. Each update is limited to eight flights, six impacts, six bursts (six
sparks each), and one banner. Mobile hides two sparks per burst. Offscreen or clipped
anchors skip the corresponding visual. Idle cards don't run particle loops.

## Validation and upgrade

Run `npm test`, `npm run typecheck`, `npm run build`, `npm run test:arena-ui` and
`npm run test:arena-effects`. The existing GitHub Arena table workflow covers the
actual components in Chromium and WebKit, including both seats/rules versions,
touch scrolling, motion controls, private draws, reconnects and exact damage.
The signed-in match workflow continues to exercise the normal production build.

No packages, environment settings or database migrations are required. Merge the
PR and use the normal GitHub build/upgrade process. Older Phase 4 documentation
describes the initial 460 ms travel; this release extends it to 640 ms and adds the
new card/impact feedback and motion control described here.
