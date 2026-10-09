# Arena rules audit — 9 October 2026

Arena is an automated **Casual Expanded, supported-card-pool** game. This release
substantially expands rulebook coverage; it is **not full rulebook/card parity,
official Standard/Expanded legality, or a 1.0 sign-off**. A printed card enters
an automated deck only when its entire profile compiles. Unknown clauses are
rejected, never silently treated as a vanilla attack or Ability.

## Sources and version boundary

The supplied `30c_rulebook_en.pdf` was read in full: 44 pages, cover edition
**September 2026**. References below use printed page numbers. The official
[rulebook URL](https://www.pokemon.com/static-assets/content-assets/cms2/pdf/trading-card-game/rulebook/30c_rulebook_en.pdf)
is the baseline, not the earlier download/security-wall response. PDF creation
metadata is not the edition date. The official Professor Program's
[February 2026 update](https://professorprogram.pokemon.com/news/11473085)
also explains the updated tiebreaker and choice/shuffle ordering.

New games use `pokemon-expanded-v4`. V1, V2 and V3 engines and compilers remain
frozen for ongoing matches, waiting lobbies and version-pinned tournaments.
Existing saved decks are revalidated when entering a new V4 game; no old game
is migrated in place. V2 retains its historical Sudden Death behavior, and V3
retains its older mulligan/name behavior. Shared presentation accepts all four
versions without manufacturing V4 counters on old tables.

The official historical [Arceus rulebook](https://assets.pokemon.com/assets/cms/pdf/tcg/rulebooks/Arceus_Rulebook.pdf)
and [Undaunted rulebook](https://assets.pokemon.com/assets/cms/pdf/tcg/rulebooks/Undaunted_Rulebook.pdf)
were consulted for the LV.X and LEGEND definitions, respectively. Their older
general setup/turn rules are **not** applied to current games. These families
still need dedicated play/effect implementations and remain rejected.

## Rule-to-implementation acceptance matrix

“Implemented” means the listed mechanic works for fully compiled profiles,
not that every card in the provider catalogue is supported. The new focused
suite is `tests/arena-rulebook-parity.test.mjs`; existing core/expanded/2026
suites cover turn rules and prior mechanics. UI, HTTP and browser evidence is
separate from synthetic unit fixtures.

| Book pages / appendix | Requirement | V4 coverage / acceptance |
|---|---|---|
| 8–14, 22 | 60 cards, at least one Basic, four-copy names, opening seven/six Prizes/five Bench; first-player restrictions; turn limits | Implemented; core rules suite plus current-version deck/compiler tests |
| 18 | Shared mulligans first; lone mulligan waits for the opponent's opening setup; bonus draw/optional newly drawn Basics before field reveal | Implemented with hidden setup, zero-bonus and private bonus-Bench tests |
| 15–16, 19–20 | Attack requirements, Confusion, damage/effects, Special Conditions, Checkup and deferred Knock Outs | Implemented for reviewed effects; targeted damage/counter allocation complete before KOs; Checkup conditions form one indivisible group, next player orders reviewed Checkup triggers |
| 21 | Attack “up to” permits zero; Trainer/Ability “up to” requires one where possible; filtered hidden searches may fail to find; effect draws do not cause deck-out | Implemented; unrestricted “any card” search requires one and does not reveal card identities; zero-card deck-entry effects do not shuffle |
| 21 | Equal win-condition counts restart with six Prizes; first Prize advantage wins a tiebreaker | Implemented, including equal simultaneous gains and resetting per-game resources for the fresh game |
| 21 | Levels/LV.X and δ are not part of the name; owners/forms/EX versus ex and other symbols are significant | Implemented canonical names; hyphen/space EX variants cannot bypass four-copy limits. Name equivalence does not enable LV.X play |
| 23 / 1 | Modern Mega Pokémon ex: printed Basic/Stage 1/Stage 2 timing, three Prizes, no automatic turn end | Implemented; distinct from legacy Mega EX/Primal Reversion |
| 24 / 2 | Trainer's Pokémon: owner is part of the printed name/predecessor | Implemented name/copy/evolution matching |
| 25 / 3 | One ACE SPEC total, including different names/card categories | Implemented for reviewed Trainer and Special Energy profiles |
| 26 / 4 | Ancient/Future labels and label-dependent card interactions | **Incomplete:** label-specific selectors and verified provider classification are not yet implemented; such effects remain rejected |
| 26 / 5 | Pokémon ex: normal printed evolution and two Prizes; distinct from EX | Implemented |
| 27 / 6 | Tera ex: Bench protection against either player's attack damage, not damage counters | Implemented; unknown Tera-era classifications fail closed; see metadata limits below |
| 27 / 7 | Public, out-of-play, unrecoverable Lost Zone | Implemented persistent public zone; Prism routing and recovery isolation tested. Other card-specific Lost Zone effects still require programs |
| 28 / 8 | One Radiant total, Basic, Rule Box, cannot evolve | Implemented with cross-name deck limit and no-evolution tests |
| 28 / 9 | VSTAR evolves from matching V, two Prizes; one shared attack-or-Ability Power per player/game | Implemented, including private activation costs, Confusion failure and reload/replay protection |
| 29 / 10 | Four matching V-UNION quarters from discard, once per name/game, one Bench slot/Tool, three Prizes; limited characteristics outside play | Implemented for the reviewed Mewtwo SWSH159–162 profile only; other V-UNION profiles remain unavailable |
| 30 / 11 | Single/Rapid/Fusion Strike labels and interactions | **Incomplete:** label-specific metadata/selectors/effects remain rejected |
| 30 / 12 | Basic V, two Prizes | Implemented |
| 30 / 13 | VMAX evolves from matching V, three Prizes, considered a V | Implemented family/evolution/Prize classification; V-targeting effects require their own reviewed programs |
| 31 / 14 | Regional form is part of name and predecessor | Implemented |
| 32 / 15 | TAG TEAM Supporter's optional extra discard cost grants its printed bonus | Reviewed Mallow & Lana switch/heal family implemented; zero or the full cost only; not a generic interpreter for all TAG TEAM Supporters |
| 32 / 16 | Basic TAG TEAM GX, three Prizes, conditional GX bonus | Implemented family and shared GX marker; reviewed Eevee & Snorlax extra-Energy/draw bonus, hand attachment and Evolution-target bonus. Other bonus families remain rejected |
| 33 / 17 | One Prism Star of each name; Lost Zone instead of discard | Implemented across KO, Trainer resolution, hand/deck/Energy/Tool/Stadium discards and costs |
| 33 / 18 | Fossil Items act as Basic Pokémon only in play, not in opening/search/deck-building zones; printed restrictions | Implemented reviewed HP/no-Condition/no-retreat/manual-discard profiles and Antique Helix active Stadium restriction; discarding is not a KO/Prize award |
| 34 / 19 | GX normal stages, two Prizes, one GX attack per player/game | Implemented; GX and VSTAR resources are independent; a failed Confusion check spends neither |
| 35 / 20 | Ultra Beast label and label/Prize-dependent attacks | **Incomplete:** dedicated label classification and relevant effect families remain rejected |
| 35 / 21 | Dual types; Weakness before Resistance; no Bench Weakness/Resistance | Implemented, including typed Energy accounting without double-counting a rainbow Energy unit |
| 36 / 22 | BREAK inherits previous attacks/Abilities/Weakness/Resistance/Retreat, front HP/type; normal evolution timing | Implemented; retained damage/attachments, cleared Conditions, printed card restoration when it leaves play |
| 37 / 23 | Ancient Traits are neither attacks nor Abilities | Distinct Trait programs implemented for α Recovery and α Growth only; other Traits remain rejected |
| 37 / 24 | Team Flare Hyper Gear attaches to opponent EX and returns to its original owner | Reviewed Head Ringer/Jamming Net implemented; owner-based conservation and persisted removal tested |
| 38 / 25 | Legacy EX: Basic, two Prizes, EX name distinct from ex | Implemented |
| 39 / 26 | Legacy Mega EX and Primal Reversion: evolve from matching EX, two Prizes, end turn unless printed exception | Implemented hand evolution with reviewed Spirit Link exception; unreviewed effect-based Mega evolution remains excluded |
| 40 / 27 | Team Plasma is a label, not part of the Pokémon name; label-specific interactions | Provider's printed names remain significant as supplied; **incomplete** verified label classification/selector effects |
| 41 / 28 | Restored Pokémon only enters through printed Fossil effect; not Basic/Evolution; cross-era evolution follows printed predecessor | Implemented bottom-seven private Fossil search, optional placement, final shuffle and cross-era predecessor matching |
| 42–43 / glossary | Technical Machines grant attacks; devolution retains damage and clears Conditions; LV.X/LEGEND special play | Reviewed TM Evolution/Devolution and expiration implemented. **LV.X and LEGEND play remain rejected**; no incorrect normal evolution/Basic fallback |

## Catalogue and effect limits

The [TCGdex schema](https://github.com/tcgdex/cards-database/blob/master/interfaces.d.ts)
does not consistently expose Tera, family labels or multipart positions.
Accepting an incomplete record as an ordinary Pokémon could silently remove a
printed protection or rule. Therefore:

- Tera may come from a complete printed Tera rule, verified server-side Boolean
  metadata or the reviewed `en:sv01-032`, `en:sv01-224` and `en:sv03-042`
  classifications. Other Scarlet/Violet-era ex records require a verified
  Tera/non-Tera classification. This can reduce the supported pool until reviewed
  classifications are added. No HP/name/artwork heuristic decides Tera status.
- A VSTAR profile must include its compiled Power and once-per-game reminder.
  Additional Pokémon text is never ignored because a Tera flag is present.
- LEGEND names remain rejected even if the provider omits the suffix. Radiant
  and Prism Star rarity/name disagreements also reject the whole record; missing
  family metadata must not turn a restricted card into an ordinary Basic.
- V-UNION piece positions, set and artist are checked against the reviewed
  catalogue identities. Every attack and Ability on the combined profile must
  compile, and every accepted quarter remains one conserved physical card.
- Trainer “up to” minimums, Energy-providing units versus Energy-card counts,
  hidden searches and publicly revealed searches are separate program concepts.
- Unknown tails/clauses, special-card metadata or conditional timing reject the
  whole profile. Whole-text synthetic tests are not a catalogue-wide certification.

The supported scope includes bounded Special Energy, basic activated/passive
Abilities, reviewed Checkup triggers and typed multi-step programs. It does not
include a general trigger bus for play/turn/contact/KO effects, every ancient
Trait, all GX/TAG TEAM/V-UNION effects, held items, stars, Baby Pokémon, or all
historical/modern card-specific effects. Further profile work must test both
complete real text and the interaction/timing boundaries before enabling cards.

## Verification and release gates

- Unit suites check core/version behavior, hidden setup, choice/cardinality,
  damage/timing, card conservation/original ownership and unsupported clauses.
- Real SFC script/SSR tests check Power/Lost Zone display, private viewed-card
  details, multipart inspection, full optional costs and multi-Energy Retreat.
- Disposable PostgreSQL/HTTP tests cover persisted private costs/Fossil/Checkup
  decisions, idempotent replay/stale revisions, public Lost Zone, cross-player
  ownership, outsider rejection and V3 in-progress continuation.
- Chromium/WebKit fixtures exercise both seats and narrow/wide resource layouts,
  Lost Zone inspection, private choices, Retreat and Checkup controls. The signed
  match suite and native runtime/migration/upgrade jobs remain required checks.

Passing these suites proves the named boundaries, not exhaustive parity. Before
claiming full parity, finish the incomplete matrix rows, verified metadata/card
profiles and general trigger ordering; review applicable set FAQs and current
global errata. Selectable Standard/Expanded regulation marks, bans and reprints,
official tournament match timing/judge procedures, and two-member acceptance on
the deployed release are separate outstanding product gates. See
[V1_RELEASE_CHECKLIST.md](V1_RELEASE_CHECKLIST.md).
