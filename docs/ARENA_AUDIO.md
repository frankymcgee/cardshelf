# Arena sound effects — 0.52.4

Open **Table tools → Sound & music** in a match and select **Enable audio**.
Sound effects and background music have separate switches and volume controls.
Choose a sound under **Sound preview**, then select **Preview sound** to hear it.
Preview is available only while audio and effects are enabled with nonzero volume.

Twelve new cues distinguish drawing cards, attaching Energy, playing to the Bench,
evolution, Trainers, switching/retreating/promoting, taking Prizes, abilities and
Stadium activation, healing, condition/effect damage, missed attacks and shuffling.
Existing selection, card handling, attack, Knock Out, coin, turn and result sounds
and both music tracks remain available.

Sounds follow acknowledged public events. One cue represents each server update:
a major battle event has priority over routine movement, and a resolved Trainer
effect has priority over its initial card-play sound. No sound identifies a hidden
card or reads an opponent's hand. There is no delayed queue of past actions.
Initial loads, duplicate refreshes and incomplete or long reconnect histories
stay silent. Gameplay and match timing do not wait for audio.

Audio starts only after explicit activation in each newly opened or reloaded
table. It pauses when the tab/window is hidden or unfocused and stops on navigation
or loss of match access. Mute stops music and effects. Preferences remain local to
the browser; enabling effects does not enable music. Mobile browsers may also
require the device's sound settings to allow playback.

All media is self-hosted from `/audio/arena/`. The new WAVs are original oscillator
and seeded-noise synthesis, without downloads or recordings from another game.
To reproduce them, run `python3 scripts/generate-arena-effects.py`; Python is not
needed in the deployed application. `manifest.json` records the hashes and
`CREDITS.txt` retains the sources for the existing CC0 interface samples.

Validation includes event mapping/priority and audio lifecycle unit tests,
production HTTP media-byte/content-type checks, and signed-in Chromium/WebKit
tests of preview, an actual acknowledged action, refresh deduplication, mute and
activation after reload. These checks do not certify physical-device speakers or
subjective sound balance; those are best reviewed using the preview controls.
