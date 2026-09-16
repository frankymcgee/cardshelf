# CardShelf · v0.1.1

**A standalone, self-hosted card collection and binder planner.**

CardShelf is an independently written starting point for a BinderBuilder-style
application. It has no dependency on Frappe, ERPNext, Verto, Pilot, BinderBuilder
accounts, or BinderBuilder APIs. “CardShelf” is a working product name.

> **Release status: initial implementation / deployment candidate.** The source,
> Docker configuration, migrations, UI and tests are included. The original 55
> dependency-free core tests pass. A full dependency install, Nuxt typecheck and
> production build, PostgreSQL integration suite, Docker start, browser run and
> backup restoration could **not** be executed in the authoring environment.
> That environment has no Docker/PostgreSQL server and cannot resolve npm/API
> hosts. Do not treat this package as a fully validated production release.
> See [the verification report](docs/VERIFICATION.md).

## Included in this implementation

- Protected first-administrator setup; private user accounts; password changes;
  hashed server-side sessions; per-user collections and binders.
- English/Japanese TCGdex set imports through a persistent background job queue;
  local card data; search by name, number, illustrator, set, language, rarity and
  Pokédex number; grid/list views; owned/missing/wishlist filters.
- Printing- and condition-specific quantities, wishlist flags and notes, with
  optimistic concurrency checks. Administrators can add missing manual printings.
- Configurable 2–4-column, 2–4-row binders with up to 60 pages; desktop spreads;
  drag-to-swap and click/tap-to-move; safe resizing; empty/missing-card planning.
- Revocable, rotatable read-only binder links. Shared pages exclude private
  ownership quantities, condition records, notes, email addresses and user IDs.
- Ownership JSON/CSV export; previewed imports with unresolved-row reporting and
  replay-safe maximum-quantity merge; printable placeholders and checklists.
- Docker Compose packaging, optional Caddy HTTPS, migration locking, health
  checks, backup/restore scripts and a CI/integration test definition.
- PWA manifest and an offline information page. **Offline collection browsing or
  editing is not implemented.** No authenticated API responses are cached.

## GitHub publication

The source is prepared for a private `frankymcgee/cardshelf` repository on `main`.
The repository has **not** been created or populated by this package. See
[GitHub setup](docs/GITHUB_SETUP.md) for the remaining account-side step and
[this preparation report](docs/GITHUB_PREPARATION.md) for the latest checks.
Never commit `.env`, setup tokens or database backups.

## Start on your own server

You need Docker Engine with the Compose plugin on a Linux server. The first build
needs network access to npm and the container registries. Importing catalogue
updates needs access to `api.tcgdex.net`; card images currently load directly from
`assets.tcgdex.net`. Existing locally imported card records and collection writes
are independent of the catalogue API, but images are not independently hosted.

### HTTPS on a domain

Point your domain at the server and allow ports 80 and 443 to reach it. From the
extracted `cardshelf` directory:

```sh
sh scripts/configure.sh https://tcg.webwire.cloud
docker compose -f compose.yaml -f compose.https.yaml up -d --build
```

The default deployment domain is `tcg.webwire.cloud`; an explicit different origin
is still supported. The configuration script
creates random database/setup secrets in a private `.env` file and prints the
first-use setup token. Open your configured domain, create the administrator
account using that token, then open **Data & settings → Catalogue imports**.
Select a language, load available sets, choose a set and click **Import set**.
The import progress and any errors appear on that page. You can also enter a
known set ID directly; `base1` is an example for the English Base Set.

**This repository contains source, not a published container image.** Docker
Compose builds the image on your server; no CardShelf image registry account is
required. The Dockerfile runs unit tests, typechecking and the production build
and will stop if any gate fails. Do not bypass a failing gate; inspect its output.

### Local evaluation or an SSH tunnel

```sh
sh scripts/configure.sh http://localhost:3000
docker compose up -d --build
```

Open `http://localhost:3000` on that host. On a remote server, forward its loopback
port through SSH and use the same local URL. Do not casually expose HTTP port
3000 to the internet. The application binds to `127.0.0.1` on the host by default;
the database has no published host port.

After the first successful build, retain the resolved dependency lockfile:

```sh
docker compose cp app:/app/package-lock.json ./package-lock.json
```

Commit that lockfile to your own repository. Future builds will use `npm ci`.
Direct dependencies are pinned in this package, but the first build's transitive
resolution is **not** frozen until the generated lockfile has been retained.
Container base-image tags should also be pinned to validated digests as part of
your release process.

## Service layout

| Service | Purpose |
|---|---|
| `app` | Nuxt/Vue interface and authenticated API; Node.js 24 runtime |
| `db` | Dedicated PostgreSQL 17 database in a persistent named volume |
| `worker` | Queued per-set catalogue imports, progress, retries and housekeeping |
| `migrate` | One-shot, transaction-protected schema migration before app/worker start |
| `caddy` | Optional domain/HTTPS reverse proxy from `compose.https.yaml` |

There is no Redis, Kubernetes, cloud authentication provider or SaaS requirement
for normal collection/binder operations. Each deployment is independent.

## Important data rules

**Card → printing → ownership row.** Ownership rows are keyed by user, printing
and condition. They represent counts, not uniquely identified individual copies.
Binder pockets refer to printings and are plans; they do not reserve or create
physical copies. Showing one printing in several pockets does not increase your
quantity or guarantee you own enough copies for every placement.

**Printing data is not a verified master checklist.** The importer uses explicit
TCGdex variant flags. Independent edition/finish flags are not multiplied into
invented combinations. Edition flags with no reliable finish combination are
labelled “finish unspecified”. A missing variant map becomes “Unspecified
printing”. Administrators can add and label verified manual printings. Imported
rows are not deleted when a provider stops returning a flag, and manual
printings are not overwritten by import jobs. Corrections to existing provider
card names/artists/images are not editable in this initial UI.

**Completion measures imported card designs.** Dashboard set progress counts
unique card designs owned, not every printing/condition. Partial imports are
labelled. It is not a claim of complete master-set or all-language coverage.

**A failed import is visible.** Successful card records from that job remain
available. Failed card IDs are reported, the job is marked failed, and retrying
the set upserts data rather than replacing your ownership or layouts. Catalogue
refresh is currently queued manually, one set at a time; it is not scheduled.

## Backups and recovery

```sh
sh scripts/backup.sh
```

The custom-format database dump contains the entire database, including accounts,
password hashes, collection notes and binder layouts. Treat it as sensitive.
Back up `.env` separately and keep off-server encrypted copies. The scripts do
not automatically schedule backups, encrypt archives or copy them elsewhere.

Ownership JSON/CSV exports are **not full server backups**. They do not contain
binder layouts, accounts, the full catalogue or the original source data.

See [Deployment & recovery](docs/DEPLOYMENT.md) before restoring an archive or
updating an existing installation. Test a restoration before relying on backups.

## Testing

```sh
# No npm dependency install is needed for the pure core tests:
node --test tests/*.test.mjs

# On a connected development machine with Node 24:
npm install
npm run typecheck
npm run build
```

The integration suite requires a disposable, empty PostgreSQL database whose
name ends in `_test`, completed migrations and the production application process.
The provided GitHub Actions workflow defines that environment. It has **not**
been run or pushed to a repository by the authoring session.

See [Verification](docs/VERIFICATION.md), [Architecture & API](docs/ARCHITECTURE.md)
and [Import schema](docs/IMPORT_FORMAT.md).

## Not implemented yet

This is **not full BinderBuilder parity**. Still outstanding: market-price
integrations and valuation history; price alerts/email delivery; full offline
synchronisation and device-conflict reconciliation; direct import of actual
BinderBuilder exports; species/artist landing pages and master-variant completion;
verified comprehensive printing mapping; local artwork storage/permissions;
bulk set-to-binder filling and page reordering; graded/individual-copy records;
MFA, email invitations and email password recovery; physical iOS/Android QA.

## Upstream references and attribution

The implementation uses the documented TCGdex REST contracts. These references
explain the upstream data format; they do not establish complete parity:

- TCGdex: https://tcgdex.dev/
- Card endpoint: https://tcgdex.dev/rest/card
- Set endpoint: https://tcgdex.dev/rest/set
- Image URLs: https://tcgdex.dev/assets
- Language/data coverage: https://tcgdex.dev/status
- Nuxt deployment: https://nuxt.com/docs/4.x/getting-started/deployment
- Docker startup dependencies: https://docs.docker.com/compose/how-tos/startup-order/
- Caddy HTTPS: https://caddyserver.com/docs/automatic-https
- Public feature reference: https://binderbuilder.app/about and https://binderbuilder.app/pro

No BinderBuilder source code, proprietary database, branding or visual assets
are included. No Pokémon card artwork is bundled. Public-domain claims are not
made for card imagery or trademarks; review applicable provider permissions
before adding image mirroring or distributing a public commercial service.
