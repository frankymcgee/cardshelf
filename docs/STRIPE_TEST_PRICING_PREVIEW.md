# Stripe Test pricing preview — CardShelf 0.14.2

## Open the preview

Sign in as an administrator. In **Platform administration → Stripe product catalogue**, select **Preview Stripe Test pricing**. The link opens `/admin/integrations/stripe-preview` with the normal public website layout and the same pricing-table component as `/pricing`.

This page always reads the **saved Test / Sandbox catalogue**. The currently selected product-sync workspace and active billing environment do not change its data source. Test checkout and Live subscriptions can stay disabled. Existing administrator, tester and Complimentary access need not be removed or downgraded.

The header and each product card are labelled **TEST PREVIEW**. There are monthly/yearly display controls but **no purchase, membership-selection or checkout controls inside the preview table**. Header navigation back to administration or to the normal public website remains available. Visiting the real public pricing page leaves the preview; it continues to follow the existing Live-only rules.

## What is displayed

Saved published Test offers use their Stripe product name, description, approved image, unit label, marketing feature list, monthly/yearly AUD prices and tax wording. A comparable annual price also shows the saving against 12 monthly payments. An unavailable cadence is disabled; the renderer chooses an available cadence after a refresh.

Only supported, published Test offers are included, just as the public page includes published Live offers. Archived or paused offers are excluded. Previously supported manually published Test offers remain previewable with the same default labels as the public renderer when they have no product presentation snapshot. No product, price or feature is invented when the Test catalogue is empty.

Descriptions and features remain plain text; images reuse the existing approved Stripe-host checks and broken-image fallback. Clearing a field in Stripe is reflected after a successful product sync. The preview does not add another data provider, currency, billable plan or API dependency.

## Refresh is not sync

**Refresh preview** reloads the current database snapshot; it does not call Stripe's billing API, publish an offer, change the active environment or initiate a checkout. Product images may load from the same approved image hosts used by the public pricing page.

To pick up a change made in Stripe, return to the product catalogue, select **Test / Sandbox**, and run the existing **Sync now** action. Then refresh the preview. The existing optional daily sync can also update the snapshot.

The preview shows the last successful Test sync time. A failed sync displays a warning while showing the last saved catalogue. A missing catalogue displays setup guidance. A failed preview request clears its previous displayed data, including after a session expires or administrator access is lost. Re-focusing the window rechecks the private endpoint; there is no background polling loop.

## Access and data isolation

The new GET endpoint `/api/admin/integrations/stripe/products/preview` authenticates the session and checks the actual administrator role. The database reader rechecks the role in a read-only, repeatable-read transaction. Free, Collector, Collector Pro, tester and Complimentary users without the administrator role do not receive the preview.

The environment is fixed to `sandbox`; query parameters are rejected. No credential decryption or billing-readiness check is needed to view already-saved data. The response deliberately omits offer IDs, Stripe price IDs, terms hashes, subscription/customer details and raw provider error text. Product identifiers remain part of the existing presentation shape, but are not checkout identifiers.

The endpoint returns `Cache-Control: private, no-store`, `Vary: Cookie`, and `X-Robots-Tag: noindex, nofollow`, including authorization errors. The page stays under the existing client-rendered, protected `/admin/**` route rules, is not added to the sitemap/public-page list, and does not put Test products in server-rendered HTML. Preview state is local to the component, not a shared public `useFetch` cache or persistent browser storage.

The ordinary public pricing endpoint is unchanged: only saleable enabled Live offers are returned. Query parameters on `/pricing` cannot activate this preview. Checkout, subscription verification, user grants, pricing records, sync configuration, SMTP and advertising settings are unchanged. No additional database migration or production environment setting is needed.

## Verification before merge

The patch includes 22 unit/contract tests and eight new real HTTP/PostgreSQL subtests. Existing CI scripts and workflow gates are unchanged. Both GitHub runs must pass before deployment. Local validation is recorded separately; isolated scripts and a browser component harness are not the full Nuxt/Node 24/PostgreSQL suite.

After deployment, sync one Test product with monthly and yearly prices, open the administrator preview, check text/images/tax labels, and verify that a signed-out window still sees the normal public page. Do not activate Live billing merely to make the preview work.
