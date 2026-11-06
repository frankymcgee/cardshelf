# Purchase costs, alerts and binder options

Open a card and choose its printing. **Purchase costs & sales** records costs by
condition and purchase lot. The amount is the total for the selected copies, with
postage entered separately. Uncheck **Also add these copies** when inventory was
already recorded. Zero records a known free/gift cost; missing costs stay unknown.
USD/EUR transactions require the historic AUD-per-currency rate entered by the
collector. CardShelf stores that rate and AUD amount with the transaction.

**Record sale** removes sold copies, allocates the original lot cost proportionally,
and deducts selling fees and postage from proceeds. Retry protection uses a stable
request ID, and both inventory and cost records commit together. Other inventory
tools cannot reduce quantity below tracked copies. To correct a purchase, release
its remaining cost tracking, then record the corrected cost. Release keeps copies
and prior sales. These are collector records, not marketplace payment processing.

**Portfolio → Insights** shows remaining known cost, copies with unknown costs,
realised profit/loss from recorded sales, and an unrealised estimate for tracked
copies with usable market values. Coverage and guide estimates are labelled.
Condition does not change the provider market quote. All cost records are private;
shared binder plans do not expose quantities or purchase costs. Database backups
include these tables; the existing collection CSV still covers inventory only.

For a wishlisted printing, open **Wishlist price & listing alerts** and set an AUD
target. Select market prices and/or member listings and acceptable listing
conditions. **Collection → Wishlist alerts** lists matches and saved rules. These
are in-app alerts; this rollout does not send email or push notifications.

The catalogue worker checks up to 100 due rules each pass. Market alerts require a
fresh exact quote with a fresh AUD conversion for a supported English printing.
Missing, failed, stale and guide prices cannot trigger or re-arm an alert. One
market match is recorded on crossing the target; a fresh above-target quote arms
it again. Member listing totals include advertised postage, match the exact
printing, and exclude hidden, inactive, own and wrong-condition listings. A
listing matches once per saved rule revision. Prices and availability may change
after a match. Wish removal, retired printings or lost membership/game access pause
checks. Ordinary imports must not be used as proof that a finish exists.

In **Binder → More → Settings**, enable **Start the first card page on the right**
for a blank visual inside cover. It does not consume pockets or shift page numbers.
It applies to private and shared two-page views; filtered quick checklists omit the
cover. Single-page mode shows actual card pages only. Collection binders can also
enable **Close gaps automatically**. Removing a planned card then compacts all
remaining planned cards in their existing order across pages, including repeated
printings. It does not change owned copies. Both settings default off for existing
binders. Missing printings appear grey in private Layout view as in Quick tracking.

Re-imports retire explicit false TCGdex flags, and migration 038 reconciles false
flags already present in stored provider data. Administrators can use **Correct
available printings** in card details to override inaccurate flags, or return a
printing to following the provider. Hidden choices stay available as archived
records where the collector has ownership, wishes or notes. Existing pockets,
inventory and price history are preserved. There is no global two-printing cap:
valid finishes vary by card, set and language.
