# Shared move implementation and engine comparison

CardShelf 0.56.1 prioritizes reviewed move templates by the number of different Pokémon they serve. A move's name is a label: the full effect, formula and power rules determine its behavior. Energy cost, base damage and the original display text remain attached to each individual attack. An accepted move never authorizes a card with another unsupported attack, Ability or rule.

## Measured first batch

The pinned reference export is the same 21,291 English physical-TCG records used in the [V5 audit](ARENA_EFFECTS_V5.md). It includes reprints, historical/promotional and future catalogue entries, not a tournament legality list. [The retained snapshot](arena-move-priority-snapshot.json) includes source revisions, export SHA-256, before/after measurements, ranked candidates and executable probe results.

| Measurement | Before | After three templates |
| --- | ---: | ---: |
| Completely supported card printings | 5,880 | 6,089 |
| Unsupported attack occurrences | 13,043 | 12,610 |
| Whole-text effect families with an implementation gap | 6,722 | 6,688 |
| Previously supported V5 printings regressed | — | 0 |

Three shared templates now handle legacy coin bonus wording, recoil wording and Bench damage wording through existing V5 operations. This supports another **433 attack occurrences** and **209 complete card printings**. Other cards still have additional blockers. No new state-machine operation or Arena version is necessary: compiled existing profiles and the engine dispatcher are unchanged.

- Coin bonus: `Flip a coin. If heads, this attack does 10 damage plus 20 more damage.` uses the existing coin-bonus operation, only when the printed base is `10+`. A different printed base is rejected.
- Recoil: `This Pokémon does 10 damage to itself.` uses the existing self-damage operation, with the exact printed amount.
- Bench damage: `Does 20 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)` uses the existing Bench-target operation. Printed damage to the Active Pokémon remains independent.

Each alias consumes the entire effect text. Additional unrecognized clauses reject rather than disappear. Complete real source records exercise multiple names, costs and amounts; engine tests check both coin results, recoil, target selection, Weakness exclusion and JSON continuation.

## Development priority rules

Run against an English catalogue row export:

```sh
npm run audit:arena-moves -- catalogue-rows.json move-report.json
```

Input is the same JSON array or `{ "rows": [...] }` accepted by `scripts/audit-arena-catalogue.mjs`. The audit never fetches data, changes card acceptance or edits catalogue rows.

1. Group full normalized effects by formula and power rules. Do not merge by move name. Unknown provider fields remain in the family identity. Cosmetic Pokémon accents, apostrophes and whitespace can normalize.
2. Rank missing families by distinct affected Pokémon names first, then unsupported attack occurrences. Count artworks/printings separately, so numerous artworks do not outweigh broad reuse across different Pokémon.
3. Offer numeric templates as review hints. Different printed amounts retain separate whole-text family IDs; numeric placeholders are never an executable equivalence rule.
4. Keep missing Energy costs and malformed source data in a separate metadata list. A missing cost becomes free only when the existing exact printing verification authorizes it.
5. Record the full compiler's rejection reasons alongside move gaps. `cards_with_only_this_attack_gap` means only one attack family is missing, not that the whole card becomes playable after implementing it. Ability, evolution, rule-box, Weakness/Resistance and other metadata checks still apply.

The initial scan found **1,573 move names with different effect families**. For example, Hidden Power had 51 families. Conversely, different move names share identical effects. The implementation library therefore binds parameters from reviewed full text rather than looking up a move name.

The next shared candidates include legacy chosen-target damage, coin-based defending attack failure, forced switching, all-opponent Pokémon damage and coin-based protection. The machine-readable snapshot records their counts. The priority is development reach; a particular deck's missing dependency can still justify moving a family ahead of this ordering. Format legality and competitive popularity are separate inputs.

## External engine compatibility prototype

Compared these exact checkouts, without adding either engine to the production application:

- [RyuuPlay](https://github.com/keeshii/ryuu-play/tree/9cd20b6a3232b77ac114fb45a3979d51a4332850), revision `9cd20b6a3232b77ac114fb45a3979d51a4332850`. Its documented TypeScript packages separate rules, sets, server and bots. The inspected sets do not include the target modern Charizard ex/Dragapult ex implementations.
- [Twinleaf](https://github.com/twinleafgg/twinleafgg/tree/d89efe580127a05aff8b0456fd2ad587edbbee2d), revision `d89efe580127a05aff8b0456fd2ad587edbbee2d`. This RyuuPlay derivative includes modern target profiles and shared effect helpers. Its README/package declare MIT. No upstream implementation is copied into the application by this change.

```sh
git clone https://github.com/keeshii/ryuu-play.git /path/to/ryuu
git -C /path/to/ryuu checkout 9cd20b6a3232b77ac114fb45a3979d51a4332850
git clone https://github.com/twinleafgg/twinleafgg.git /path/to/twinleaf
git -C /path/to/twinleaf checkout d89efe580127a05aff8b0456fd2ad587edbbee2d
npm run probe:arena-engine -- ryuu /path/to/ryuu ryuu-report.json
npm run probe:arena-engine -- twinleaf /path/to/twinleaf twinleaf-report.json
```

Run the probe only on trusted checkouts: it bundles and executes upstream code. `esbuild` and the upstream replay compression package are development dependencies. The probe uses actual upstream classes, native serializers and prompt reducers, not substituted card logic. It invokes the private prompt reducer directly to isolate continuation storage from battle setup and end-of-action checks; it does not certify the full dispatch path, authorization, network views or an entire match.

| Scenario | RyuuPlay | Twinleaf | CardShelf control |
| --- | --- | --- | --- |
| Prompt callback resolves in the existing Store | Pass | Pass | — |
| Native serialized state restores prompt data | Pass | Pass | — |
| Restored state in a fresh Store resumes its callback | Fails with `ILLEGAL_ACTION` | Does not resume | — |
| Burning Darkness, two opposing Prizes taken, before Weakness | Target profile absent | 240 damage | Existing V5 suite |
| Phantom Dive, 60 counters damage to a Benched Tera Pokémon, rejects Active targeting | Target profile absent | Pass | Existing V5 suite |
| Real Recon Directive decision after JSON reload | — | — | Pass, including private prompt and selected/remainder destinations |

Both upstream `Store` implementations hold prompt continuations as callbacks outside serialized State. Restoring the native State alone cannot restore the pending effect. An integration could retain live Store instances or reconstruct them from action replay, but that requires a new persistence/recovery adapter and verification of privacy, deterministic randomness, upgrades, reconnects, spectators and CPU play. Those routes have not been implemented or costed here. A normal client reconnect to a still-running upstream Store is different from the fresh-Store recovery tested by this probe.

The immediate recommendation is to retain CardShelf's serializable decisions and expand its shared move templates. Twinleaf is a useful candidate for further architectural comparison, especially effect triggers, suppression and attack copying. Replacing the engine requires a broader assessment; these results do not establish all-card coverage or a shorter migration schedule.

## Verification

```sh
node --test tests/arena-move-coverage.test.mjs tests/arena-shared-moves.test.mjs tests/arena-engine-probe.test.mjs
npm test
npm run typecheck
```

The upstream probes run separately against pinned local checkouts and do not download or execute external code during the ordinary test suite. Tests retain the complete source records used for the first three shared templates. Full catalogue exports remain external inputs; the repository retains only compact audit evidence and the focused fixtures.
