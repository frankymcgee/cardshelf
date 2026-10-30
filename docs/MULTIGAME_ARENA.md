# Multi-game Arena

The Arena now selects a game before deck building or play. The three current
catalogue imports each have a versioned compiler, deck validation and reducer.
Decks and opponents must use the same game. These are supported-pool casual
formats, not complete implementations of either game's entire card library.

| Game | Snapshot version | Playable pool in this release |
| --- | --- | --- |
| Pokémon | `pokemon-expanded-v5` | Existing Expanded compiler and effects. Saved v1–v4 matches retain their engines. |
| Yu-Gi-Oh! | `yugioh-casual-v1` | Normal Monsters; exact Normal Spell templates for drawing, damage, LP gain and destroying all monsters. |
| Magic | `mtg-casual-v1` | Ordinary basic lands; vanilla creatures and flying/reach/haste/vigilance/defender; exact instant/sorcery templates for drawing, life gain, damage and creature destruction. |

Yu-Gi-Oh! implements a 40–60 card Main Deck, three copies per name across
printings, 8000 LP, five-card opening hands, the first player's skipped draw and
Battle Phase, normal/tribute/flip summons, sets, battle positions, attacks and
six-card end-of-turn hand limits. Effect Monsters, Traps, Extra Deck, Pendulum,
Ritual, chains and response windows need additional engines/effects before those
cards can be admitted. The current admitted pool has no Spell Speed 2/3 effects.
The Forbidden/Limited list is not applied.

Magic's format has exactly 60 cards (an explicit casual format limit), four
copies per name except basic lands, 20 life, seven-card opening hands, London
mulligans, one land per turn, colored/generic mana payment choices, the stack,
priority passes, upkeep/draw/main/combat/end steps, summoning sickness, simultaneous
attackers and blockers, multiple-blocker damage allocation, simultaneous damage,
state-based creature deaths, empty-library loss and cleanup/discard to seven.
Other abilities, planeswalkers, artifacts, enchantments, nonbasic lands,
multiface layouts and special costs are rejected. There is no sideboard or
format-specific banned list. New-game CPU strength is a basic deterministic
heuristic; the existing difficulty selector continues to affect Pokémon only.

## Imports and deployment

Migration `036_multigame_arena.sql` widens only the deck game constraint. Existing
deck IDs, match snapshots, collections and billing records are retained.
New games are available through private matches, genuine saved-deck practice,
game-specific tournament registration and public-board spectating. Guided
fictional teaching decks remain Pokémon-only.

Older Yu-Gi-Oh! and Magic imports did not preserve the rules stats needed for
automated play. Re-import those sets once using the unified Game imports screen.
The normal upsert refreshes each card without changing its ID or ownership.
Missing metadata is reported as unsupported; the engine never guesses ATK,
DEF, mana costs or power/toughness. No remote downloads occur during a match.

## Extending coverage

`shared/arena-games.mjs` defines installed games and formats. The existing public
dispatchers in `lib/arena/cards.mjs` and `lib/arena/engine.mjs` preserve Pokémon's
historical rules and route the two new versions to strict compilers/reducers.
All decisions are serializable, legal actions are server-issued, and reducers
copy state before mutation. Conservation checks account for hands, decks,
fields, graveyards, spells on the stack and pending mana payments.

Shared templates use the entire normalized effect, card type and game. A card
name alone never establishes compatibility. Mana costs, stats and targets stay
with each printing. Extend templates only alongside effect and interaction
tests. A change to the behavior of already admitted cards requires a new engine
version and retaining the old dispatcher; do not reinterpret active snapshots.

The CPU receives the same redacted view as a seated player. Opponent hands/deck
orders and face-down card definitions are excluded; spectators receive neither
player's private hand or decisions. Collection ownership is optional for decks.

## Rules references and validation

- [Konami's official TCG rulebook](https://www.yugioh-card.com/en/rulebook/) and
  [version 10 PDF](https://img.yugioh-card.com/en/downloads/rulebook/SD_RuleBook_EN_10.pdf).
- [Wizards' official Magic rules](https://magic.wizards.com/en/rules) and
  [How to Play](https://magic.wizards.com/en/how-to-play).
- Unit tests cover import metadata, fail-closed compilers, copy limits, shared
  templates, private views, costs, priority, combat, replay and complete CPU games.
- Integration tests exercise both games through real catalogue/deck/match APIs,
  retry receipts, wrong-game guest rejection and tournament game selection.
- Signed-in Chromium/WebKit scenarios cover game selection, deck import/save,
  computer practice, card inspection and desktop/mobile table layouts.
