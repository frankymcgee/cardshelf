# CardShelf · v0.2.0

A standalone, self-hosted Pokémon card collection and binder planner. No Frappe,
ERPNext, Verto, Pilot, BinderBuilder account or BinderBuilder API dependency.

## What's new

- Automatically refreshed TCGplayer printing prices via TCGdex; separately labelled
  Cardmarket card-level references, AUD conversion and recorded price history.
- Coverage-aware collection and planned-binder estimates. Missing, uncertain or stale
  prices are not silently treated as zero or included as current values.
- Create new binders from imported sets or collection series. Choose owned-only or
  full-catalogue layouts, one pocket per design or known printing, page boundaries,
  natural collector-number sorting and automatic volume splitting.
- Preview before creation, partial-import warnings and retry-safe generation. Existing
  ownership and binder layouts are not changed.

Card scanning, photographs, AI integrations, alerts and physical-copy allocation are
not included. See [the feature and upgrade guide](docs/PRICING_AND_SERIES.md).

## Existing features

Private accounts and collections, English/Japanese catalogue imports, printing and
condition quantities, wishlist/notes, drag/tap binder editing, revocable read-only
sharing, printing placeholders, JSON/CSV ownership imports/exports and server backups.
Binder placement is a plan, not a reservation of a physical copy. Catalogue variant
flags are not a verified complete master checklist. Collection completion counts
imported card designs, not every possible printing.

## Deploy independently

Linux server with Docker Engine and Compose. Nuxt/Vue application, PostgreSQL 17,
background worker, one-shot migrations and optional Caddy HTTPS proxy. The image is
built from source; no pre-published CardShelf container image is required.

For a first installation, configure DNS and reachable ports 80/443, then:

```sh
sh scripts/configure.sh https://tcg.webwire.cloud
docker compose -f compose.yaml -f compose.https.yaml up -d --build
```

Save the first-use token privately, create your administrator account, then import
sets through Data & settings. Do not commit .env, setup tokens or database dumps.
Do not run configure.sh again on an existing installation.

For an upgrade after the release is merged and GitHub validation passes:

```sh
git pull --ff-only
sudo sh scripts/upgrade.sh
```

The helper builds first and takes a local safety backup automatically, then migrates
and restarts app/worker without changing credentials, database volumes or the proxy.
Never use `docker compose down -v` to upgrade.

## Pricing and connectivity

Price requests use api.tcgdex.net; AUD rates use api.frankfurter.dev with ECB filtering.
No API keys are required by these integrations. Availability and coverage depend on
the upstream sources. Images still load from assets.tcgdex.net. Normal collection and
binder writes use your local database. Offline collection editing is not implemented.

Tracked cards are owned, wishlisted or planned. Default refresh interval is six hours,
subject to the queue and upstream freshness. This is not a second-by-second price feed.
Currency-converted market estimates are not condition-specific appraisals or local
Australian sale prices. Source dates, FX dates and exclusions are shown explicitly.

## Validation

```sh
npm test
npm run typecheck
npm run build
```

GitHub Actions additionally runs migrations and the isolated API/PostgreSQL integration
suite. Use its result for this release, not the successful 0.1.1 baseline. The authoring
runtime can run dependency-free tests but cannot run the full Docker/PostgreSQL stack
or resolve npm/provider hosts. Browser/device acceptance still needs deployment testing.

## Documentation

[Current features and upgrade](docs/PRICING_AND_SERIES.md) ·
[Deployment and recovery](docs/DEPLOYMENT.md) ·
[Architecture](docs/ARCHITECTURE.md) · [Import format](docs/IMPORT_FORMAT.md) ·
[Security](docs/SECURITY.md) · [Changelog](CHANGELOG.md)

The older baseline verification/parity reports are historical, not current CI results.
JSON/CSV exports are not full server backups; database dumps include sensitive accounts,
notes and layouts. Keep .env and full backups securely off-server.

This is independently written software. No BinderBuilder source, proprietary database,
branding or artwork is bundled. Review image/provider permissions before mirroring
artwork or distributing a public commercial service.
