# CardShelf 0.26.1

Independent, self-hosted card collection software. Public product pages lead into a
private collector workspace with card catalogues, collection records, set/series
binders, quick tracking, artwork effects, binder themes and a member marketplace.

## Emails

**More → Emails** brings Postal connection settings, setup checks and delivery
management into CardShelf. Administrators manage the sending identity and encrypted
Postal API credential; members choose their optional activity notifications.
Password recovery and account security notices use the same delivery service.

The new installation defaults are `https://cardshelf.cloud` and
`https://postal.cardshelf.cloud`. Existing installations retain their configured
origin until the operator changes it. Postal is an optional, separately operated
mail service: saving application settings does not install containers, publish DNS
records or establish compliance. See [Postal setup and operation](docs/POSTAL_EMAIL.md)
for installation, domain authentication, certificates and acceptance checks.
See [v0.20 validation](docs/POSTAL_VALIDATION.md) for executed checks and their limits.

## Arena

[Phase 5](docs/ARENA_UI_PHASE5.md) adds an optional focused table view, contextual
turn/connection guidance, public Prize counts, a revision-bound End turn confirmation,
and searchable recent history in an accessible dialog. Help also opens without
moving the board. The existing guarded writer and private state remain unchanged.
A separate signed-in Chromium/WebKit suite exercises the built application against
a disposable PostgreSQL database, including a complete automated practice game.

[Phase 4](docs/ARENA_UI_PHASE4.md) adds bounded feedback for confirmed card movement,
attacks, damage, conditions, coin results, Stadiums and turns. Draw/Prize travel uses
anonymous backs; visible card travel uses surviving disclosed identities only.
Battle effects can be turned off, and reduced-motion preferences retain text feedback.
No additional game requests, dependencies, database storage or server service is added.

[Phase 3](docs/ARENA_UI_PHASE3.md) adds playable-hand indicators, public legal-target
highlighting, mouse dragging, a dedicated touch drag handle and keyboard/tap target
selection. Dropping opens a confirmation; only confirming forwards an unchanged
server-issued action. Existing rules, server validation and private views are retained.
The [Phase 1/2 foundation](docs/ARENA_UI_REFRESH.md) includes the opposite-table shell,
interactive private hand fan, explicit action tray and resumable inspection/decisions.

The automated Arena now includes supported Pokémon EX/ex, Mega Evolution,
Abilities, separate Pokémon Tools, shared Stadiums and multi-step Trainers.
Computer practice offers Matched Deck, Mirror Deck and Choose Opponent Deck
using supported saved catalogue cards. Existing Core matches keep their original
rules. See [the expansion notes](docs/ARENA_EXPANSION.md) for exact card coverage,
validation and the v0.18.0 patch instructions.

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
- Historical migrations and financial records are preserved. The Postal extension adds
  email configuration and delivery records; the optional deployment adds Postal and its
  own MariaDB database alongside the existing CardShelf services.

## Stripe-managed product catalogue

Version 0.11.0 adds **Platform administration → Stripe product catalogue**: opt in once,
then manage product descriptions, uploaded images, unit labels, marketing features,
monthly/yearly prices and tax in Stripe. Use **Sync now** or the optional 24-hour sync.
Live product details can also populate the read-only platform plan records. Existing
subscription snapshots and tester/Complimentary access are preserved; syncing does not
enable billing. See [Stripe product setup, limits and acceptance](docs/STRIPE_PRODUCTS.md).
