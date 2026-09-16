# CardShelf 0.4.0 — public website and protected testing access

## Release scope

Public marketing homepage, features, plans/access, request and privacy/data pages.
The collector workspace remains behind the existing session authentication.
Subscriptions are infrastructure only: no payment integration, checkout, invoices,
trial countdown, live plan sales, quotas or access restrictions are enabled.

## Routes and compatibility

- `/`: public marketing website with an interactive, original demo illustration.
- `/features`, `/pricing`, `/early-access`, `/privacy`: public server-rendered pages.
- `/app`: the complete former collection overview; login now returns here by default.
- `/cards`, `/binders`, `/settings`, `/print/:id`: existing authenticated URLs are unchanged.
- `/account`: the signed-in user's access summary.
- `/admin/platform`: administrators only; contact requests, tester roster and plan drafts.
- `/shared/:token`: existing intentionally public read-only links continue to work.

Login cookies, password hashes, roles, user IDs and server-side sessions are unchanged.
Deep-link sign-ins preserve safe internal destinations; external redirect values are
rejected. Sign-out returns to the public website. The PWA keeps its existing manifest
ID and uses `/app` as its new start URL. Old root bookmarks now open the website.

The marketing pages are server-rendered and contain no private collection/demo-user
records or fabricated testimonials. Demo cards are original illustrations, not real
catalogue artwork or live price data. Pages include canonical/social metadata, a
public-only sitemap and robots directives. Private pages and APIs remain noindex.
`NUXT_PUBLIC_SITE_URL` is supplied by Compose from the existing `APP_ORIGIN`.

## Tester protection

Migration `004_public_platform.sql` is additive and transactional. It creates:

- `membership_plans`: a testing plan and two unpublished, unpriced planning drafts.
- `account_memberships`: one account-linked subscription metadata record, prepared
  for provider identifiers/status without creating external customers.
- `account_access_grants`: separate non-expiring testing access records.
- `platform_requests`: access/support/privacy requests for administrator review.

All accounts that exist at migration time receive `legacy_tester` grants. An insert
trigger gives every new account created by the existing administrator/setup flow a
`beta_tester` grant. Neither type expires. Their grant table rejects non-null expiry.

`BILLING_ENABLED` and `ACCESS_ENFORCED` are deliberately false constants in this
release, not configurable environment switches. Existing API authentication and user
ownership checks are untouched. Subscription statuses are informational and cannot
lock an account. Editing draft prices does not assign a plan, restrict a feature,
charge a card, or modify an access grant. There is no revoke-grant control.

This protects current testing; it is not a promise about hypothetical future paid
contracts. Turning on a paid offering requires a separate reviewed release and must
explicitly preserve the non-expiring tester grants rather than silently converting
them to trials.

## Request workflow

Visitors can submit name, email, purpose, an optional message and affirmative contact
consent. The form is not public self-registration and does not create an account,
send email, approve membership or start a subscription. Rate limits, a honeypot,
strict purpose/length validation, a 16 KB body limit and same-origin checks apply.
Duplicates return the same acknowledgement without revealing whether an account or
request exists. Messages render as plain text; no HTML is executed.

Administrators review requests at `/admin/platform`, then use the existing Add a
collector form at `/settings` to invite someone. Share the initial password securely
through your existing channel. Contacted/archived statuses are administrative labels,
not account-creation actions. Deleting a request removes that contact record, not any
user or collection. Requests have no automatic retention schedule in this release;
the administrator should delete them when no longer needed.

## Plan preparation

The admin page accepts optional monthly/annual draft amounts in integer AUD cents,
with optimistic revision checking. The testing plan cannot be edited through that
endpoint. Public pages do not disclose drafts or display checkout buttons. New APIs
require the same existing session cookie; plan/request administration requires admin.
An ordinary collector can read only their own account summary.

A future billing release still needs provider onboarding, actual products/prices,
explicit purchase consent, signed/idempotent webhook handling, reconciliation,
invoices/tax decisions, cancellation/renewal policy, service terms and appropriate
operator privacy/contact/retention review. No payment keys are needed for this update.

## Upgrade

Run only after this release's full CI passes. From the existing server checkout:

```sh
git pull --ff-only origin main && sudo sh scripts/upgrade.sh
```

The existing helper builds first, takes its local safety backup, then migrates and
restarts the app/worker. Do not regenerate `.env`, reset the database, rerun initial
setup or remove Docker volumes. Existing testers use the same credentials; no
account migration action is required from them. No new dependencies or containers.

Verify signed-out root/features/pricing, a current tester's login and old binder URL,
the Account access badge, admin request handling, and a generated binder after upgrade.
A signed-out public page must not disclose account names or private collection data.

## Validation

New pure tests cover route classification, redirect safety, fixed disabled billing,
access defaults, request validation and plan revisions/amounts. The new PostgreSQL/API
integration suite checks legacy backfill in an isolated schema, retained hashes and
sessions, new-account grants, SSR public pages/SEO, protected APIs, request deduplication,
admin-only drafts and continued access even when subscription metadata is past due.

Local validation is not the full application build. The authoring environment cannot
resolve npm packages and has no Docker/PostgreSQL server. Use this release's GitHub
Actions run for the full Nuxt typecheck/build and all existing/new API tests. Browser
fixtures inspect the actual marketing CSS/template structure, not a deployed Nuxt app.

Primary implementation references:
- https://nuxt.com/docs/4.x/guide/concepts/rendering
- https://nuxt.com/docs/4.x/directory-structure/app/middleware
- https://nuxt.com/docs/4.x/getting-started/seo-meta
- https://nuxt.com/docs/4.x/api/composables/use-runtime-config
