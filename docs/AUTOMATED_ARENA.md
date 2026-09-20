# Automated Battle Arena — CardShelf 0.17.0

## Release boundary

This release adds an end-to-end, server-authoritative **Automated Casual Core** format for Pokémon-style play: supported decks, private two-player games, a computer opponent, solo Auto play, a guided walkthrough, and a graphical tabletop. It is **not a complete implementation of every Pokémon card, expansion, tournament format or card-specific ruling**. It is not an official Pokémon service.

A card is admitted only when the whole gameplay definition is supported. The application does not pretend that an unimplemented Ability or effect has resolved. Unsupported cards have a reason in the deck builder and cannot enter an automated game. Existing collection and manual-table records are preserved.

The engine version is `pokemon-core-v1`. Keep this version available while it has saved matches. Changes to its rules need a deliberate version/compatibility decision, not a silent reinterpretation of an active match.

## Availability and membership

The automated arena starts **disabled**, independently of the old battle-beta switch. Open **Arena administration** (`/admin/arena`) and confirm your administrator password, reason, supported-format acknowledgement and publisher-rights review before enabling it.

Playing, deck editing, training, computer practice and reading private arena records require one of:

- A locally verified, unexpired **Live Stripe Collector or Collector Plus** paid period; or
- An explicit, unexpired **Collector or Collector Plus administrative tier assignment**. This preserves a deliberate, auditable route for controlled testing without creating a charge.

The internal premium plan code remains `plus`; changing a product's display name does not change that mapping. Administrative tier assignment takes precedence. A current Complimentary assignment does not qualify for this module.

Free membership, an old tester grant, old battle approval, an administrator role, a pending/unpaid checkout, a Stripe Sandbox payment or disabled general membership enforcement **does not by itself unlock battles**. Administrators retain access to the arena configuration page, but need a qualifying entitlement to play. To test, explicitly assign Collector/Collector Plus to a dedicated account in Memberships & referrals; do not remove its other data or create a Live charge just for testing.

The legacy manual battle module now requires the same qualifying entitlement as well as its existing beta availability/approval rules. Existing approval rows are retained, but are not a subscription substitute. Pausing the arena or losing entitlement retains decks and matches; it does not delete them. An expired player's presence pauses new gameplay in a head-to-head match until their access is restored.

No billing requests, subscriptions, refunds, tier assignments or advertising settings are created by installing this release. The old general tester access to collection features is not removed. Arena routes are private and ad-free.

## First playable check

1. Upgrade a validated release using the existing upgrade procedure. Migration `017_automated_arena.sql` creates isolated arena tables. Keep the real `.env`, database volume, integration encryption key and `cardshelf.cloud` configuration.
2. Enable the automated arena in `/admin/arena`.
3. Sign in with a qualifying Collector/Collector Plus account and open **Battle**, which now points to `/arena`.
4. Select **Start walkthrough**. No card catalogue import is needed: this uses original fictional teaching cards, not publisher artwork or a downloaded card dataset.
5. Follow the opening-field prompt, attach Energy, choose an attack and resolve the selection prompts. The CPU plays the opposing seat. Use **How to play** to reopen guidance.
6. Try **Computer battle**. The empty saved-deck selection uses the original Ember teaching deck against the Tide teaching deck. Choose a supported saved deck to practise with imported cards instead.
7. For real-user multiplayer, prepare supported 60-card decks in two qualifying accounts, create a private table, share its invitation code, join, approve the joining seat, ready both players and start.

The two original teaching decks and their illustrations are generated locally. They do not become owned cards or catalogue records. The walkthrough deliberately sets up a teaching opening; it is labelled training, not a competitively random deal.

## Deck workshop

Open **Deck builder** or **Build a deck**. The search uses the locally imported **English Pokémon** catalogue; no new paid API is involved. Supported cards show their playable profile, and unsupported cards explain what needs an implementation or missing provider data. `Owned cards only` is an optional filter, not a requirement to own a physical copy for private practice.

Add card quantities, name the deck and save. Drafts may contain fewer than 60 cards, but a match requires exactly 60, at least one identified Basic Pokémon, and no more than four of a non-Basic-Energy card name across artwork variants. Basic Energy is exempt from the four-name limit.

The workshop supports private JSON export and copying a compatible legacy deck by its ID. It does not silently overwrite, convert or remove the original. Unsupported legacy decks must be edited before they can start an automated match. New arena decks use their own storage and revision checks.

Deck quantities are not inventory quantities. No deck operation updates ownership, card prices, wishes, binder pockets, seller listings or the user's subscription. Cards are snapshotted when a match is created or joined, so editing the source deck or reimporting a set cannot alter a game already in progress.

### Supported card pool

The current compiler supports ordinary, single-type Basic, Stage 1 and Stage 2 Pokémon with complete HP/retreat data; recognised Basic Energy; and a bounded set of Item/Supporter effects. Examples of executable effect classes include:

- Fixed attack damage, supported heads/tails checks and coin-based damage, supported Special Conditions, recoil, self-healing, drawing and Energy discard;
- Drawing cards, discarding or shuffling the hand and drawing, healing, switching/gusting, supported deck searches with required costs, and Basic Energy recovery.

These are complete-clause matches, **not a promise that every card using similar language is supported**. Wording, additional clauses and provider completeness matter. A multi-attack Pokémon is rejected if any attack is unsupported. Missing data is not guessed.

Unimplemented classes include Abilities, rule-box Pokémon such as ex/GX/V/VMAX/VSTAR, Radiant and other special-rule cards, Special Energy, Tools, Stadiums, Tera/Ancient Traits, expanded Bench rules, arbitrary target/damage formulas, most persistent/prevention effects and other complex card-specific mechanics. They are intentionally not admitted. Rotation, banned lists, Standard/Expanded legality, tournament deck checks, rankings and official rulings are not certified.

## The graphical table

The table separates your field and private hand from your opponent's field. It includes Active spots, five Bench slots, face-down Prize cards, deck/discard piles, HP bars, damage badges, Energy markers and Special Conditions. Imported card artwork is used where already available; unavailable images have a readable fallback.

Select a card to inspect it and see its currently legal actions. Attacks are real actions rather than text-only references. Buttons identify Active and numbered Bench positions so identically named cards remain distinguishable. On narrow screens the inspector is below the board; selecting a card or receiving a decision scrolls it into view. Reduced-motion settings are respected.

The following are server-controlled:

- Shuffling, private opening hands, no-Basic mulligans, the starting coin toss, setup locking, Prize placement and excess mulligan bonus;
- Turn-start draws, current-player actions, one normal Energy attachment, one Supporter and one retreat per turn, first-player opening restrictions, evolution timing and required costs;
- Attack damage and supported effects, Weakness/Resistance, Special Conditions and between-turn checks;
- Knock Outs, discarded stacks, Prize selection, replacement Active selection and game-end conditions;
- A fresh one-Prize sudden-death game when simultaneous equal win conditions require it in this format.

Attack Energy requirements do not normally consume Energy; explicit discard effects and retreat costs do. A legal attack ends the turn after required decisions and resolution. Players cannot use the manual table's arbitrary counter or card-move actions inside an automated match.

Prompts request targets, discarded cards, searched cards, replacement Pokémon or face-down Prize choices. Only the seat authorised for a prompt receives its selectable private options. The action history records public information without logging an unrevealed hand, Prize identity or draw order.

### Practice, Auto play and walkthrough

The computer is a local rules-based opponent with Relaxed/Standard options, not a paid AI service. It chooses from the same legal actions and sees a filtered player view. It does not receive the other player's hand or hidden deck/Prize identities.

**Auto play** is available only in solo practice/training. It lets the heuristic players progress the match automatically while the page remains active; it is not a background unattended service. It can be stopped to resume making your own choices. The server rejects this shortcut in a two-human match. There is no automatic replacement of a disconnected human with a bot.

The walkthrough provides ten coaching topics: opening setup, turns, Bench, Energy, Trainers, attacks, Prizes, evolution, retreat and winning. Progress is retained with the match, with manual tip navigation and in-game help. It teaches the implemented format, not every official card interaction.

Optional generated sound cues start off. There are no downloaded sound files or autoplay audio permissions required to use the game.

## Private lobbies and connection handling

Invitations are random, hashed at rest, expire after one day, and are shown when generated. A used/replaced invitation cannot admit another player. A joining account supplies its own saved deck and player alias; the host approves or rejects the seat before either player can start. Both players must mark ready.

The server checks the session and entitlement on requests. Match access is restricted to the seated players—even another administrator cannot inspect their table through this API. A disconnected browser can reload the committed match snapshot. An uncertain action retains its request ID and can be retried without applying the action twice. Stale revisions return a conflict rather than silently overwriting newer moves.

Only pending request metadata is temporarily retained in the current browser tab for recovery; the application does not persist the complete match, opponent hand or hidden deck state there. Do not share your browser profile or a pending-request snapshot with another person.

The client polls approximately every two seconds while visible. There is no extra WebSocket service or public port. CPU steps per request, action counts, deck counts, invitations and match counts are bounded. The current limits include 40 saved decks, five active matches and a 2,000-match archive per player. The archive limit intentionally stops growth; this release does not add an archive-deletion interface.

This release does not implement public matchmaking, competitive ratings, spectator/replay disclosure, tournament clocks, AFK forfeits, text/voice chat, gambling, monetary prizes or card transfers. Concession remains available. Disconnecting does not automatically forfeit a game.

## Isolation, deployment and future expansion

The existing Node application and PostgreSQL container run the arena. There are no new package dependencies, external services or card-data credentials. New tables are `arena_settings`, `arena_decks`, `arena_matches` and `arena_receipts`; old battle/collection/billing tables are not migrated into them.

The module separates access, deck compilation, state transitions, computer decisions, persistence and presentation. Engine-versioned snapshots leave a route to additional game adapters and expanded Pokémon card implementations later. Adding a game or mechanic requires its own reviewed implementation, validation, safe player projections and tests; it is not enabled merely by adding a catalogue category.

For broader deployment, first validate real two-account play, account expiry, browser refresh, mobile decisions, browser Back/Forward and production-provider data. Measure concurrency and database/server memory use on the actual host. The offline test harness is not a capacity estimate.

The publisher-rights acknowledgement is not permission or legal advice. Free access to provider data does not, by itself, license publisher artwork or a branded online game. The source patch contains original training cards and synthetic fixtures, not publisher artwork or a real card dataset. Review rights before enabling publisher-content gameplay.

## Validation and acceptance

See the accompanying release validation report for exact local results and environment limitations. The complete Node 24/Nuxt build, migrations, PostgreSQL HTTP suite and both GitHub workflow triggers must pass on the candidate branch before merging. No checks or timers should be disabled merely to obtain a green result.

The new HTTP/database suite exercises auth, paid-tier gating, disabled defaults, private deck/match access, lobby admission, idempotent retries, concurrent revisions, snapshot isolation, hidden data, automatic full-match progression, computer play, tutorial access and preserved collection/billing data. Local component checks use synthetic data and an in-memory API, not a deployed production server.

Useful primary references for extending the compiler and reviewing gameplay:

- Official rules and attack-resolution resources: https://asia.pokemon-card.com/sg/rules/detail/
- TCGdex card schema: https://tcgdex.dev/reference/card

These references do not imply official endorsement or exhaustive implementation.
