# CardShelf 0.12.0 — themes, collection-backed tracking and approximate estimates

Base commit: `8ed84a37c6545a8414b7b7ade0103a53f0bb6192` (v0.11.1).

## Changes

- Light, Dark and System appearance, available in the desktop sidebar, mobile header and public website navigation. The initial default is System. The preference is local to this browser/device, not an account setting shared between devices. A same-origin head script applies it before first paint; the client follows OS changes and storage changes in other tabs. No paid dependency or external theme script.
- Opt-in conversion of an independent Tracking binder into a Collection binder **in place**. The name, ID, pages, pocket order and card identities stay unchanged. The converted binder opens in a new Quick tracking view; Layout view retains normal appearance/customisation. Existing Collection binders can also switch to Quick tracking.
- Quick “I have this card” claims use the shared collection, rather than an independent checklist flag. At least one existing owned copy, in any condition, satisfies the claim without incrementing quantities. Otherwise one copy is created with condition `UNKNOWN`, preserving existing wishlist and notes. Repeated pockets and different binders do not allocate or multiply physical copies.
- Cardmarket references can contribute to the collection market estimate and planned-binder estimate when a usable matched TCGplayer quote is unavailable. Their subtotal and quantity are separately labelled as approximate. Cardmarket references remain visible even when a matched TCGplayer quote is used instead.

No existing tracker is converted by the database migration. No billing setting, membership assignment, tester grant, subscription or referral record is modified.

## Access: Collector Pro / premium plans

The existing application uses internal plan codes `collector` and `plus`. It does not yet have a separate internal `pro` or arbitrary higher-tier hierarchy. This release gates collection sync on the effective **collection + binders + prices** capabilities, not on the name of a Stripe product. The existing premium (`plus`) plan and full-access testers/Complimentary users qualify. An enforced basic Collector account does not.

A product displayed as **Collector Pro** can continue to map to the existing premium tier with Stripe metadata `cardshelf_plan=plus`. This patch does not create/rename Stripe products or move subscribers between plans. New tier hierarchies require an explicit future entitlement change, rather than trusting product marketing text as authorisation.

## Using a tracking binder with collection ownership

1. Open the tracking binder and select **Enable collection sync**.
2. Review the conversion preview. Importing existing collected marks is optional.
3. For printing-specific checklists, an imported mark claims the displayed printing. If that printing is already owned, its quantities/conditions/notes are left intact. If not owned, it receives one Unknown-condition copy.
4. For design-level “any printing” checklists, importing marks starts OFF. Review the exact printing labels before enabling import and giving the separate confirmation. Alternatively convert without importing and use the detailed editor to select the actual owned printing later.
5. Confirm conversion. Old independent marks stop being the source of truth; collection ownership now determines all owned/missing indicators. Existing missing marks never remove inventory.

**Conversion is one way in this release.** There is no toggle to reconstruct the original independent marks. The preview warns before conversion. Use a backup before a bulk or important conversion.

The old sharing token is revoked during conversion, even if it was active. A new Collection-binder share can be enabled deliberately afterward. Public Collection shares continue to expose layout only: no quantities, notes, quick-add proofs, ownership tokens or live owned/missing flags.

### Quick actions

Tap a missing card and choose **+ I have this card**. The response updates the shared collection. Other collection-backed binders see that ownership on their next load; an open binder refreshes on window focus and about every 30 seconds when idle and visible. This is not a websocket/offline sync service.

A quick-created, unchanged single Unknown copy can be removed with **Remove quick-added copy / mark missing**. That removal affects the shared collection and consequently all collection-backed binder views. It preserves the zero-quantity row's notes and wishlist.

Detailed entries, multiple copies or subsequently edited quick entries must use **View card & ownership** for removal. A stale modal cannot silently remove a recently changed quantity. Adding/removing a pocket or deleting a binder does not remove inventory.

Writes are owner-checked and capability-checked on the server. They use the collection lock followed by the binder lock, optimistic binder/ownership versions, and replay records. Network/5xx retries retain the exact request ID. A replay returns the current ownership rather than replaying a historic flag.

## How Cardmarket contributes to estimates

Selection is deterministic, per printing/owned quantity:

1. Prefer a recent matched TCGplayer quote with a usable AUD exchange rate and no refresh error.
2. Otherwise select a Cardmarket reference for the same catalogue card. Prefer its holo category for an imported `holo` key; otherwise prefer the card-level category. An available other category is still only an approximation. Fresh observations are preferred when available.
3. Within a reference family, prefer trend, then 30-day average, 7-day average, average selling price, and 1-day average. One selected metric is used, not a sum or average of all metrics.
4. Last-known Cardmarket references remain eligible for an **explicitly approximate** total after stale/unknown source dates or a failed refresh. The subtotal and warning counters show that these values may be inaccurate. Stale and failed-reference counts may overlap; they are not additional owned copies.
5. No value is invented when the feed has none. A missing/expired AUD exchange rate still prevents conversion into the AUD total, while the original EUR reference remains visible.

A Cardmarket estimate does **not** verify the exact finish, edition, marketplace sale language, card condition or upstream card mapping. This includes manual/special printing labels: the approximation is not an exact printing quote. `quoteForPrinting()` and the original exact-price field remain strict; the API adds a separate `estimate` field. Catalogue badges continue to represent their original matched-price field.

Collection totals use actual owned quantities. Planned-binder totals count planned pockets, including duplicates. The additional **Owned cards represented in this layout** reference is capped by owned quantity per printing and is not physical-copy allocation.

This supersedes the v0.11.1 documentation's policy of excluding all Cardmarket references from totals. It reuses cached free-feed data and adds no paid pricing API, credential or new dependency. The existing refresh schedule/cooldown is unchanged.

## Apply the patch in Windows PowerShell

Save `cardshelf-0.12.0-themes-collection-sync-estimates.patch` to `C:\CardShelf\`.
Start inside the existing Git checkout. Run each check successfully before proceeding:

```powershell
$root = git rev-parse --show-toplevel
if ($LASTEXITCODE -ne 0) { throw 'Not inside a Git checkout.' }
Set-Location -LiteralPath $root

git status --short
# Stop and deal with existing tracked changes before switching branches.
git switch main
if ($LASTEXITCODE -ne 0) { throw 'Could not switch to main.' }
git pull --ff-only origin main
if ($LASTEXITCODE -ne 0) { throw 'Could not update main.' }
git switch -c feature/themes-collection-sync
if ($LASTEXITCODE -ne 0) { throw 'Could not create the feature branch.' }

$patch = 'C:\CardShelf\cardshelf-0.12.0-themes-collection-sync-estimates.patch'
git apply --check --index --verbose -- $patch
if ($LASTEXITCODE -ne 0) { throw 'Patch check failed. Do not force it.' }
git apply --index --verbose -- $patch
if ($LASTEXITCODE -ne 0) { throw 'Patch application failed.' }
git diff --cached --stat
git diff --cached --check
if ($LASTEXITCODE -ne 0) { throw 'Whitespace check failed.' }

git commit -m 'feat: themes, collection-backed tracking and approximate estimates (v0.12.0)'
if ($LASTEXITCODE -ne 0) { throw 'Commit failed.' }
git push -u origin feature/themes-collection-sync
if ($LASTEXITCODE -ne 0) { throw 'Push failed; the local commit is retained.' }
```

Create a PR into `main`. Do not reapply the old v0.11.1 patch. Wait for both GitHub validation runs before merging.

## Deployment after CI and merge

From the existing server checkout on `main`:

```sh
git pull --ff-only origin main && sudo sh scripts/upgrade.sh
```

Keep the existing `.env`, integration encryption key, database volume and accounts. The upgrade applies additive migration 012 and uses the existing backup helper. No theme configuration or new API key is required.

Acceptance: check all three theme modes on desktop and mobile, with saved binder wallpapers; convert an unimportant tracker first; test existing ownership, Unknown quick-add/removal and a detailed-condition entry; test the same printing in two binders; verify public sharing after rotation; confirm an actual cached Cardmarket-only card contributes a clearly labelled approximation. Test normal collection editing/imports and the appearance/layout view after conversion.

## Validation boundary

The patch was checked with local logic/configuration tests, an isolated strict script type-check harness, and browser component rendering with synthetic responses. The full repository Nuxt build/typecheck, PostgreSQL integration suite, Docker upgrade and real-device acceptance are not claimed by these local checks. Do not treat a previous release's green workflow as validation of this patch. See the accompanying validation report for the executed counts and limitations.
