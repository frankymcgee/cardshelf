# Selected-printing wishlist shortcut — CardShelf 0.14.3

Open a card in CardShelf's card-details dialog. Select its exact printing in **Visualise printing**, then use **Add to wishlist** immediately below the decorative finish preview note. The operation saves immediately; **Save printing** is not required. **Remove from wishlist** clears that printing's wishes. Selecting another preview by itself never writes to the collection.

The control is shared by the authenticated catalogue and binder screens that use `CardDialog`. It is not added to the signed-out public `/explore` card reference page. It works with imported Pokémon, Magic and Yu-Gi-Oh! printings as well as supported manual printings. A decorative finish or artwork effect does not invent a new printing identity.

## Data behaviour

- Wishlist state is derived from the current user's saved entries for the selected printing, across all conditions. Another printing of the same card remains separate.
- Adding a missing wish uses a zero-quantity **Not assessed / UNKNOWN** entry, or marks an existing UNKNOWN row without changing its quantity or notes. It does not imply Near Mint condition or physical ownership.
- If a selected printing is already wished for in any condition, setting it to wished is a no-op. Removing clears all of that printing's existing condition-specific wishes in one transaction. It does not clear another printing's wishes.
- All quantities, notes, condition rows, binder pockets, collected marks, sharing tokens and subscription records are retained. Zero-quantity entries remain as revisioned rows after removal.
- The existing catalogue **Wishlist** filter, counts, import/export representation and pricing refresh selection use these same entries. No second wishlist store or database migration is introduced. Wishes with zero quantity do not increase collection market totals.
- The existing condition-specific Wishlist checkbox remains available in **Printings & ownership**.

## Safety and access

`POST /api/collection/wishlist` accepts only the selected printing ID, an explicit boolean wishlist state and the current condition/revision list. It never accepts a target user, quantity, notes, condition assignment or role. The route uses the authenticated user, the existing same-origin security middleware, bounded JSON and a per-user rate limit. It retains the same collection entitlement as the existing ownership editor; this release does not expand Collector or Free permissions. Pro/Plus, Complimentary and protected testers keep their established effective access.

The transaction uses the existing per-user collection lock and game-access check. Concurrent ownership edits or wishlist changes invalidate stale revisions. A stale request returns a conflict instead of overwriting another session. Repeating a current desired state causes no write.

The dialog blocks overlapping writes and retains unsaved quantity/notes fields when a shortcut succeeds. On a conflict, it refreshes saved state without automatically saving, discarding or rebasing stale ownership drafts. Review or reopen the card before saving those older drafts. Late responses cannot replace a different card or a reopened instance of the same card.

## Deployment

Apply the patch to its documented main-branch base, publish a feature branch and run both existing CI triggers before merging. No dependency, database, Stripe, SMTP or advertising configuration changes are required. Keep the existing server `.env`, including the migrated `APP_ORIGIN=https://cardshelf.cloud`, its hostname, secrets and database volume. Do not replace `.env` with `.env.example` or rerun the initial configuration script.

After merging a validated release, use the existing upgrade procedure. Reload the site, open a card, select a printing, add/remove a wish and verify the Wishlist filter. Confirm that owned quantity, binder progress and notes did not change.
