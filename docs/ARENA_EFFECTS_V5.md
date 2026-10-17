# Arena V5 effect coverage

V5 (`pokemon-expanded-v5`, CardShelf 0.56.0) expands complete, executable card profiles and corrects timing for new matches. It does **not** implement every historical Pokémon card. Unknown gameplay clauses or ambiguous printing characteristics still reject the whole card; they never become a vanilla attack. This remains Automated Casual Expanded, without a Standard or official Expanded legality certificate.

V1, V2, V3 and V4 snapshots, waiting lobbies and version-pinned tournaments retain their original compilers and engines. V4 changes only import its frozen version constant and pass that explicit version to deck validation. No database migration is needed.

## Rules references

- [Official Advanced Player’s Rulebook v3.4](https://asia.pokemon-card.com/sg/wp-content/uploads/sites/6/2025/10/EN_advanced_manual-2025.pdf): attack/damage order pp4–6; evolution and Trainer play pp9–11; Knock Outs and Checkup pp12–14; searches p16; movement, attachment and Rare Candy pp28–31; temporary effects and shared Ability limits pp51–58. The September 2026 basic rulebook audited in [ARENA_RULES.md](ARENA_RULES.md) still supplies the broader framework.
- [Official Attack Resolution Chart](https://asia.pokemon-card.com/sg/wp-content/uploads/sites/6/2022/08/attack_flow_chart_EN.pdf).
- [Official Charizard ex strategy](https://www.pokemon.com/uk/strategy/pokemon-tcg-charizard-ex-deck-strategy-tera-type-tactics) and [official Dragapult ex strategy](https://www.pokemon.com/uk/features/pokemon-tcg-dragapult-ex-deck-strategy).
- Complete English source profiles: [TCGdex cards-database](https://github.com/tcgdex/cards-database/tree/af57972e8f784c2507ab9e573c99bf02ae2e5e42), revision `af57972e8f784c2507ab9e573c99bf02ae2e5e42`.
- Missing printing characteristics cross-checked against [PokemonTCG/pokemon-tcg-data](https://github.com/PokemonTCG/pokemon-tcg-data/tree/39a26a144c8b6ef6c2fb17b2c29d0bb7121e3a11), revision `39a26a144c8b6ef6c2fb17b2c29d0bb7121e3a11`.

The two card datasets are implementation references, not rules authorities or legality lists. Stored identity fingerprints bind catalogue ID, name, HP, stage, types, attack names, Ability names and retreat. Card effects still have to compile completely. There are 569 matched Tera/non-Tera characteristics and 245 matched free-attack printings; an omitted attack cost is not generally treated as free. Normal evolution uses the printed predecessor name. Rare Candy additionally follows exact Stage 1 predecessor records, including distinct regional/owner names and alternate Fossil sources.

## Implemented and tested interactions

| Area | V5 behavior | Acceptance evidence |
| --- | --- | --- |
| Attack timing | Damage/formulas first; remaining effects in printed order. Energy discard follows damage. Explicit before-damage Tool removal precedes calculation. All attack clauses finish before Knock Outs. | Switching-before-draw, Energy-dependent damage/discard, Tool removal, simultaneous KO tests |
| Damage calculation | Stop calculation at zero; attacker modifiers before Weakness; defender reduction/prevention after Resistance. Ignore-effects clauses bypass only the printed Active scope. | Double Turbo Energy, Shred, reduction, Tera Bench tests |
| Temporary effects | Attack/retreat restrictions, damage reduction/protection and player Trainer locks expire at the specified turn. Switching/evolution clear effects on the Pokémon. Player effects remain independent of the Pokémon. | Budew Item lock, next-own-turn attack lock, switching/expiry tests |
| Triggers | Optional abilities from hand-to-Bench and hand evolution prompt their controller; deck placement/setup do not fire hand triggers. Rare Candy counts as evolution from hand. | Infernal Reign normal evolution, Rare Candy and deck-evolution tests |
| Usage limits | Per-instance limits, named per-player turn limits, per-game powers and repeatable attachment Abilities retain separate markers. Named limits survive the source leaving play. | Two Pidgeot ex / Quick Search, two Fezandipiti ex, Baxcalibur tests |
| KO history | Record turn and Checkup separately. Previous-opponent-turn conditions reject Checkup KOs and older/own-turn KOs. | Flip the Script / Unfair Stamp conditions and actual attack KO tests |
| Counters | Choose exact distributions one counter at a time; Bench-only targeting stays Bench-only. Movement removes counters from one source and places them on one recipient, without invoking healing multipliers. | Phantom Dive, Munkidori, Tera and Manaphy distinction tests |
| Energy | Distribute searched/recovered Energy, repeat hand/discard acceleration, restrict recipient type, forbid lethal Psychic Embrace placements, move Basic Energy, enforce different types for Crispin. | Infernal Reign, Super Cold, Psychic Embrace, Crispin tests |
| Hidden choices | Inspect a bounded deck segment; move selected cards to hand and remainder to the bottom in explicit order, or shuffle as printed. No candidate IDs or card faces go to opponents/spectators. | Recon Directive, private-prompt access and serialized reload tests |
| Trainers | Rare Candy, Arven’s separate Item/Tool searches, HP-limited/direct-to-Bench search, Counter Catcher, Iono/Judge/Unfair Stamp, Energy hammers, Pal Pad, Night Stretcher, Pokégear and Pokémon return effects. | Complete-record compilation plus effect-specific engine tests; HTTP Rare Candy/reload/replay tests |
| KO settlement | Resolve all attack effects and Prize awards before game resolution. If both Active Pokémon are Knocked Out, the next player promotes first. | Simultaneous KO and six-Prize tiebreaker suites |
| UI and CPU | Display public temporary effects, preserve ordering, block duplicate-type selection locally, keep server validation authoritative; CPU chooses only redacted server-issued candidates. | Actual SFC tests, Chromium/WebKit decision cases, three complete real-card deck simulations |

Fixtures in `tests/helpers/arena-real-cards-v5.json` retain all gameplay fields available in the source records. They are not shortened to their supported attack. Synthetic profiles separately isolate rules and hostile/invalid input cases. These tests do not certify every possible pairing of accepted cards.

## Reproducible coverage

The reference audit reads **21,291 English physical-TCG records**, excluding Pokémon TCG Pocket, from the pinned TCGdex revision. It includes historical, promotional and future/set-catalogued records; this is not a count of currently tournament-legal cards or the user’s installed catalogues.

| Coverage | V4 | V5 |
| --- | ---: | ---: |
| Complete supported reference records | 4,459 | 5,885 |
| Percentage of reference records | 20.94% | 27.64% |
| Supported records with H/I/J regulation marks | 735 | 1,161 |
| Newly supported records | — | 1,426 |
| Previously supported records rejected | — | 0 |

Audit any local English catalogue export (a JSON array of rows, or `{ "rows": [...] }`) with:

```sh
node scripts/audit-arena-catalogue.mjs catalogue-rows.json coverage-report.json
```

Rows need `id`, `game`, `language`, `name`, `raw_data`; include `local_id`, `set_id` and `set_name` where available. The report lists supported totals, added IDs, regressions and all rejection reasons. It exits unsuccessfully if a previously accepted record regresses. Missing or duplicate rows are errors, rather than silently reduced denominators. The full source snapshot must be supplied separately; the project does not bundle all third-party card data.

Regenerate printing characteristics and evolution lines from the same local row export and an independent English printing checkout:

```sh
node scripts/generate-arena-characteristics.mjs catalogue-rows.json pokemon-tcg-data/cards/en
```

Review the resulting diff and rerun the coverage audit and real-card tests. Changing a dataset revision requires a new coverage snapshot and source note.

## Remaining work before effects completeness

The reference still rejects 15,406 records. Large remaining groups include arbitrary/legacy Abilities, compound legacy coin wording, LV.X/LEGEND and unsupported evolution families, missing provider stats, further Tools/Stadiums/Special Energy, attack copying, Ability suppression, historical errata, label-specific filters, and additional KO/on-damage/on-attachment/end-of-turn triggers. V5 does not pretend these have been implemented. All new effects must have full-text profiles, exact timing/target/expiry rules, privacy checks, serialized continuation tests and real-card interaction evidence before entering automated play.
