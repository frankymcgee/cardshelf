# CardShelf 0.10.0

Independent, self-hosted card collection software. Public product pages lead into a
private collector workspace with card catalogues, collection records, set/series
binders, quick tracking, artwork effects, binder themes and a member marketplace.

## Memberships

Collector focuses on quick tracking and set/series checklists. Collector Plus adds
detailed inventory and conditions, pricing, custom binder layouts/themes and selling.
Protected testers and hidden Complimentary users retain all current capabilities.
Complimentary access is not an administrator role and requires no subscription.

Stripe is the only active subscription gateway. Administrators configure its encrypted
Test/Live credentials, reviewed recurring prices and subscription availability from
**Stripe integration**. New subscription availability and feature enforcement are separate
password-confirmed controls. Saving either does not automatically subscribe a person.

Pausing new sign-ups does not cancel existing renewals or already-issued checkout links.
Marketplace card payments and referral payouts are completed externally; the application
does not provide escrow, seller settlement, buyer protection or automatic referral transfers.

See [Stripe setup and activation](docs/STRIPE.md). Historical provider records remain
read-only and old setup documents are archived in `docs/history/`.

## Existing installation upgrade

Use a reviewed main branch after the complete validation workflow passes:

```sh
git pull --ff-only origin main && sudo sh scripts/configure-integrations.sh && sudo sh scripts/upgrade.sh
```

Keep the existing `.env`, database volume and integration encryption key. Do not run
`docker compose down -v`. The upgrade helper builds, takes its local safety backup,
applies additive migrations, then restarts the application. A failed migration requires
investigation; the script does not silently delete data or recreate the database.

The integration-key helper is idempotent. Never replace a working key: it is needed to
decrypt saved provider credentials. Keep a separate secured backup of `.env` and move
database backups off the server. Backup restoration should be rehearsed separately.

## Development and validation

The project uses Node.js 24, Nuxt, PostgreSQL and Docker Compose for deployment.

```sh
npm install
npm test
npm run typecheck
npm run build
```

The integration suite additionally requires a disposable database ending `_test`, the
explicit `ALLOW_TEST_DATABASE=yes` safeguard, migrations, and a built running server.
See `.github/workflows/ci.yml` for the exact isolated workflow. Never run integration
fixtures against the live site/database. Provider contract tests use synthetic responses;
complete real Stripe Test-mode acceptance before allowing Live charges.

This source update retains the existing CI gates. Tests belonging solely to the retired
Square connector are removed with that integration; provider-neutral access/referral and
integration-key tests plus Stripe payment tests remain, with new activation regressions.

## Operational boundaries

- A catalogue printing, a planned pocket, a quick tracking mark and an owned physical copy
  are distinct records. Planning/marking a binder does not invent inventory quantities.
- Market prices are indicative provider data, not guaranteed sale values or appraisals.
- Sharing is deliberate and revocable. Private accounts, inventory and payment credentials
  are not included in public binder layouts.
- Existing accounts are preserved. Public account requests do not automatically create
  a paid subscription. Administrators separately create subscription-ready new accounts.
- Migration 010 adds only subscription policy state. Applied migrations 001–009 and historic
  financial records are not rewritten. No new runtime dependency or service is introduced.
