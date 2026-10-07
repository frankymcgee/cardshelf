# Free-only Auto ads and marketplace placements — v0.16.0

Updated for v0.50.0: signed-out visitors are also eligible on the public website
and reference catalogue pages below. Both providers share these audience rules;
see [Adsterra setup](ADSTERRA.md) for its banner/native formats.

## Scope and defaults

This release adds opt-in Google Auto ads and one manually positioned marketplace
ad card. Existing catalogue display ads and site verification are preserved.
The two new placement switches start **off**, including on installations that
already enabled the old catalogue display unit.

Among signed-in members, only an account whose **effective** access is explicitly
`free_account` and tier `free` is eligible. Administrators default to Hidden and
can select Live ads in their browser. Collector, Collector Pro (internal `plus`),
Complimentary users and protected testers are excluded. A
pending/current Stripe subscription or remaining paid period also suppresses
advertising, even if a Free marker exists. An account with uncertain permissions
is never assumed to be Free. No billing settings or subscription charges change.

## Allowed pages

With **Allow Auto ads** enabled, the following existing pages may load Google's
script for public visitors and eligible Free users:

- Website: `/`, `/features`, `/pricing`.
- Reference catalogue: `/explore` and recognised card-detail URLs below it.
- Signed-in content (Free accounts only): `/app`, `/cards`, marketplace **browse** at `/marketplace`.

This is not a global header insertion. New/unknown routes are excluded. Password
forms, registration, recovery, account/settings, subscription/payment screens,
administration, referrals, private messages, selling/moderation, individual sale
details, private card editors, binders, battle/deck/match screens, sharing and
printing routes stay ad-free. Privacy and access-request pages also stay ad-free.
`/marketplace?mine=1` (and equivalent private query forms) is excluded.
`?ads=off` is an explicit per-document exclusion, not an account preference.

Empty/error catalogue or marketplace results do not initiate advertising.
The overview waits for a populated catalogue. Google still determines whether a
page is eligible for ad delivery; configuration does not guarantee approval,
fill, placement, earnings or an advertisement on every application screen.

## Marketplace card

Enable **Place an advertisement in the marketplace card grid** and provide a
separate responsive **Display** ad-unit ID. Do not use an In-feed template ID.

The manually placed ad occupies one normal listing-grid cell, with the same
column width and stretched row height. Its upper area follows the listing art
area's 5:7 ratio. It is labelled **Advertisements**, has a distinct dashed border,
and says it is advertising rather than a card for sale. It has no seller,
asking-price badge, ownership control or wrapping sale link.

One tile is inserted after the sixth listing, or after the final listing if the
page has four or five listings. Below four listings there is no manual ad tile.
Auto ads can still operate on a populated eligible browse page when that mode is
selected. Listing count, prices, filters, sort order and pagination contain only
real sale records. The ad neither replaces a card nor appears in database results.

The slot uses an inline variable width and measured fixed height, without
`data-ad-format="auto"` or full-width expansion. The returned creative is not
cropped, scaled, styled internally or disguised as a card. **Google may return a
smaller creative or no ad at all**; the guaranteed layout is the container, not
an exact creative size. Google-reported unfilled manual units collapse.

Filtering or pagination does not remount/re-request the manual display unit. If
it is removed by a low-density view, it stays retired for that document. A
controller first used for Auto-only advertising cannot later create an empty
manual tile. There is no timed advertising refresh or repeated request to fill
an empty unit.

## Free marketplace browsing

Free users previously could not list marketplace inventory. This update gives
explicit Free accounts **read-only browsing** of active/reserved visible listings,
with existing seller-photo and hidden-listing protections retained.

It does not grant the paid `marketplace_browse` capability used for initiating
private enquiries, or `marketplace_sell`. The access endpoint now distinguishes
`can_browse` from `can_enquire`. Selling, starting enquiries and ownership writes
retain their prior membership checks. Existing conversation access is unchanged.

## Configure Google first, then CardShelf

1. In Google AdSense, check the approval and verification status of your current
   site, **cardshelf.cloud**. Keep its correct publisher meta tag and `ads.txt`.
   Do not reuse approval assumptions from the former hostname.
2. Under Google **Privacy & messaging**, publish and test the required consent
   message and privacy-options/revocation control for your audiences. Google's
   certified CMP requirements apply to relevant EEA, UK and Swiss traffic.
   The CardShelf administrator acknowledgement is not a visitor-consent system.
3. Under **Ads → By site → Edit**, enable Auto ads for the site and review the
   chosen formats, density and page exclusions. Start with in-page formats;
   review anchor/vignette behaviour against the mobile app navigation before
   using overlays. These settings are managed in Google, not through a CardShelf
   Google-account API connection.
4. Add private page/section exclusions in Google as defence in depth: account,
   settings, administration, login/registration/recovery, membership/billing,
   referrals, binders, battles, print/shared pages and marketplace private areas.
   Google page exclusions do not target query-string modes; CardShelf's
   server-side allowlist handles those independently. Do not exclude the entire
   marketplace section when you intend Auto ads on its browse index.
5. Create a responsive Display unit for the marketplace. Disable Google's option
   to optimise/reposition existing ad units when preserving the explicit card-grid
   position. Review any ad experiments that could change the placement.
6. In CardShelf **Google AdSense** (`/admin/adsense`), retain the publisher ID and
   optional catalogue display ID; enable the desired new modes and enter the
   marketplace display ID. Confirm the scope, consent and Google configuration,
   supply a reason and your administrator password, then save.

Auto-only mode needs a publisher ID, not a fabricated display slot. The old
catalogue display unit and new marketplace display unit are independent options.

**Important:** Google Auto ads uses the same official `adsbygoogle.js` loader as
manual units. CardShelf's Auto switch controls where its loader may be introduced;
it cannot remotely turn off Auto ads in your Google account. To stop all automatic
placement while retaining manual units, turn Auto ads off **in Google too**.
Do not install an additional global script through the header, proxy, theme or
Tag Manager: that would bypass this application's Free-only checks.

## Lifecycle and privacy

Ad metadata and eligible HTML documents are private/non-cacheable and vary by
session cookie. A per-document nonce/revision is issued only after the server
checks eligibility. The client then checks eligibility again before inserting
one official loader. No private inventory, email, password or subscription data
is placed in its configuration payload.

However, a third-party script runs in the eligible page's browser context.
Google/partners can process page URLs, rendered content, device/IP information,
identifiers and consent signals according to their policies. Permitting Auto ads
on signed-in content is not the same privacy boundary as loading no third-party
code. Review your disclosures and do not display sensitive notes on ad-enabled
pages. This feature does not claim to sandbox Google from all same-origin data.

Moving away from a document that loaded Google replaces that document. Removing
only the script element would not undo third-party code. Ad-free users keep normal
client-side routing; an advisory server check decides whether entry into a new
ad-capable page needs a fresh document. Failed ad checks do not block navigation.

Opening private card details first blocks pending loaders synchronously. If
Google already loaded, CardShelf opens an ad-free `/cards?ads=off&card=…` document
before fetching/showing the private editor. Closing the editor does not re-enable
ads within that document. Cards, wishlist and binder data are not changed.

Open pages recheck eligibility on focus/visibility and every 60 seconds. Logout,
changed account, changed ad configuration, a failed check or lost eligibility
causes an **ad-free** document reset; it is not a timed new ad impression. Thus a
remote tier change can take until the next successful check/focus to retire an
already-open ad document. Navigation and payment-return flows use fresh checks.

## Deployment and acceptance

The additive migration `016_adsense_auto_marketplace.sql` installs new default-off
fields and replaces only the original three-column enabled/display-slot guard so
Auto-only configuration is valid. Existing publisher/verification constraints
remain. An unexpected manually altered schema stops migration for review rather
than dropping arbitrary constraints.

No dependencies, Docker services, API keys, SMTP settings or `.env` secrets change.
Keep the existing integration encryption key and database volume. Never rerun the
initial configuration script over an existing installation.

After CI passes, merge the patch and run the existing Ubuntu upgrade procedure:

```sh
git pull --ff-only origin main && sudo sh scripts/upgrade.sh
```

Test separately with one explicitly Free account, one paid account and one
protected tester. An administrator is deliberately not an ad-preview account.
Check desktop/mobile, empty searches, pagination, a private card dialog, logout,
a remote upgrade, and Google consent/refusal behaviour. Never click your own ads
or enable real Google ad requests in automated tests. Google site review and
actual serving, especially on login-protected application screens, remain
installation acceptance checks rather than guaranteed outcomes of this patch.

## Primary references reviewed

- Auto ads: https://adsense.google.com/start/solutions/auto-ads/
- Shared code: https://blog.google/products/adsense/introducing-new-and-improved-auto-ads/
- Responsive-code sizing: https://support.google.com/adsense/answer/9183363
- Page exclusions: https://support.google.com/adsense/answer/9262311
- Placement policy: https://support.google.com/adsense/answer/1346295
- Consent: https://www.google.com/about/company/user-consent-policy-help/
