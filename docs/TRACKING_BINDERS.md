# CardShelf 0.5.0 — tracking binders and planned membership features

## Two binder types

**Tracking binder (Collector)** is an independent collected/missing checklist.
Choose **Binders → From set / series → Tracking binder**, select imported sets and
preview the layout. Every generated card starts missing, even when a copy exists
in the detailed inventory or in another tracking binder. Tap a card, then **+
Mark collected** to restore full colour. Select it again and **Mark missing** to
undo the mark without removing the checklist position.

One-per-design checklists accept any printing of that card. One-per-printing
checklists track each displayed printing separately. Imported printing flags are
not a guaranteed complete master checklist. Partial imports still require explicit
acknowledgement; future imports do not silently rebuild an existing binder.

Search by name, collector number, set or printing. All/Missing/Collected filters
and progress are calculated from saved checklist marks, excluding empty pockets.
Filtered results retain their original page/pocket labels. Large generated layouts
keep the existing automatic numbered-volume split. Each volume has its own progress.

Blank trackers are also supported: choose the grid/page count at creation, then
add checklist targets to empty pockets through the card picker. Duplicate printing
targets, replacing filled targets and moving/clearing checklist positions are
rejected. Tracking layout and appearance stay fixed after creation; title and
description remain editable. There is no in-place type conversion in this release.

**Collection binder (Collector Plus)** is the existing detailed binder editor.
It retains prices, condition/quantity records, rearranging pockets, colour and
wallpaper customisation, variant effects and the other existing tools. All older
binders are migrated to this type without altering their layouts or inventory.

## Checklist marks are not inventory

A tracking mark does NOT create or change `collection_entries`, condition, quantity,
notes, price history or a physical-copy allocation. Detailed inventory totals and
collection exports do not count tracker marks. This makes trackers useful as
independent collecting goals without double-counting cards across binders.

The database backup includes tracker marks and layouts. Tracking print/checklist
filters use those marks, not the global inventory's owned flags. Printed checklists
can show collected ticks when the missing-only filter is disabled.

Sharing a tracking binder deliberately exposes its checklist progress and collected
marks via the existing revocable link. The sharing dialogue explains this before
sharing. Account details, global quantities, conditions, notes and other binders
remain private. Existing Collection-binder shares keep their original behaviour.

## Plans and existing testers

`shared/binder-types.mjs` defines the planned capability split:

- Collector: tracking binders, set/series generation, read-only sharing and printing.
- Collector Plus: all Collector capabilities plus detailed collection/quantity and
  condition records, pricing/history, custom layouts/wallpapers and inventory imports/exports.

The public Plans page describes that split without publishing a charge or checkout.
Default unpublished draft descriptions are updated only if not already edited.
Custom admin descriptions, price drafts and tester memberships are preserved.

BILLING_ENABLED and ACCESS_ENFORCED remain false. All existing and newly invited
testers retain both binder types and every current feature, regardless of subscription
metadata. This release does NOT sell plans, activate billing, expire testing grants,
assign plans to users, impose a new paywall or add scanning/AI functionality.

## Persistence and safety

Migration 005 is additive. It adds `binders.binder_type` (default `collection`),
`binder_slots.is_collected` (default false), and replay records tied to each binder.
Mutation uses the authenticated owner, a locked binder row, expected revision,
expected printing ID and an explicit boolean target state. A request ID is retained
for safe retries after uncertain network errors. An old successful request replay
returns the CURRENT state rather than undoing a later mark. A conflicting new edit
returns 409 and reloads the checklist. This is online editing, not offline sync.

Tracking-only targets do not schedule price refreshes. Cards independently owned,
wishlisted or planned in Collection binders continue to refresh normally. Tracking
binders have no valuation or appearance-edit endpoint; this is a binder-mode boundary,
not a new subscription restriction on testers.

## Upgrade and verification

After this release's complete GitHub validation passes and the PR is merged, run
from the existing server checkout on main:

```sh
git pull --ff-only origin main && sudo sh scripts/upgrade.sh
```

The upgrade helper builds first, takes its automatic local safety backup, applies
migration 005 and restarts the app/worker. Do not regenerate .env or remove volumes.
No new dependencies, containers, keys, payment services or account migrations are required.

Verify a generated tracker starts grey, + Mark collected persists after a reload,
Mark missing reverses it, filters/progress agree, and shared/print views reflect it.
Also open an existing Collection binder and check that pricing, conditions and
wallpapers remain available to an existing tester.

Unit tests cover mode validation, marks, plan definitions, default state and preview
identity. API/PostgreSQL tests cover migration preservation, private access, persistence,
retries, concurrent edits, sharing, filtering data, type boundaries, price scheduling
and unchanged detailed inventory. CI must run the full existing suite alongside these
new tests. Local styling fixtures are not compiled-app or real-device acceptance tests.

Implementation references: PostgreSQL 17 explicit locking documentation and the
existing CardShelf binder/ownership API contracts.
