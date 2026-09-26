# Complete this binder

Open a binder and select **Complete this binder**. The page groups missing targets
by exact printing, shows their original pocket locations, and lets you search by
card, number, set or printing. Empty pockets are not collecting targets.

- **Collection binders** use actual owned printings, as their existing indicators do.
  One owned copy can light up repeated planned pockets; this does not allocate a
  physical copy to each pocket or require an extra purchase.
- **Tracking binders** use saved collected/missing marks independently of inventory.
  Owning a card does not silently mark the checklist. Design-based trackers explain
  that the displayed printing is a specific target and require confirmation before
  adding those printings to the wishlist.

Select individual rows or **Select all results**, then **Add selected to wishlist**.
Selection spans pages and can be cleared. Existing wishes are labelled and excluded
from new selections. The server adds zero-quantity, Not assessed wishes to the same
wishlist used throughout CardShelf. Existing quantities, conditions, notes, pocket
layouts, checkmarks and share links are preserved.

Bulk additions retain existing collection and managed-game permissions. Members
without wishlist access can still read their existing binder and, when their plan
includes marketplace browsing, view listing matches. This release does not change
plan prices or membership entitlements.

**View listings** shows only active, visible listings from other members for the exact
missing printing (which includes its language). Reserved, sold, withdrawn, hidden,
other-finish, other-language and your own listings are excluded. Results show the
seller alias, stated condition, AUD asking price, postage and pickup location, with
six results per page ordered by card asking price. Open the existing listing to
inspect its photos and send an enquiry. Availability is checked when listings open;
refresh the completion page to update its counts.

The endpoints are authenticated, owner-only and uncached. Selection snapshots are
checked under the same collection lock used by inventory and binder edits. A stale
bulk selection is rejected as a whole and the page refreshes for review. After an
uncertain response, refreshed wishlist badges show what was saved; a repeated fresh
request for already-wishlisted printings is a no-op.

Migration 026 adds an index for exact-printing listing lookups. There is no new
external provider, secret or host configuration. After the release is published,
use the normal `sudo sh scripts/upgrade.sh` command. Alerts, reciprocal trades and
public wanted-list sharing are later stages of this feature.
