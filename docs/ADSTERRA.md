# Adsterra for CardShelf

Version 0.49.0 adds a provider selector to **Administration → Advertising**
(the existing `/admin/adsense` address still works). Both providers use the same
Free-account eligibility, private-route exclusions, preview preference and master
switch. Migration `030_adsterra_advertising.sql` preserves the current provider
and enabled state; it does not activate Adsterra during deployment.

## Enable the supplied units

1. Choose **Adsterra** and click **Load CardShelf's seven units**.
2. Enable **Free-only Adsterra** and turn off **Show placeholder ad sections**
   when ready to serve real ads to eligible Free accounts.
3. Complete the approval/privacy confirmations, enter the existing administrator
   password and a reason, then **Save advertising settings**.
4. Administrators choose **Live ads** under **Your administrator ad view** and
   apply it before visiting a content page. Hidden remains the default.

No second copy of the scripts should be added to a header, proxy or theme. Site
ID `6105596` is not an installation tag. The preset uses the exact keys and
`https://bicea.org/21/` (native) or `/22/` (banner) URLs supplied for this site.
Blank a key to disable a format. Google IDs and verification settings remain
saved when switching to Adsterra, and vice versa.

## Placement map

| Unit | Key | Placement |
| --- | --- | --- |
| 728 × 90 | `17733ddbf4928c8d072d3bd37b4a55c9` | Wide horizontal content slots |
| 468 × 60 | `72e34d62383c0ae3a65639a5778b3ec3` | Medium-width horizontal slots |
| 320 × 50 | `7fb192d01279fc4b127486e5f575c2a5` | Phone-width horizontal slots |
| 300 × 250 | `678ddb8088f978d721c86525733320d1` | Pricing and public card details; grid fallback |
| 160 × 600 | `faeddf077d8bdd3a0ba2fa19cfd3229e` | Spare widescreen marketing margin when tall enough |
| 160 × 300 | `c2785ac2dc63dfcded992a2056a25470` | Shorter widescreen rail or narrow rectangle fallback |
| Native | `d9fdbc82c3f1b28625cdf17b8837521e` | Catalogue, Cards and marketplace grid tile |

The renderer chooses a fitting size before making a request. It never loads a
hidden desktop/mobile alternative, scales a banner, or reuses the same key twice
in a document. Resize, focus and filtering do not refresh ads. A loaded fixed-size
unit is retired if its container becomes too narrow. The native container adjusts
its height to the creative. A blocked loader collapses without retrying.

The rail only appears on the homepage/features at widths of at least 1800px, in
the unused outside margin. Ads do not replace card records or change totals.
Preview uses local sample layouts and makes no provider requests. Google Auto ads
continue to use their original loader and preview when Google is selected.

## Additional codes supplied, kept inactive

These were included alongside the seven inline units. Their behaviour is not
needed for the banner/native integration, so none is loaded or linked by the app:

- Page-wide script: `https://afders.org/1/de342e696d03e88f92c0dbf2dcba94b0`
- Page-wide script: `https://bicea.org/14/3c5a96b21552f49d8c407689b09881a8`
- Direct advertising link: `https://arwf.org/4/d15a49b25237d3f1e2e45bb8059b452e`

## Lifecycle and checks

Adsterra snippets run in separate sandbox frames, preserving their synchronous
`atOptions` + script pairing. The frames cannot read the parent app DOM, cookies
or storage. Native height/error messages are accepted only from the matching
frame window. The renderer requires server-issued eligibility, provider, revision
and a document nonce before requesting a script. Paid/protected accounts and
signed-out visitors receive neither provider; private routes are excluded.

The existing document-boundary flag also covers Adsterra. Opening a private card,
leaving the ad page, losing eligibility, or changing settings cannot leave an
advertising document active on a sensitive screen. A revision mismatch or failed
eligibility recheck moves an already loaded page to its `ads=off` view.

`npm test`, `npm run typecheck`, `npm run build`, the advertising integration
suite and `npm run test:ads-ui` cover settings, exclusions, provider switching,
production CSP, responsive placement, duplicate prevention and blocked scripts.
Browser tests replace provider requests with synthetic scripts; they never
request real creatives or generate live ad impressions. Actual fill, approval,
ad categories and account-side configuration still need to be checked in
Adsterra after deployment. This update does not add a new consent platform.

References: [Adsterra banner setup and code reuse guidance](https://adsterra.com/blog/how-banner-ads-make-money/),
[native banner setup](https://adsterra.com/blog/turn-a-profit-with-native-banners/).
