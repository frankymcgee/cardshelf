# Consolidated navigation, Complimentary Arena access and local audio — v0.18.0

## Navigation

The signed-in workspace now has five primary destinations on desktop and mobile:

| Destination | Contents |
| --- | --- |
| Home | Existing collection overview. |
| Collection | Cards & wishlist, binders, selected card games and the public catalogue. |
| Market | Existing marketplace, with its seller and enquiry controls unchanged. |
| Arena | Automated Arena, including deck building and tutorials. |
| More | Account, membership, referrals, data/settings, website, theme and sign-out. Administrators also get an Administration group. |

Collection and More open a native modal dialog. It is a bottom sheet on mobile and a centred card menu on desktop. The header and close button remain fixed while the contents scroll. Escape/backdrop closes the sheet, keyboard focus is contained, and normal page scrolling resumes after closing. Choosing a destination, signing out, or changing account/role closes the menu.

The mobile header has one account/avatar button. Theme and sign-out are inside More. Desktop uses the same destination definitions rather than maintaining a separate route list. Existing routes and permission checks remain authoritative; hiding administrative links is not the security boundary.

Public marketing navigation is unchanged. The Arena retains its dedicated tabletop layout. Its Help, History, Refresh and new Sound & music controls are grouped under **Table tools**.

## Complimentary access

A valid explicit administrator assignment to **Complimentary** now qualifies for Arena alongside Collector and Collector Plus. No Stripe payment is required for Complimentary.

Assign the tier using **More → Administration → Memberships & referrals**, then choose Complimentary for the existing account. Retain the existing billing-unchanged acknowledgement. Tier assignment does not create or cancel a Stripe subscription.

The global Arena enabled/paused setting still applies. There is no new per-player beta approval requirement. Existing Collector/Plus Live paid periods and valid explicit assignments keep working. Free accounts, unassigned administrator roles, old beta approvals and generic testing-policy fallback alone do not grant Arena access. An administrator wishing to play can also have an explicit Complimentary assignment.

No existing account is automatically assigned a new tier. Revoking an assignment prevents subsequent protected Arena operations without deleting that account's decks or matches. This update does not expand the automated card-effect support pool or change game rules.

## Assisted beta retirement

The old `/battle` and `/admin/battle` interface is retired. Direct browser visits (including old deck and match links) redirect to `/arena` or `/admin/arena`. Old match identifiers and invitation parameters are not forwarded: assisted and automated matches use incompatible state formats.

After the original authentication/origin checks, old `/api/battle/**` and `/api/admin/battle/**` operations return HTTP **410 Gone** with an Arena destination. The older admin API remains administrator-only. A saved beta approval or enabled beta switch cannot reactivate those routes.

The database tables, saved decks, matches and audit history are retained, not dropped. Legacy source/engine tests are retained for the archives, but its old UI and API are no longer an active product entry point. Previously active assisted matches cannot be resumed through that interface.

The Arena deck workshop still offers **Copy an archived deck**. This imports a copy into an Arena draft for validation; it does not change the original deck or make unsupported effects playable. Old matches are not automatically converted, scored or declared finished.

## Arena audio

Open a match, expand **Table tools**, then use **Sound & music**.

- Select sound effects, background music, a track and separate volume levels.
- Choose **Enable audio** once in that document. Remembered preferences do not automatically start media playback.
- Choose **Mute audio** to stop. Audio also stops when leaving the page or losing access and pauses while the tab/window is hidden or unfocused. Browser autoplay restrictions may require enabling audio again after a focus/device change.

Only the audio preferences are saved under the browser-local `cardshelf-arena-audio-v1` key. No private hand, match state or account identifier is saved there. Audio does not modify game actions, and playback errors do not prevent gameplay. Effects are limited to three overlapping clips and are based on already-visible match events. Initial history and large reconnect backlogs are not played as a burst.

### Included recordings

| File/group | Origin |
| --- | --- |
| `kenney-click.wav`, `kenney-card.wav` | Kenney Interface Sounds, CC0; unchanged WAV samples from the Calinou distribution. |
| Attack, Knock Out, coin, turn, victory and defeat cues | Original synthesized audio made for this update. |
| Quiet table | Original 32-second gentle background loop. |
| Pulse table | Original 24-second rhythmic background loop. |

Everything is bundled in `public/audio/arena/` and served by CardShelf. There is no third-party streaming, tracking, paid audio API, runtime download script or extra container. Music is opt-in and is not loaded until it is enabled. The original tracks are not Kenney compositions and are not excerpts from any Pokémon or other commercial-game soundtrack.

Sources, licence notices and SHA-256 integrity records are in `CREDITS.txt`, `KENNEY-LICENSE.txt` and `manifest.json`. The public media files are not secrets; the Arena itself remains access-controlled.

Primary source references:

- Kenney Interface Sounds: https://kenney.nl/assets/interface-sounds
- Kenney commercial-use clarification: https://kenney.nl/support
- CC0 summary: https://creativecommons.org/publicdomain/zero/1.0/
- Source WAV distribution: https://github.com/Calinou/kenney-interface-sounds
- Browser autoplay behaviour: https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay

Other optional sources are listed in the credits but are **not** included recordings. Review the licence for any new asset before distributing it.

## Deployment and checks

This release has no schema migration, new package dependency, secret, paid API, exposed port, or billing change. Existing `cardshelf.cloud` environment settings are untouched; do not rerun initial configuration or replace `.env`.

Apply the exact patch to its documented base on a new feature branch. Wait for the full GitHub push and PR validation runs before merging. After merging, use the existing upgrade script; no special audio installation step is needed because the media is included in the binary-capable Git patch.

Check on the deployed installation:

1. Open Collection/More on mobile and desktop; navigate to every group, close with Escape/backdrop and check scrolling, dark mode and keyboard focus.
2. Confirm normal users cannot access admin endpoints even when entering URLs manually.
3. Check an explicitly assigned Complimentary account can create/join an Arena match while Free remains blocked. Confirm the Arena pause switch still works.
4. Verify old beta routes redirect/return 410 and archived deck-copying remains available.
5. Test both tracks and effects on real Android/iOS and desktop devices, including mute, focus changes, reconnect and navigation. CI/browser decoding is not a substitute for listening on actual devices.

The accompanying validation report distinguishes selected local logic/component tests from the full hosted build and PostgreSQL/API suite.
