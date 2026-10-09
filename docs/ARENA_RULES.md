# Arena rules audit — 9 October 2026

Arena is an automated Casual Expanded game with an explicitly supported card
pool. It is not certified Standard, official Expanded, or complete Pokémon rules
parity. Unsupported cards/effects must remain rejected rather than approximated.

## Sources and current corrections

The official Professor Program's [February 2026 update](https://professorprogram.pokemon.com/news/11473085)
replaces Sudden Death with a fresh six-Prize tiebreaker game. It also distinguishes
“up to” attack effects (zero permitted) from Trainer/Ability choices (at least one
when possible), and says not to shuffle when zero cards enter the deck.
The official English regional [Advanced Player's Rulebook v3.4](https://asia.pokemon-card.com/sg/wp-content/uploads/sites/6/2025/10/EN_advanced_manual-2025.pdf)
corroborates the tiebreaker victory criterion: first Prize advantage, with normal
loss conditions still applying. This regional 2025 manual is not a substitute
for the latest global handbook. The global rulebook, handbook and errata PDFs
linked from official resources returned a security wall during this inspection;
their full contents have not been verified.

New matches use `pokemon-expanded-v3`:

- Simultaneous equal win conditions restart normal setup with six Prizes; the
  first player with fewer Prizes wins. Equal simultaneous Prize gains continue.
- Supported optional discard-recovery Trainer choices require at least one
  eligible card. Hidden filtered deck searches retain fail-to-find behavior.
- Empty-hand shuffle/draw effects draw without consuming shuffle randomness.
- Discard-and-draw Trainers remain playable with an empty deck if they can still
  discard another card; drawing zero by an effect is not start-of-turn deck-out.
- Players see explicit tiebreaker guidance.

Existing V1 and V2 matches and tournaments keep their recorded engine. V2 remains
frozen, including its historical Sudden Death and choice semantics. Compiler,
server, bot and client dispatch accept all three versions; no stored game is
silently migrated. No new card families are enabled by this release.

## Remaining work before claiming official parity

| Area | Required work |
|---|---|
| Card effects | Explicit implementations and card-specific regression fixtures for rejected effects, Special Energy, modern multi-Prize Pokémon and triggered/passive abilities |
| Trigger timing | Ordered trigger queue; current player orders turn triggers, next player orders Checkup triggers; finish the originating effect before resolving triggered effects |
| Format legality | Dated regulation marks, bans, reprints and errata, with selectable format policies; Casual support is not Standard/Expanded legality |
| Tournament rules | Separate official event format, match timing, end-of-round turns and judge procedures from the existing casual tournament product |
| Acceptance | Two real members, reconnect/revision conflicts, persisted legacy games and tournament advancement on the deployed release |
| Source coverage | Review the latest global handbook/errata and set FAQs, then maintain a dated rule-to-test matrix |

Regression coverage includes six-Prize restart/setup, first advantage, equal
simultaneous gains, mandatory recovery choices, zero-card shuffle ordering/RNG,
discard-and-draw legality, and frozen V2 behavior. Passing these tests demonstrates
the listed corrections, not exhaustive rules correctness.
