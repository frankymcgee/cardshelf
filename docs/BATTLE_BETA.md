# CardShelf 0.15.0 — Pokémon assisted battle beta

## Retired in v0.18.0

This document describes the archived assisted beta, not the current user workflow. Use the automated Arena instead. Old beta pages redirect to Arena and old authenticated API operations return HTTP 410 Gone. Records remain stored; saved decks can be copied and checked in the Arena workshop. See `NAVIGATION_ARENA_AUDIO.md` and `AUTOMATED_ARENA.md`. The historical instructions below must not be used to reactivate the retired UI.

## Historical scope

This release adds saved decks and private two-player tables for English Pokémon catalogue cards. It is an **assisted casual tabletop**, not Pokémon TCG Live, a tournament legality checker or an automated card-effect engine. Players resolve attacks, costs, timing restrictions, Knock Outs, Prize awards, status effects and wins themselves. No ranking, wager, financial prize, spectator mode, AI opponent, public matchmaking, chat or voice service is included.

Battle records are separate from collection entries, binders, wishlist records and subscription data. Building a deck does not claim physical ownership. Existing quantities, prices, tester grants, Stripe settings and advertisements are not changed. No new paid service, provider API key, Docker container or exposed port is required.

## Deployment and the first two testers

Apply the source patch to the documented base and run the complete GitHub validation workflow on both the branch and the PR. Do not merge on the strength of isolated local tests alone. After successful validation and merging, use the existing Ubuntu server upgrade procedure:

```sh
git pull --ff-only origin main && sudo sh scripts/upgrade.sh
```

Migration `015_battle_beta.sql` creates five isolated battle tables and their indexes. It does not alter or populate existing account, collection, binder or subscription tables. The beta starts disabled; no account approvals are inferred from previous subscriptions or testing grants.

Keep the existing `.env`, `CARDSHELF_INTEGRATION_KEY`, database volume and domain/proxy configuration. In particular, preserve the already configured `cardshelf.cloud` origin. Do not rerun the initial configuration script. Relative application URLs use the active domain.

Sign in as an administrator and open **Battle beta administration** in the sidebar, or `/admin/battle`. Confirm your administrator password, supply a reason, review the assisted-play and content-rights acknowledgements, and select **Enable private battle beta**. Search for existing accounts under **Approve playtesters**, then approve the two participants. The password is cleared after each administration change, so reconfirm it for subsequent approvals.

Administrators are eligible only while the global beta is enabled. All other accounts—including paid, Free, tester and Complimentary accounts—require an explicit battle approval. This beta permission is independent of their collection-management tier and does not charge them, upgrade their subscription or remove any existing access. The future commercial entitlement policy is not implemented by this release.

Start with a small, controlled playtest and review the acceptance checks below. Battle screens do not add AdSense or sponsor slots.

## Deck builder

Open **Battle → Build a deck**. Search the locally imported English Pokémon catalogue by name or card number. Read a card before adding it; use plus/minus controls to change quantities. The optional **Owned cards only** filter counts only the signed-in user's physical collection. Unowned cards remain usable for a practice deck when that filter is off.

Save incomplete decks as drafts. Entering a match requires exactly 60 cards and at least one card whose imported category is `Pokemon` and stage is `Basic`. The validator warns about more than four copies by normalized English name across artwork variants; only explicitly identified Basic Energy is exempt from that warning. Card-specific exceptions, special-card limits, rotation and banned cards are not validated. A warning does not certify a legal tournament deck.

An empty search means there may be no matching imported English cards. Use the existing Pokémon import in Data & settings. If a Basic is missing its gameplay metadata, reimport the source set rather than making an unverified assumption in the battle engine.

Saved decks support rename, editing, deletion and JSON list export. JSON import, deck sharing and a dedicated missing-card wishlist assistant are not included. Deleting or editing a deck cannot change a match snapshot that was already taken. The beta allows 40 saved decks per account.

## Private lobby

Both players save a 60-card deck. The host chooses a deck, reviews a public player alias, accepts casual-play acknowledgement and creates a match. A random 32-character invitation code is returned once. Share it securely with the intended opponent, not on a public page. It expires after 24 hours.

The opponent uses **Ask to join** with their own saved deck, alias and invitation code. The host must then approve the opponent. Both players confirm ready; only then may the host start. Neither player receives the other's saved deck list. Only aliases, not account emails or account IDs, are shared through the match projection.

An invitation grants no account access and does not bypass beta approval. Its hash is stored, not its plaintext. Codes are not placed in URLs or browser storage. Reloading loses the displayed code; the host can generate a replacement while the lobby is empty. Replacing it invalidates the previous code. Rejecting/leaving a lobby invalidates its invitation. A stale or repeated join cannot replace an existing seat.

The beta permits five open matches and 500 retained match records per participant. There is no automatic match-history purge or administrative match deletion UI in this release. The history limit is a deliberate beta storage bound, not a paid-plan limit.

## Opening setup

The server snapshots each deck, shuffles its physical card instances, deals seven private cards and performs a starting coin toss. The winning player chooses first or second. Select a Basic in your hand and use **Place Active**; optionally place Basic bench cards. You can reset your unconfirmed opening field before locking it.

A mulligan is available only with a no-Basic opening hand and no field cards placed. The old hand's card names are deliberately revealed in the shared log; the replacement hand is not. Both players lock their opening fields; they are revealed together and six face-down Prize cards each are dealt. Until that reveal, the opponent receives only face-down placeholders, including when someone concedes during setup. Excess mulligan bonus cards can be drawn explicitly.

## Playing the assisted table

The playmat has Active, Bench, private hand, hidden deck, hidden Prizes, discard, Lost Zone and a Stadium/resolving area. Click/tap a card, then use the selected-card inspector. No drag-and-drop interaction is required.

- **Draw / Take Prize:** the server chooses the actual hidden card. The opponent receives updated counts, not hidden identifiers.
- **Move:** move your own card to a valid destination. Moving a field stack to hand, deck, discard or Lost Zone also moves its attached cards. Select an attachment to move only that card. Moving to deck puts cards on top; shuffle separately when an effect requires it.
- **Attach / Evolve / Switch:** attach a single card, overlay a hand Pokémon on a field stack, or switch Active and Bench. Evolution prerequisites, retreat costs, attachment limits and status clearing are player-resolved.
- **Search deck:** an explicit, publicly logged private search shows only the owner a name-sorted list, never draw order. Search and reveal actions do not determine whether a card effect permits them. Finish with **Finish search & shuffle**; drawing and ending the turn are blocked until searches close.
- **Counters:** either player may adjust public field damage and supported condition markers. These changes are logged; damage never automatically performs a Knock Out.
- **Coin / Die / End turn:** random results come from the server. The turn marker does not enforce attack or card-play rules, and drawing/between-turn checks remain manual.
- **Results:** one player proposes a winner/draw and the other accepts, or a player concedes immediately. No collection transfer or payment occurs. A rematch is a new private lobby.

The table has a fixed five-card bench. Special bench expansion, arbitrary custom zones, inspection/reordering of Prize cards, exact top-N deck rearrangement, complex control-changing effects and game-specific exceptions are not modelled. Select suitable casual decks for this beta rather than assuming every historical Pokémon card interaction is supported. There is no undo that can erase already revealed information.

## Privacy, synchronization and persistence

The server holds the authoritative state in PostgreSQL. Every mutation checks the session, explicit beta eligibility, seat and current revision, then takes the relevant database locks. Randomness is generated with Node's cryptographic facilities; clients cannot supply a coin result, shuffle seed or whole replacement state.

Opponent hands, hidden Prize identities and hidden deck order are omitted from responses. They are not merely hidden by CSS. A deliberately revealed card's bounded identity details remain in the shared log. The last 150 log events are retained. Finished matches keep hands and deck/Prize identities private. Unseated users, including a third administrator using the application API, cannot inspect a match. Server/database operators can still access stored records/backups; this is not end-to-end encryption.

The first beta uses authenticated HTTP polling every two seconds while the table is visible and idle. It does not install another process or require WebSocket proxy changes. Returning focus refreshes the table. Pages clear their displayed table after an access-denied response and stop polling when unmounted. Each request is reauthorized; previously delivered browser data cannot be recalled retroactively.

Match actions carry a unique request ID and expected revision. A retried identical action returns the current filtered view instead of applying again. A changed payload using an existing request ID is rejected. Concurrent stale actions return a conflict, not a silent overwrite. The UI preserves the pending action after an uncertain response. Retry that same action; do not send another one with a fresh ID. Reloading/remounting recovers persisted state after a confirmed action. If a saved deck update loses its acknowledgement and later reports a revision conflict, reopen the saved deck before editing further.

There is no automatic timeout loss after disconnecting. An approved opponent can concede an active match if the other player's beta access is revoked. Globally pausing beta freezes all battle access without deleting state. Restoring permission resumes access to retained records.

There is a 2,000-game-action limit (concession remains possible), a 2,200-receipt guard, bounded request bodies and a four-megabyte database cap on serialized match state. Full snapshots are polled rather than incremental diffs. Concurrent-user capacity has not been load-tested; monitor application memory, CPU, response size and database latency before increasing the playtest population. Do not infer public-scale suitability from the per-user limits.

## Expansion points

`lib/battle/engine.mjs` is the game dispatch entry point. `lib/battle/adapters/index.mjs` selects a versioned metadata/deck adapter; `pokemon.mjs` normalizes local data and deck checks, while `pokemon-table.mjs` owns Pokémon table transitions and participant projections. Lobbies, saved-deck persistence, action receipts and admin access are separate modules.

Adding another game requires its own metadata/deck adapter, table transitions and redaction tests, a UI/table implementation where zones differ, and an additive schema/allowlist update. Existing match snapshots retain `game` and `adapter_version`. This release intentionally rejects Magic and Yu-Gi-Oh! battle requests; their catalogue and collection functionality remains untouched. A fully automated Pokémon rules engine would be another explicit implementation, not an automatic consequence of importing effect text.

## Rights and data sources

The patch and tests include no publisher artwork or production catalogue data. Automated fixtures use synthetic cards. Runtime play reads the operator's already imported catalogue; artwork uses its existing validated image URLs. This introduces no new paid card-data API or live provider-fetch endpoint.

Access to an API does not establish rights to run a publisher-specific game. Pokémon's published support position does not grant blanket permission for third-party projects. Neither this patch nor the admin acknowledgement provides legal clearance; review the intended use and obtain appropriate advice/permissions before activating it, including for an invite-only beta. Do not publish or monetize a branded simulator on the assumption that free data or manual play resolves the issue.

Reference sources reviewed on 20 September 2026:

- TCGdex card schema: https://tcgdex.dev/reference/card
- Pokémon's images/materials policy: https://support.pokemon.com/hc/en-us/articles/360000634094-Can-I-use-Pok%C3%A9mon-images-or-materials
- Nuxt server routing: https://nuxt.com/docs/4.x/directory-structure/server

## Installation acceptance checks

After complete CI passes, use a staging/disposable database and two distinct test accounts before enabling wider play. Confirm the off-by-default state, explicit approvals, hidden opponent data in network responses, a complete lobby/setup flow, shuffled hands and Prize counts, manual moves/attachments/counters, a dropped-response retry, two simultaneous writes and session revocation. Reload both clients and restart the application between moves to confirm PostgreSQL persistence. Confirm public card lookup, binders, wishlist, Stripe, password recovery and ad eligibility still behave as before. Check desktop and a real mobile device.

The new HTTP/PostgreSQL regression suite is `tests/integration/battle.test.mjs`. It refuses to run without `ALLOW_TEST_DATABASE=yes`, a `_test` database and `TEST_BASE_URL`. Never run destructive integration fixtures against the live installation. The separate delivery validation report distinguishes local unit/component checks from the hosted CI and installation checks that remain outstanding.
