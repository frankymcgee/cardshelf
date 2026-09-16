# CardShelf 0.3.0 — variant visuals and binder appearance

## Variant effects

Holo uses a soft artwork-window sheen; Reverse Holo uses a patterned outer-card foil.
These are decorative approximations, not exact physical foil masks for each card era.
Named ex / EX / GX / V / VMAX / VSTAR / BREAK suffixes receive separate text badges.
A named mechanic never implies a finish, rarity, price, authenticity or condition.
Latin names such as Calyrex are not mistaken for ex. Full art, gold and promotional
status are not guessed from card images or rarity strings.

Exact provider printing keys Normal/Holo/Reverse drive effects. Verified manual
printings with canonical Normal/Holo/Reverse Holo labels are supported; other manual,
edition-unspecified and unknown printings retain their labels without guessed effects.
The catalogue shows available printing badges. When a design has several printings,
its generic image stays neutral: open the card to select the printing to visualise.
The binder and printing picker show the exact chosen printing. Missing artwork uses
a readable fallback with no foil animation. Ownership and pricing logic are unchanged.

Per-binder effects: Off (badges remain), Subtle (static), or Shimmer on hover/focus.
Only hovered/focused cards animate, only with a fine pointer; reduced-motion requests
disable the animation. There is no motion-sensor access, tilt script or continuous
animation across every card. Printing never adds foil effects to the placeholders.

## Binder appearance

Open a binder and select **Appearance**. Preview and save:

- Solid colour or a custom wallpaper; background and pocket colours.
- Pocket transparency, wallpaper opacity, dim amount and 0–12 px blur.
- Cover, contain, centre or tiled wallpaper fitting.
- Variant effects mode and the default print-background option.

Uploads and settings are saved together only when Save appearance is pressed.
Cancel discards the preview and pending upload. A stale binder revision is rejected;
Reload appearance discards unsaved edits and loads current settings. Switching to
Solid colour retains the saved image privately for later reuse. Remove wallpaper
on save deletes the stored image. Reset style restores defaults but does not delete
an image. Appearance edits never reallocate pockets or change collection quantities.

The appearance is applied to binder pages and read-only sharing. Wallpaper is shared
only while Wallpaper mode is active and a current sharing token is enabled. Rotating
or revoking the token revokes the old wallpaper endpoint, but cannot recall copies or
screenshots already made. Do not upload sensitive personal material to a shared binder.
Only upload imagery you have permission to use. No Pokémon artwork is bundled.

## Image processing and storage

JPEG, PNG and WebP only; input limit 5 MB and 20 megapixels. The server authenticates
the owner, throttles writes, validates type and magic bytes, fully decodes with sharp,
applies orientation and re-encodes to WebP at up to 2048 × 2048 within 2 MB.
Metadata is stripped. Animated multi-page images, SVG, arbitrary URLs and corrupt
files are rejected. A maximum of two decodes per application process is permitted.

A single bounded image per binder is stored in the new binder_wallpapers table.
Normal PostgreSQL backups include it; no additional filesystem volume, image API or
API key is needed. Deleting a binder cascades to its image. CardShelf's API serves
wallpapers with no-store and same-origin resource headers, after owner or share-token
checks. Image bytes are not included in catalogue, binder-list or shared JSON responses.
This is not a general-purpose file upload service or a card-scanning feature.

## Printing

Print placeholders has a **Binder background** checkbox, initially using the binder's
saved preference (off for existing binders). Leave it off for an ink-friendly page.
The existing 63 × 88 mm cards and A4 layout remain unchanged. With backgrounds enabled,
text sits on a light translucent mat; enable browser Background graphics if required.
Checklists remain plain. Printed output never contains animated effects.

## Upgrade

After merging the tested appearance PR, run from the existing server checkout:

```sh
git pull --ff-only
sudo sh scripts/upgrade.sh
```

Migration 003 is additive. Existing binder colours, pocket positions, ownership,
prices and sharing tokens are retained. The existing helper takes a local safety
backup automatically. Do not regenerate .env or remove the database volume.

This release adds sharp 0.35.4. Docker reconciles an older retained dependency lockfile
with the release manifest inside its build image, then installs using npm ci. This
neither edits nor deletes the host lockfile. The application image retains the resolved
lockfile for inspection. No new containers or server-side Node installation are required.

Reload the browser after upgrading. Test one wallpaper, a colour-only binder, a
revoked shared link and a mobile page before rolling out custom themes widely.

## Verification

Local unit checks cover appearance bounds, type/size validation, conservative variant
classification, older-binder defaults, generated wallpaper routes and image processing.
The available local sharp is 0.34.1; CI must validate the pinned 0.35.4 with Node 24.
New API/PostgreSQL tests cover atomic saves, owner isolation, stale revisions,
private/shared image retrieval, revoked links, deletion and unchanged collection data.
CI also runs the existing pricing and set/series binder tests. Browser screenshots of
an isolated style fixture are not evidence that the real deployment was tested.

Primary implementation references:
- https://sharp.pixelplumbing.com/api-constructor/
- https://sharp.pixelplumbing.com/api-output/
- https://github.com/lovell/sharp/releases/tag/v0.35.4
- https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion
