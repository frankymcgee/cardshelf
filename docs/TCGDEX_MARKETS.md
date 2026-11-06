# TCGdex market pricing

CardShelf already obtains Pokémon pricing from TCGdex's `pricing` response. The
market integration documentation is https://tcgdex.dev/markets-prices. There is
no additional API key or marketplace account to configure. Magic and Yu-Gi-Oh!
continue using their existing feeds. `PRICE_REFRESH_HOURS` controls the existing
bounded worker queue; no catalogue-wide fetch is added.

Version 0.62 reads the live `variants_detailed` payload as well. For ordinary
normal, holo and reverse printings, it prefers a single compatible standard-size
variant and selects only that finish from its pricing block. A block may contain
several finishes, so flattening all of them would misprice cards. Different
stamps, subtypes, jumbo sizes and named foil patterns are not ordinary finish
aliases. Ambiguity or disagreement between product IDs prevents that match.
When detailed data is absent, legacy card-level finish matching is retained.

TCGplayer market prices drive eligible matched values. Low, mid, high and direct
asking prices appear separately under **More TCGplayer prices**. They never
substitute for a market value or trigger alerts. Numeric product links point to
the provider's product page. TCGdex's supplied mappings are not independent proof
of a listing, language, condition or actual sale. Cardmarket aggregates remain
labelled guides even when repeated inside a detailed variant block.

**TCGdex feed status** shows when each marketplace was checked, last returned
usable observations and updated its data. A valid HTTP response can omit one or
both marketplaces. CardShelf retains the previous observations with their own
receipt and source timestamps and marks them as last-known. Older responses also
cannot replace newer observations. Retained exact quotes do not contribute to
matched collection values or activate market-price wishlist alerts. Existing
last-known Cardmarket guide policy remains visibly approximate. A valid fresh
response restores normal use. Missing metrics within a usable provider snapshot
are removed rather than manufactured from another metric.

Only newly accepted provider observations write price history. Marketplace
product/variant mapping changes count as coverage changes in portfolio history,
rather than spurious gains on retained copies. No past ownership or daily sales
series is reconstructed from 7/30-day averages.

Migration 041 adds cache fields for provider status and comparison metrics.
Existing holdings, purchase lots, alerts, printing IDs and binder layouts are
preserved. Partial-feed and recovery scenarios are tested against a disposable
PostgreSQL database; live endpoint samples are used only to verify the schema.
