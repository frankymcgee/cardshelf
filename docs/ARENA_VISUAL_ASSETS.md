# Arena illustrated tabletop — 0.27.0

The approved concept is the visual reference: a cozy collector room, a walnut
table with navy fabric, blue card backs, cyan printed zones, warm selection light
and a large private hand. The implementation uses separate decorative assets and
live Vue components; no flattened mockup replaces the game.

## Assets

All five images were generated for this update and encoded as locally served
WebP files. Combined download size is about 683 KiB. There are no new runtime
dependencies, image-service calls or third-party fonts.

| File in `public/arena` | Use |
| --- | --- |
| `collector-room.webp` | Dim shelving, plant, Poké Ball display, lamp and Pikachu figurine |
| `walnut.webp` | Horizontal walnut grain on the table frame and front rail |
| `navy-fabric.webp` | Repeating fine cloth under the printed field zones |
| `card-back.webp` | Blue vortex and Poké Ball back for private cards and counted piles |
| `training-art.webp` | Four-by-three atlas: Ember creatures, Tide creatures, Potion, Switch, Guide and Search |

The room was generated using the approved mockup as a reference. Materials were
generated as flat texture swatches. The back is an orthographic, text-free card
design. The atlas contains original teaching creatures and objects, with no
baked-in names, HP or rules. Original PNGs were resized/encoded with Sharp; the
shipped WebPs are the source assets used by the app.

`shared/arena-art.mjs` maps exact original training IDs to atlas positions.
Catalogue `image_url` values retain priority. An unknown catalogue card never
borrows a training illustration. Hidden cards do not render face artwork or
names. The same rule applies to disclosed discard tops.

## Layout and behavior

Only the field plane is projected. The hand, action dock, dialogs, drag ghost and
effects retain screen coordinates. The decorative perspective wrapper ignores
pointer events; its live plane restores them. The Stadium layer sits above the
adjacent field so its existing activation button stays clickable.

The page uses compact match chrome and moves the existing turn controls into the
right-hand action dock. Server moves, end-turn confirmation, private views,
selection, inspection and keyboard/touch controls retain their contracts.
Narrow containers keep a flat, scrollable layout. Reduced motion and forced
colours also flatten the field and remove perspective compensation margins.

## Review

`tests/browser/arena-preview-server.mjs` serves actual components. `/?art` shows
original Ember/Tide teaching artwork through the real components and shell;
it is a synthetic review fixture, not a production route or a saved game.
Both browser fixtures explicitly allow only the five image filenames.

Run the normal unit/render, typecheck, build, component/effects and signed-in
match workflows. Geometry coverage includes both seats, widths from 320 to
1440 pixels, projected hit targets, long hands, reduced motion, and the phone
touch-handle Bench drop. The added render check verifies disclosed training art,
hidden-card suppression and catalogue-image priority.
