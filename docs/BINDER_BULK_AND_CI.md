# Binder product exclusives and release workflow

## Bulk pocket changes

On a private binder, choose **Product exclusives**, select imported sets and choose Add or Remove. Preview the counts, numbered pocket changes and required pages before applying. Only confirmed `product_exclusive` rows are added or removed. Promotional and unconfirmed printings are unaffected; retired catalogue choices cannot be newly added.

Both Collection and Tracking binders support this operation. Each existing set keeps its relative group order. Within each set, cards sort naturally by collector number, then printing finish; existing duplicate pockets retain their individual marks. Removal closes gaps across pages even if automatic gap closing is otherwise disabled. Addition inserts extras into their numbered position and moves later pockets along. Page count can grow to fit, up to 60 pages; existing page capacity and the blank inside cover preference are retained. Oversized changes fail without writing anything.

Recorded quantities, conditions, notes, wishlist flags, purchase costs and completion scope stay intact. Newly added Tracking pockets start uncollected. An extra added to a regular-scope binder remains excluded from completion until the owner changes the scope in Settings. Removing all pockets retains the selected set IDs so the same extras can be restored later.

Preview tokens cover layout and catalogue data. Apply takes the existing collection/binder locks and checks the saved revision and preview again. A request ID makes retries safe after a lost response; replaying an old request never rearranges a newer layout. Classification changes, conflicting edits and stale previews require another preview.

The **Layout view / Quick tracking** switch is visible above the cards for Collection binders with collection-sync access. **More** retains sharing, printing and settings.

## CI and images

| Event | Automatic work |
| --- | --- |
| Pull request opened or updated | Unit, type, application build, database/integration and browser tests; Arena checks through their PR workflows. No Docker images. |
| Merge or push to `main` | Native AMD64/ARM64 Docker image builds, container runtime/migration/backup/upgrade verification, then publication of those exact tested images. No repeat of the application test suites. |
| Explicit manual workflow run | Validation can be rerun manually; image release can be rerun for `main` only. |

`.github/workflows/ci.yml` runs PR validation. The Nuxt application build remains necessary for integration/browser tests and is distinct from building release container images.

`.github/workflows/images.yml` runs on main-branch pushes after merge. Both architectures must pass image verification before publishing. The publisher downloads the saved, tested image archives, rather than rebuilding them; it promotes the version, commit and `stable` multi-platform tags. Artifact transfer checks run in this release workflow, rather than on every PR. The existing standalone Arena PR workflows are no longer called again after merge.

Direct pushes to `main` also trigger image release; application tests run through the PR path. Use PRs for application changes. This change does not alter branch protection settings.
