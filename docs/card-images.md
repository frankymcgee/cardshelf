# Card artwork sources

CardShelf tries a saved catalogue image first. For TCGdex it tries the thumbnail
(in small views), full-size WebP, then full-size PNG. It then tries Pokémon's
official card image and Limitless TCG when an exact English set mapping exists.
The chain stops after the last candidate; it does not loop or search by name.

Initial reviewed mappings in `shared/card-images.mjs`:

| TCGdex set | Source code | Collector numbers | Set |
| --- | --- | --- | --- |
| `mee` | `MEE` | 001–008 | Mega Evolution Energy |
| `sve` | `SVE` | 001–024 | Scarlet & Violet Energy |
| `me01` | `MEG` | 001–188 | Mega Evolution |

Unmapped sets retain their existing image and TCGdex format retries. Japanese
cards never fall back to English artwork. A source image identifies the card
design; it does not independently verify a holo, reverse, stamp or edition.
The existing selected printing and decorative foil controls remain authoritative.

Verified on 2026-09-28: TCGdex's `mee` index and card records have no `image`
field. All eight official MEE image URLs returned valid PNGs. Limitless's MEE
card pages supply matching numbered images. The SVE and MEG identities were
cross-checked against TCGdex set records and Limitless card pages. Availability
can vary by region and source; fallbacks handle failed downloads.

- <https://api.tcgdex.net/v2/en/sets/mee>
- <https://api.tcgdex.net/v2/en/sets/sve>
- <https://api.tcgdex.net/v2/en/sets/me01>
- <https://tcgdex.dev/assets>
- <https://www.pokemon.com/us/pokemon-tcg/pokemon-cards/series/mee/1/>
- <https://www.pokemon.com/static-assets/content-assets/cms2/img/cards/web/MEE/MEE_EN_1.png>
- <https://limitlesstcg.com/cards/MEE/1>
- <https://limitlesstcg.com/cards/SVE/1>
- <https://limitlesstcg.com/cards/MEG/1>

The browser loads only the current candidate, without a referrer. Native browser
caching applies. There is no third-party HTML scraping, API key, image proxy,
database migration or catalogue re-import. Existing rows with missing URLs start
using these fallbacks when viewed after upgrading. No collection IDs, printing
IDs, ownership, prices or gameplay state are rewritten.

Production CSP permits only the existing TCGdex image host and the two specific
card-artwork paths. The public catalogue credits all three sources. Card artwork
remains the property of its rights holders; CardShelf does not claim ownership.

To extend coverage, verify the exact provider set identity, number range and
language against both sources before adding a mapping and regression fixtures.
Do not infer mappings from names or substitute an older Energy card design.

## Release validation

`npm test`, `npm run typecheck`, `npm run build` and `npm run test:card-images-ui`
cover source matching, bounded retries, image failures, source changes and the
production image policy. Browser tests use controlled responses, so GitHub builds
do not depend on live image-host availability. The existing Docker images and
upgrade script deliver the change without new deployment settings.
