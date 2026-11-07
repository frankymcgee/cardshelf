# Printing distribution and binder scope

Finish and distribution are separate attributes. `normal`, `holo` and `reverse` describe a finish; `regular`, `product_exclusive`, `promo` and `unknown` describe how that printing is obtained. The model, correction tools, review queue and binder scopes work across all imported sets and supported games.

## Source-backed classification

Migration 042 adds sourced distribution rules keyed by game, language, exact provider card ID and printing key. The importer reconciles matching TCGdex rules after finish availability, updating the sourced base without touching an administrator's override. English rules cannot classify Japanese printings or a different game's card with the same provider ID. Marketplace variant descriptor IDs are not globally unique card identities and are not rule keys.

The initial verified rules cover English Pitch Black non-holo Build & Battle deck exclusives: Miraidon 028, Spiritomb 035, Bastiodon 062, Silvally 070 and Voltaic Lightning Energy 084. Each rule links its separate TCGplayer Deck Exclusives product; corresponding holo/reverse printings link their regular set product. Migration backfills already imported matching printings; later imports apply the same rules.

Other printings start with unconfirmed distribution. This release does not claim that every imported set has a verified distribution checklist. Missing prices, a third variant, rarity, W stamps or a special foil pattern never automatically classify a printing as promotional or exclusive. TCGdex `wPromo` is a W-stamp flag, not a universal promo-only flag.

Administration → Printing distribution reviews every imported set. The default filter finds cards with at least three active variants and unconfirmed distribution; the all-unconfirmed filter also includes one- and two-variant cards. Filter by game and set. Provider finish, language, stamps, foil, subtype and marketplace product IDs help locate the exact listing; they remain evidence clues, not automatic distribution decisions.

Administrators can correct any printing in this queue or Card details. A confirmed classification requires a descriptive evidence note and HTTPS source URL. Corrections have their own optimistic revision and audit event. They survive all re-imports. “Use sourced classification” clears only the override. An explicit unknown override can keep a disputed sourced classification under review. None of these actions retire a printing, remove inventory, change a price or erase binder pockets.

## Binder scope

| Scope | Completion and generated layout |
| --- | --- |
| Regular set variants | Excludes confirmed product exclusives and promos; retains unknown distribution with a review notice |
| Include promos and product exclusives | Includes all available printings |

New binder forms and generation default to regular set variants. Existing binders and legacy manual-create API calls default to all printings. Updates that omit scope preserve the saved value.

Generation filters scope before choosing the preferred printing in a one-design layout. It previews excluded extras and unconfirmed pockets and includes classification/scope in the preview token. A changed selection requires a new preview. No set has an artificial two-variant cap.

Changing a saved binder's scope keeps physical positions, duplicate pockets, collected marks and inventory. Existing extra pockets are listed separately and excluded from regular-scope progress, missing filters, missing-card wishlist targets, exact-printing completion costs and missing-only printouts. Choose all printings to count them again. Full layout printing still includes all physical pockets. Collection ownership and collection valuations continue to include genuine extra cards.

Collection checklists follow exact owned printings; tracking checklists follow independent saved marks. Design checklists still track any printing of a card design. Public tracking shares show the same scope and marks. Collection shares continue to hide ownership, quantities, notes and costs; distribution is global catalogue information.

## Validation

`tests/printing-distribution.test.mjs` covers arbitrary sets, unknown retention, no variant cap, input evidence, provider clues and scoped completion tokens. `tests/integration/printing-distribution.test.mjs` checks authorization, revisions, re-imports, generic sourced rules, generation replay/stale previews, wishlist conflicts, existing layouts and share privacy. Collection UI browser tests cover both checklist modes and generator preview notices on desktop, Chromium phone and WebKit phone.
