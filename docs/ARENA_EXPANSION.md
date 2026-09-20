# Arena expansion — CardShelf 0.19.0

This release applies to the uploaded CardShelf v0.18.0 source. It adds a new
`pokemon-expanded-v2` rules engine while retaining the frozen
`pokemon-core-v1` compiler, rules and computer decisions for saved matches.
No database migration, card import, subscription change or new runtime
dependency is required.

## Card coverage

The following are executable mechanic families, not a claim that every card
using an EX/ex label or similar wording is supported. The compiler must
understand every attack, Ability and additional rule before admitting a card.
Incomplete provider records and unimplemented clauses remain blocked with a
reason in the deck workshop.

| Family | Implemented behavior |
| --- | --- |
| Pokémon EX and ex | Distinct names and rule-box labels; two-Prize Knock Outs; modern ex follows its printed Basic/Stage 1/Stage 2 evolution path. |
| Legacy Mega Pokémon-EX | Evolve from the identified Pokémon-EX; retain damage, Energy and Tools; clear Special Conditions; end the turn unless the matching supported Spirit Link applies. |
| Pokémon Tools | One attached Tool per Pokémon; supported HP, attack-damage, Basic-only HP/damage and free-retreat effects; matching Spirit Link; discard with the Pokémon or a supported removal effect. Tools remain separate from Items. |
| Stadiums | One shared Stadium; one play per turn; a differently named Stadium replaces the existing one into its owner's discard pile. Supported profiles include Stage 1/2 HP bonuses and once-per-turn Water/Lightning healing for the acting player. |
| Abilities | Supported once-during-your-turn draw, draw-to-hand-size, self-heal and opponent Active damage-counter effects; usable from Active or Bench as their complete text permits. |
| Items and Supporters | Ordered draw, hand reset, heal, switch, gust, search, recovery and Tool-removal steps. Required hand-discard costs precede the effect. Searches, targets and recoveries use private, bounded prompts. Supporter limits still apply. |
| ACE SPEC | At most one ACE SPEC card across the entire deck, including distinct names and printings, and only when its full effect is supported. |
| Knock Outs | Apply effective HP after Tool removal, Stadium replacement and evolution; discard complete stacks; award the appropriate available Prizes; resolve simultaneous results and required promotions. |
| Attacks | Retain the original supported damage, coin, condition, recoil, heal, draw and Energy-discard families; allow compatible combined Special Conditions and reviewed self-deck discard, including legacy M Charizard EX. Exact supported additional clauses are covered by compiler and engine tests. |

Reviewed wording examples include Muscle Band, Float Stone, Giant Cape,
Fighting Fury Belt, Spirit Link, Training Center, Rough Seas, Bibarel's
Industrious Incisors, Bird Keeper, Super Rod and Startling Megaphone. These names
are examples of reviewed profiles: a card with additional unsupported text is
rejected even if it has one of those names. Master Ball also retains its ACE
SPEC restriction when an older provider record omits that marker, using its
name and complete reviewed effect together.

Modern three-Prize Mega Pokémon ex, Tera rules, GX/V/VMAX/VSTAR, Special Energy,
Ancient Traits, arbitrary damage formulas and other unimplemented persistent,
triggered or prevention effects remain outside this release. “Casual Expanded”
is the CardShelf format name, not certification for the official Expanded
tournament format.

## Computer opponents

With a supported saved catalogue deck selected, computer practice offers:

| Option | Source of the opposing deck |
| --- | --- |
| Matched Deck | The closest comparable, playable deck among the same account's other saved decks. The heuristic compares Pokémon types, Basic/evolution mix, Pokémon/Energy/Trainer quantities, HP, attack costs and printed damage. It checks evolution predecessors and is not a guarantee of competitive balance. |
| Mirror Deck | A separate snapshot of the selected player deck. Both seats have independent instances, shuffles, hands and Prizes. |
| Choose Opponent Deck | Another saved deck explicitly selected by the player, with owner and revision checks. |

If Matched Deck finds no comparable supported saved deck, the table explicitly
states that it uses a mirror. It does not invent substitute Pokémon or replace
a real deck with teaching cards. Candidate selection does not inspect other
accounts' decks or alter collection quantities. Later catalogue imports or deck
edits cannot alter the snapshots in an existing match.

The walkthrough and explicitly labelled original teaching-deck practice remain
available without a catalogue import. Those fictional cards remain separate
from saved catalogue practice.

The computer makes decisions from the same redacted player projection used by
the UI. It can use legal Abilities, Tools, Stadiums and sequential decisions.
It does not receive the opposing hidden hand, deck order or Prize identities.

## Table controls and compatibility

The table shows a shared Stadium zone, attached Tools and evolution-stack
markers. Select a Pokémon to inspect effective HP, effective retreat, Abilities,
Prizes and attached cards. Stadium activation and Ability buttons come only
from the server's legal-action list. Multi-Prize decisions require the full
prompted selection; unresolved decisions pause further gameplay.

Existing Core matches and waiting lobbies retain their engine version. A player
joining a Core lobby must provide a deck supported by Core. Old tables do not
gain new actions merely because the application was upgraded. Unknown or
inconsistent stored versions are rejected without changing the match.

Membership gates, private lobbies, idempotency receipts, stale-revision handling,
action bounds, hidden-zone protections and ad exclusions are retained.

## Applying the patch

From the repository root containing the unmodified v0.18.0 source, use the
existing CardShelf patch runner with `cardshelf-0.19.0-arena-expansion.patch`,
or apply it directly:

```sh
git apply --check /path/to/cardshelf-0.19.0-arena-expansion.patch
git apply /path/to/cardshelf-0.19.0-arena-expansion.patch
npm install
npm test
npm run typecheck
npm run build
```

The patch runner's Git workflow is unchanged. The patch does not push, merge or
deploy the release. Run the repository's PostgreSQL integration workflow before
merging and follow the existing upgrade procedure for deployment.

## Validation

Executed on Node.js 24.19.0 against the uploaded source:

- Untouched v0.18.0 baseline: 1,536 unit tests passed.
- Final v0.19.0 candidate: 1,621 unit tests passed, no failures or skips. These
  include compiler admission/rejection, EX/ex Prizes, Mega timing, attachment
  conservation, HP-loss Knock Outs, Ability limits, serialized sequences, hidden
  prompts, opponent selection, rendered Vue components and legacy resumption.
- Twelve expanded two-computer games plus the original seeded game regressions
  and legacy computer-game compatibility checks complete successfully.
- Nuxt typecheck and production build passed. The existing Vue Router/Volar
  plugin warning is non-fatal; no checks were disabled.
- All 17 migrations applied unchanged and the production health endpoint passed
  against PGlite 0.5.8 / PostgreSQL 18.3 WASM in a disposable local database.
- The existing Arena HTTP/database suite passed all 27 reported tests in a
  fresh isolated run, including concurrent deck writes, lobby revisions,
  authenticated PvP completion, autoplay, entitlements and hidden-state checks.
- The isolated new Arena HTTP/database suite passed all 7 reported tests,
  including its parent test: opponent modes, private/stale selections,
  idempotency, snapshot immutability, legacy lobby join/start/resume, inconsistent
  versions and collection/subscription isolation.

The embedded database is not native PostgreSQL 17. An attempt to run the full
integration suite on it encountered concurrent-write failures and later stalled;
that attempt is **not a passing integration run**. The complete repository CI
suite on native PostgreSQL 17, Docker deployment and production two-account
acceptance remain required before merging/deploying. No production account,
subscription, server, repository branch or database was modified.

The authenticated Chromium smoke run passed 11 checks with no page runtime
errors. It exercised all three genuine-card opponent selections, tutorial Active
placement, Tool/Energy/evolution inspection, EX/effective stats, and live Ability
and Stadium actions. Desktop (1440 × 1080) and mobile (390 × 844) home/table
screenshots were visually checked; neither viewport had horizontal overflow.
These were disposable synthetic catalogue and match fixtures, not a claim to
have exercised every real printing.

The deliverable patch passed `git apply --check`, normal application and reverse
application checks against a fresh extraction of `cardshelf-main(1).zip`.
Every resulting file matched the validated candidate byte for byte. The same
1,621-test unit suite passed from that patched extraction. The supplied ZIP's
SHA-256 was `bc9be40b1054cdfd167399caeb65133970f49ade19199de7d3a77f703a3ea8c1`.

## Primary implementation references

- [TCGdex card schema](https://tcgdex.dev/reference/card)
- [TCGdex maintained TypeScript card types](https://github.com/tcgdex/cards-database/blob/master/interfaces.d.ts)
- [TCGdex card definitions](https://github.com/tcgdex/cards-database)
- [Official Pokémon TCG rules resources](https://asia.pokemon-card.com/sg/rules/detail/)

No publisher artwork or downloaded card dataset is bundled in the patch.
