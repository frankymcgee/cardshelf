# CardShelf 0.45.0

Independent, self-hosted card collection software. Public product pages lead into a
private collector workspace with card catalogues, collection records, set/series
binders, quick tracking, artwork effects, binder themes and a member marketplace.

## Complete your binder

Open a binder and choose **Complete this binder** to see missing printings, add
selected cards to your wishlist together, and find exact matches in active member
listings. Collection binders use owned printings; Tracking binders retain their
independent checklist marks. See [the completion workflow](docs/BINDER_COMPLETION.md).

## Pricing and membership scan allowances

**More → Administration → Pricing & plans** brings Free, Stripe product sync,
Test pricing preview and public pricing together. Free is a built-in $0 tier;
no Stripe product or subscription is needed. Paid product details continue to
come from Stripe, and the Test preview remains read-only.

Set scan limits under **Administration → Card scanning → Monthly scans by
membership tier**. `0` means unlimited member scans. The shared USD budget still
applies. Limits reset each UTC calendar month; changing tier does not reset usage.
Existing collection/game access rules are unchanged: Free remains catalogue-only,
and Collector needs collection access (available while enforcement is off) to scan.
Plus/Pro, Complimentary and protected testers retain their existing scan access.
Migration `023_scan_tier_limits.sql` starts every tier with your previous global
limit. Save changes with your administrator password.

The Administration home groups and searches all tools. The request inbox now
focuses on website requests; member management stays in Memberships & referrals.

## Ad placeholders and administrator preview

Under **More → Google AdSense**, enable **Show placeholder ad sections** and save
with your administrator password and a reason. This replaces live Google ads for
eligible Free members and needs no Google approval or IDs. Disable placeholders
when you are ready to enable approved live advertising. Migration 022 adds the
setting, defaulting off.

**Your administrator ad view** separately offers Hidden (default), Placeholder
preview, and Live ads. Apply the choice, then follow a preview link. The choice is
for your account in that browser; live ads still require enabled, approved site
settings. Previews use local illustrative placements, not Google's predicted Auto
ads layout. Private routes and paid/protected member exclusions are preserved.

### Auto ads placeholder formats

All placeholders represent Google Auto ads, with no manual unit ID required.
Grid previews are additional labelled tiles, never card records: totals and pagination
remain unchanged. With fewer than six cards, the preview follows the last card.
Google still chooses live positions; the sample grid tile does not reserve a real ad.
They illustrate possible formats, not Google's placement predictions or reserved sizes.

| Page | In-page preview | Overlay preview |
| --- | --- | --- |
| Homepage | Large banner, 970 × 250; compact on phones | Dismissible anchor and widescreen side rail |
| Features | Multiplex grid, four columns or two on phones | Dismissible anchor and widescreen side rail |
| Pricing and public card detail | Responsive 300 × 250 rectangle | None |
| Public catalogue and Cards grid | Card-sized Auto banner rectangle after six cards | None |
| Cards list view and collection overview | Horizontal banner | Dismissible anchor above mobile navigation |
| Marketplace browsing | Card-sized Auto banner rectangle after six listings | None |

The 160 × 600 rail preview requires a viewport at least 1800px wide and 800px tall.
Overlay close buttons affect the local preview only. Empty/error content and private
pages remain excluded. Real Auto ads are still selected and served by Google; enable
Banner/Multiplex and Anchor/Side rail in the Google site's Auto ads settings as desired.
Vignettes and ad intents are interaction-driven and are not simulated here.

Sources: [Auto ads formats](https://support.google.com/adsense/answer/9261805),
[settings](https://support.google.com/adsense/answer/9305577),
[anchors](https://support.google.com/adsense/answer/15484692),
[side rails](https://support.google.com/adsense/answer/16531757),
[Multiplex](https://support.google.com/adsense/answer/16532969).

## Card photo scanning

Open **Collection → Scan a card**, or start from a Pokémon Collection or Tracking binder.
Take or upload one English or Japanese card photo, review catalogue matches,
choose its printing and condition, then confirm the copies to add. Optional binder
placement finds an existing matching pocket or the first empty pocket automatically.
Choose another empty Collection pocket for an extra placement, or mark a prepared
Tracking pocket collected. The selected binder is retained between scans, and
guarded Undo restores the changes made by that scan.

Choose **Scan a batch** to queue up to 20 separate card-front photos. Recognition
runs sequentially with pause/resume, duplicate-photo detection and existing tier
allowances (`0` is unlimited). Review each card’s exact printing, condition and
quantity before saving to the shared binder destination. Queue request IDs survive
a reload in the same tab; photos do not, so reselect unprocessed originals when
resuming. Saved receipts recover without another paid analysis.

Scanning starts disabled. **More → Administration → Card scanning** lets administrators save an
encrypted OpenAI API key, choose the model and reasoning settings, edit the
recognition prompt, and set model prices, a shared budget and member allowance.
Usage reports support a future GPU hosting comparison. The existing CPU server handles
bounded image preparation; recognition runs through the OpenAI API. See
[scanning setup, accounting and privacy](docs/CARD_SCANNING.md).

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

Private [tournaments](docs/ARENA_TOURNAMENTS.md) now support invited entrants, random
seeds, byes, automatic single-elimination advancement and administrator commentary
with both hands kept private. Open **Arena → Tournaments** to organise or join an event.

The [lobby and deck workshop](docs/ARENA_WORKSHOP.md) add illustrated deck shelves,
quick return to an open table, catalogue-wide supported-card filtering, import review
and separate deck copies. Mobile workshop tabs keep card search and the current draft
within reach. Imported or duplicated lists are saved only after an explicit Save deck.

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

## Mobile installation and push notifications

Open **More → App & notifications** to install CardShelf and enable updates on
each device. The Home page also offers a dismissible install prompt. Chrome and
other supporting browsers open their native install dialog; iPhone and iPad show
Home Screen instructions. On iOS/iPadOS 16.4 or later, add the app to the Home
Screen, launch it from that icon, sign in, then enable notifications.

Push is optional and requires a public HTTPS `APP_ORIGIN`, a supported browser,
and notification permission granted after pressing **Enable notifications**.
Choose marketplace enquiries/replies and administrator membership updates
independently on each device. **Send test notification** queues a test to that
device only. Notification text does not include private messages. Email choices
are separate. Signing out, changing/resetting a password, deleting the account,
or session expiry revokes delivery for that sign-in; enable push again after a
new sign-in. Notifications already accepted by a push service may still arrive.

The app generates its VAPID key pair once in PostgreSQL. Normal database backups
and image upgrades preserve it; no additional environment variables, Firebase
project, Apple developer account or paid service are needed. Treat database
backups as sensitive because they contain the private key and device credentials.
Outbound HTTPS must reach the browser push services: `fcm.googleapis.com`,
`updates.push.services.mozilla.com`, `*.push.apple.com` and `*.notify.windows.com`.
The app processes a durable queue every five seconds, retries transient failures
up to three attempts, and removes expired subscriptions. Provider acceptance does
not prove device display: check Focus/Do Not Disturb, browser/site permissions,
and OS notification settings if a test does not appear. The app does not support
offline collection editing.

## Existing installation upgrade

GitHub now builds and tests the release images. After the **Publish release images**
job succeeds, update the existing server with:

```sh
sudo sh scripts/upgrade.sh
```

For the **first switch to GitHub-built images**, follow the short
[registry login and setup instructions](docs/GITHUB_SETUP.md#one-time-switch-for-the-existing-server).
The helper pulls while the site stays online, backs up PostgreSQL, migrates, and restarts
only app/worker. It pins the exact release digest and waits for healthy containers.
Keep the existing `.env`, database volume and integration encryption key.

Routine updates need no build or `git pull`. When host deployment files change, the
helper asks you to update the reviewed checkout before it stops anything. An explicit
`sudo sh scripts/upgrade.sh --build` retains the slower source-build fallback.
Do not use `docker compose down -v`; keep secured off-server backups and rehearse recovery.

## Development and validation

The project uses Node.js 24, Nuxt, PostgreSQL and Docker Compose for deployment.

```sh
npm ci
npm test
npm run typecheck
npm run build
```

The integration suite additionally requires a disposable database ending `_test`, the
explicit `ALLOW_TEST_DATABASE=yes` safeguard, migrations, and a built running server.
See `.github/workflows/ci.yml` for the exact isolated workflow. Never run integration
fixtures against the live site/database. Provider contract tests use synthetic responses;
complete real Stripe Test-mode acceptance before allowing Live charges.

Automatic feature validation runs on pull requests, without a duplicate branch-push
run. New PR revisions cancel superseded application and Arena validation. Merges to
`main` retain the complete release gates. See [validation triggers](docs/GITHUB_SETUP.md#validation-triggers).

This source update retains the existing CI gates. Tests belonging solely to the retired
Square connector are removed with that integration; provider-neutral access/referral and
integration-key tests plus Stripe payment tests remain, with new activation regressions.

## Operational boundaries

Collection overview and Collection binders include **7 / 30 / 90 day value graphs**.
Snapshots retain that day's quantities, prices, AUD rates and pricing coverage; history
starts with recorded observations after upgrading. Card details also chart each provider,
finish, metric and currency separately. See [value history](docs/VALUE_HISTORY.md) for
the recording schedule, privacy boundaries and change breakdown.

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

Version 0.11.0 adds **Administration → Pricing & plans → Stripe product catalogue**: opt in once,
then manage product descriptions, uploaded images, unit labels, marketing features,
monthly/yearly prices and tax in Stripe. Use **Sync now** or the optional 24-hour sync.
Live product details can also populate the read-only platform plan records. Existing
subscription snapshots and tester/Complimentary access are preserved; syncing does not
enable billing. See [Stripe product setup, limits and acceptance](docs/STRIPE_PRODUCTS.md).

## Affiliate shops

More → Administration → Affiliate shops manages up to 12 external shops. Paste programme-issued HTTPS links, optionally add a supported search URL containing `{query}` and a referral/coupon code, then choose placements and games. Links start disabled and have a live preview, ordering controls and optional expiry (end of the selected UTC day). Migration `024_affiliate_shops.sql` starts with no shops configured. The saved marketplace visibility panel reports which links visitors can currently see; its count refreshes after saving, separately from the draft preview.

**Start with Amazon** creates paused entries for binders, sleeves and card packs. Paste complete Associates links from SiteStripe or Mobile GetLink; Amazon links are preserved unchanged, labelled as Amazon, and include the required Associate disclosure. No Amazon API key is needed for these text links. Confirm CardShelf's existing price-history functionality with Amazon before enabling links: its participation rules restrict price-tracking sites unless Amazon agrees. See the [Amazon setup notes and official sources](docs/affiliate-shops.md#start-with-amazon-binders-sleeves-and-packs).

**Manual product cards** add a product name, your own description, a locally uploaded photo and a **View on Amazon** or **View at shop** button. Choose **Add product card** or change an existing entry's display type. JPEG, PNG and WebP uploads are limited to 1 MB; use images you own or have permission to publish. Uploads stay private until the entry is saved and enabled. No price, stock status, checkout, scraping or retailer API access is involved. Product destinations stay fixed during searches. Migration `025_affiliate_product_images.sql` stores images on the server.

Marketplace products and shops appear as tiles in the main listings grid, with randomized positions that stay steady during a visit. Each has an Affiliate link label, and the full affiliate disclosure sits below the results. Collector sorting and pagination are preserved.

These optional shopping links appear on marketplace browsing, collection card details and public catalogue card details. They are labelled as affiliate links for all tiers; they do not load advertising scripts or contact a shop until a visitor follows a link. No stock, price or commission is inferred from a URL. Existing member listings and enquiries continue as before.

Use the exact URLs and codes approved by each programme. Affiliate IDs are public; do not paste credentials. CardTrader documents issued code rewards for eligible Zero purchases, but a normal URL/API key does not earn commission by itself. Marketplace data access and buying through its API require a separately agreed integration; this release does not place orders or import CardTrader offers. [Integration notes](docs/affiliate-shops.md).
