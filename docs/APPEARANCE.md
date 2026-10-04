# CardShelf — variant visuals and binder appearance

## Variant effects

Holo uses layered rainbow sheen, fine sparkle and a light reflection within the
artwork window. Reverse Holo uses a diamond foil pattern across the surrounding
card stock, leaving that artwork window clear. Known Holo ex/EX printings use a
full-face prismatic finish with etched facets and star glints; other named Holo
mechanics use full-face rainbow sheen. Reverse Holo always keeps its artwork cutout.
These are decorative approximations, not exact physical foil masks for each card era.
Named ex / EX / GX / V / VMAX / VSTAR / BREAK suffixes receive separate text badges.
A named mechanic never implies a finish, rarity, price, authenticity or condition.
Normal and unspecified EX cards keep their badges without a foil overlay. There
are no mechanic-specific border outlines; the finish is rendered over the image.
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
disable the animation. Touchscreens retain the same visible static foil treatment.
There is no motion-sensor access, tilt script or continuous
animation across every card. Printing never adds foil effects to the placeholders.

## Binder appearance

Open a binder and select **Appearance**. Preview and save:

- **Inside pages**: solid colour or a custom wallpaper, background and pocket colours.
- **Outside cover**: a separate solid colour or wallpaper for the binder cover.
- Pocket transparency, wallpaper opacity, dim amount and 0–12 px blur.
- Cover, contain, centre or tiled wallpaper fitting.
- Variant effects mode and the default print-background option.

Each surface has its own image, fit, opacity, dimming and blur. Switch between the
two controls to preview each design; unsaved edits are retained while switching.
Outside covers appear on the binder shelf, dashboard, open binder header and shared
binder. The cover colour is the same setting used by **Binder settings → Cover colour**.
Changing it no longer changes the interior's fallback colour on older binders.
Existing tracking binders keep their simple checklist appearance.

Uploads and settings are saved together only when Save appearance is pressed.
Cancel discards the preview and pending upload. A stale binder revision is rejected;
Reload appearance discards unsaved edits and loads current settings. Switching to
Solid colour retains the saved image privately for later reuse. Remove wallpaper
on save deletes only that surface's stored image. Reset inside style / Reset cover
style restores defaults for the selected surface but does not delete an image.
Appearance edits never reallocate pockets or change collection quantities.

The appearance is applied to binder covers, pages and read-only sharing. Each wallpaper
is shared only while that surface's Wallpaper mode is active and a current sharing token is enabled. Rotating
or revoking the token revokes the old wallpaper endpoint, but cannot recall copies or
screenshots already made. Do not upload sensitive personal material to a shared binder.
Only upload imagery you have permission to use. No Pokémon artwork is bundled.

## Image processing and storage

JPEG, PNG and WebP only; input limit 5 MB and 20 megapixels. The server authenticates
the owner, throttles writes, validates type and magic bytes, fully decodes with sharp,
applies orientation and re-encodes to WebP at up to 2048 × 2048 within 2 MB.
Metadata is stripped. Animated multi-page images, SVG, arbitrary URLs and corrupt
files are rejected. A maximum of two decodes per application process is permitted.

A single bounded image per surface is stored in `binder_wallpapers` (inside pages)
and `binder_cover_wallpapers` (outside cover). Each keeps the same 5 MB input / 2 MB
optimised limit; the appearance endpoint permits a 14 MB JSON body so both images
can be saved atomically after base64 encoding. Other API body limits are unchanged.
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

Migrations 003 and 029 are additive. Existing binder colours, inside wallpapers,
pocket positions, ownership, prices and sharing tokens are retained. The existing helper takes a local safety
backup automatically. Do not regenerate .env or remove the database volume.

Cover images use the existing sharp 0.35.4 dependency. This update adds no new
dependencies, containers or server environment settings. The existing GitHub-built
AMD64/ARM64 images include the new migration and image routes.

Reload the browser after upgrading. Test one wallpaper, a colour-only binder, a
revoked shared link and a mobile page before rolling out custom themes widely.

## Verification

Local unit checks cover appearance bounds, type/size validation, conservative variant
classification, older-binder defaults, generated wallpaper routes and image processing.
The locked sharp 0.35.4 and Node 24 are used by release validation.
New API/PostgreSQL tests cover atomic saves, owner isolation, stale revisions,
private/shared image retrieval, revoked links, deletion and unchanged collection data.
CI also runs the existing pricing and set/series binder tests. Browser screenshots of
an isolated style fixture are not evidence that the real deployment was tested.

Primary implementation references:
- https://sharp.pixelplumbing.com/api-constructor/
- https://sharp.pixelplumbing.com/api-output/
- https://github.com/lovell/sharp/releases/tag/v0.35.4
- https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion

The variant-effects browser suite (`npm run test:variant-effects-ui`) exercises
the production binder and card dialog with local demonstration artwork. It checks
rendered pixels inside and outside the artwork mask, normal/unknown and missing
images, the appearance controls, keyboard/hover isolation, touch, reduced motion
and print output. Fixtures are demonstrations, not real catalogue or deployment data.

The cover suite (`npm run test:binder-cover-ui`) checks the production editor on
desktop and phone in light/dark themes, switching surfaces, saving, cancelling,
removing an image, conflict reload, and cover rendering on the shelf, dashboard and
shared binder. Database/API tests in `tests/integration/binder-cover.test.mjs` cover
legacy colour independence, dual uploads over the former combined request limit,
image isolation, stale saves, token revocation, independent removal and deletion.
