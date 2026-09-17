# CardShelf · v0.7.0

Standalone card collection, binder planning and collector marketplace software.
Nuxt/Vue, PostgreSQL and Docker; independent of Frappe and ERPNext.

## This release

Optional **Square-hosted recurring subscription invoices**, administrator tier management,
a hidden non-expiring **Complimentary** full-feature tier, and approved/opt-in referrals
with administrator-defined rewards and a manual payout ledger. **Marketplace card-sale
payments remain between collectors.** No marketplace checkout, escrow or payout processing.

Upgrade defaults keep billing and membership enforcement OFF. Existing testers retain
full access and do not need a subscription. Actual Square Sandbox verification is required
before production activation. This release does not onboard a stored card or automate
referral transfers. See [Square, memberships and referrals](docs/SQUARE_AND_REFERRALS.md).

## Collector tools

Private accounts; English/Japanese catalogue imports; independent quick tracking binders;
set/series generation; detailed inventory, printing/condition quantities and notes;
custom binder layouts/wallpapers/variant effects; AUD market-price estimates; revocable
sharing; printable checklists; collection imports/exports; and classified card listings
with seller photos and private enquiries. Scanning, escrow and full offline editing are
not included. Tracking marks are independent checklists, not physical-copy allocations.

## Existing installation upgrade

After the release is merged and full GitHub validation is green:

```sh
git pull --ff-only origin main && sudo sh scripts/upgrade.sh
```

The helper builds first, takes its automatic local backup, migrates and restarts services.
Keep your existing `.env`, database volume and accounts. Never run `docker compose down -v`
for an upgrade. Square settings are optional and start disabled; no API keys are needed
for the existing catalogue or pricing features.

## First installation

On a separate Linux server with Docker Engine/Compose, configured DNS and ports 80/443:

```sh
sh scripts/configure.sh https://tcg.webwire.cloud
docker compose -f compose.yaml -f compose.https.yaml up -d --build
```

Keep the generated setup token private, create the first administrator, then import sets.
The source builds on your server; no pre-published container image is required.

## Validation

```sh
npm test
npm run typecheck
npm run build
```

GitHub additionally runs the production server, migrations and isolated PostgreSQL/API
integration suite. Financial tests use mocked provider contracts and block external Square
calls; they never move money. Successful CI is not verification of your live Square account,
real-device behaviour, payment terms or a public commercial launch.

## Documentation

[Memberships/Square/referrals](docs/SQUARE_AND_REFERRALS.md) ·
[Marketplace](docs/MARKETPLACE.md) · [Tracking binders](docs/TRACKING_BINDERS.md) ·
[Appearance](docs/APPEARANCE.md) · [Public website](docs/PUBLIC_WEBSITE.md) ·
[Prices and series](docs/PRICING_AND_SERIES.md) · [Deployment](docs/DEPLOYMENT.md) ·
[Architecture](docs/ARCHITECTURE.md) · [Security](docs/SECURITY.md).

Older release notes and verification reports describe their release, not current CI.
Database backups include sensitive accounts, subscription/referral records and messages;
collection CSV/JSON is not a full backup. Review provider/artwork permissions and operator
policies before commercial publication. No BinderBuilder source or proprietary assets
are bundled.
