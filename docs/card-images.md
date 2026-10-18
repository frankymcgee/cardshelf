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


## Device artwork cache — 0.57.1

The production service worker reuses public card artwork after the browser has
successfully decoded it. It covers the three approved Pokémon artwork sources
and the content-addressed `/api/public/catalogue/artwork/<sha256>` endpoint used
by other games. The cache is local to each device/browser; it starts as cards
are viewed, without pre-downloading a catalogue. No server image proxy, bulk
download worker or new server storage is introduced.

Fresh hits skip the image network request, including when offline. Metadata,
ownership, private binder backgrounds, marketplace uploads, authenticated API
responses and exports are never stored by this cache. Only public artwork can
remain after logout; this does not enable offline editing or a full offline app.

The cache holds at most 200 images with a 64 MiB accounting budget. Readable
images are limited to 4 MiB each and expire after 30 days. Cross-origin opaque
images cannot expose their status or size: they are saved only after an actual
image load succeeds, limited to six entries, charged an estimated 7 MiB per
entry for Chromium's quota padding, and expire after seven days. Oldest entries
are evicted first; expensive opaque entries have their own limit. Browser quota
rules can cause earlier eviction. Failed loads never create persistent entries.
TCGdex's CORS-enabled responses use their actual byte size. Storage denial or
quota exhaustion leaves normal image viewing and fallback sources available.

`tests/artwork-cache.test.mjs` checks eligibility, decoding confirmation, expiry,
limits, concurrent requests, no-store responses and quota failure. The real
service-worker browser test disables HTTP caching, checks reuse after reload,
and loads the decoded artwork offline. Clearing site data removes the cache.

Quota reference: <https://developer.chrome.com/docs/workbox/understanding-storage-quota>.

## Release validation

`npm test`, `npm run typecheck`, `npm run build` and `npm run test:card-images-ui`
cover source matching, bounded retries, image failures, source changes and the
production image policy. Browser tests use controlled responses, so GitHub builds
do not depend on live image-host availability. The existing Docker images and
upgrade script deliver the change without new deployment settings.

## Slow artwork investigation — 2026-10-17

The public production catalogue returned 781 English Pokémon records during this
inspection. The first page's 30 image elements loaded successfully from TCGdex.
Six sampled thumbnails and one full-size image returned HTTP 200; thumbnails
were approximately 16–22 KB and advertised a one-year HTTP cache lifetime.
Fresh sampled downloads took approximately 5.7–6.7 seconds from the inspection
environment. Catalogue and health responses also took several seconds, so these
observations do not isolate server load, network latency or a provider outage.
They are point-in-time observations, not a guarantee for every card or device.

Pokémon imports store card metadata and source image URLs, not local image files.
The artwork is fetched by each browser when viewed. The application does not
download the whole Pokémon image catalogue at startup, and the retired-mail
cleanup does not delete card records or catalogue artwork. Other supported games
already have separately imported, database-backed artwork. Browser caches can
be cold or evicted independently of a CardShelf upgrade.

Release 0.55.1 removes an extra loading dependency: private cards start loading
alongside facets, and public results render independently of set filters. Public
searches and pagination reuse the loaded set list. Filter failures no longer
hide successful card results. This reduces avoidable waiting; it does not remove
external artwork latency or add a persistent Pokémon artwork cache.

For further diagnosis, compare the catalogue JSON request with the first image
requests in the affected browser's Network panel, and correlate slow API reads
with app/database logs and host CPU, memory and disk pressure. Re-importing sets
is not required to repair an image-only loading delay. A future persistent image
cache would need bounded downloads, validated exact source identities, safe
storage and provider-terms review; it is outside this loading fix.
