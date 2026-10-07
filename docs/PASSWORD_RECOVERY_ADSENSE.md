# CardShelf 0.14.0 — Password recovery and Free-only Google AdSense

> Current email administration: v0.20 adds **More → Emails** and Postal. Follow
> [Postal email setup](POSTAL_EMAIL.md) for the current connection, delivery and
> DNS controls. The SMTP instructions below describe the retained legacy fallback,
> which is used only before Postal settings have been saved.

Target source base: `c6c758d09a82747905a7a7f2441091b8cc74b8ff` (v0.13.0).

This release adds migration `014_password_recovery_adsense.sql`, a server-side recovery mail queue and explicit Google AdSense configuration. It does not change any existing password, tier, grant, subscription, card or binder during migration. Recovery email, AdSense and AdSense site verification start disabled. First-party sponsorship remains a separate optional feature.

## Password recovery

### Account-holder workflow

Select **Forgot your password?** on the sign-in page, or open `/forgot-password`. Enter the account's registered email. The response is identical for registered and unregistered addresses and does not reveal whether an account exists. No account lookup or SMTP delivery occurs in this public request: bounded work is queued and handled separately.

When recovery email is configured and operational, the recipient receives a one-time link. It is valid for 30 minutes after generation. The `/reset-password` form asks for the new password twice, retaining the existing 12–128-character password rule. Leading and trailing password spaces are preserved.

Successful redemption changes the password, invalidates **all** existing sessions and reset links for that account, cancels outstanding recovery requests, and queues a password-change notification. The user must sign in normally afterward; there is no automatic login. Collection data, membership, Stripe subscriptions and protected tester/Complimentary access do not change.

Opening or previewing the link does not reset the password. Only a valid same-origin JSON POST containing the secret and matching new-password fields can redeem it. Link secrets are carried in the URL fragment, not the initial HTTP query string; the reset page removes the fragment from browser history and holds it in component memory only. Refreshing that page loses the in-memory token: reopen the original email link or request another one.

The existing signed-in **Account → change password** workflow remains available. Changing a password there now also invalidates older recovery links and outstanding recovery email jobs.

### Administrator workflow

Open **Password recovery** in the administrator navigation (`/admin/passwords`); there is also a link from **Free tier & ads**. Search at least two characters of a name or email, select the exact account, enter a reason and confirm your **current administrator password**.

Choose either:

- **Email**: queue a reset email to the account's existing registered address. No alternate recipient can be supplied in the request. Requires configured recovery email.
- **One-time link**: explicitly confirm the account holder's identity and secure delivery. The link is shown once and is not retrievable from the account list or audit log. This mode works even while email delivery is disabled. Give it only to the verified account holder through a secure channel; do not paste it in tickets, shared documents or public chat.

The administrator does not need the user's old password and does not assign or learn their new password. Generating a link does not immediately revoke current sessions; revocation happens when the account holder successfully chooses a new password. Existing administrators can assist another administrator, and an administrator account can use email recovery just like other accounts.

There is no unauthenticated administrator backdoor. A sole administrator who has lost their password, has no usable recovery email, and has no other administrator cannot use the protected manual-link screen. Configure and test email while administrator access is available, and maintain an appropriate server-owner recovery procedure.

### Configure recovery email on the server

Manage Postal in **More → Administration → Emails** (`/admin/emails`). Saving Postal settings selects Postal for recovery and account notifications. Disabling it, removing its API key, or an invalid configuration pauses delivery; the application does not fall back to SMTP after Postal settings have been saved. Signed Postal webhooks report subsequent delivery and bounce events.

Existing installations that have never saved Postal settings can continue using **Nodemailer 10.0.10**, pinned as a runtime dependency, with authenticated SMTP or a trusted TLS-protected relay. The following environment settings describe that legacy fallback. Microsoft Graph, OAuth mail-account onboarding and email verification are not included. Mail-service charges and limits remain separate.

Edit the existing server `.env`; do **not** replace it or regenerate its database, bootstrap or integration secrets. Add:

```dotenv
RECOVERY_EMAIL_ENABLED=true
SMTP_HOST=smtp.your-mail-provider.example
SMTP_PORT=587
SMTP_SECURITY=starttls
SMTP_FROM=cardshelf@your-verified-sending-domain.example
SMTP_USER=your-smtp-username
SMTP_PASSWORD='your-real-smtp-password'
```

Replace all example values. Single-quoted dotenv values help preserve literal password characters; follow Compose dotenv escaping rules for your actual password. Never commit the populated `.env` or send SMTP credentials to a code-review thread.

For implicit TLS, use your provider's documented port (commonly 465) with `SMTP_SECURITY=tls`. STARTTLS is **required**, never opportunistic. Certificate verification is enabled, with TLS 1.2 as the minimum. There is no plaintext or `rejectUnauthorized=false` option. For a trusted relay that authenticates by network policy, leave **both** `SMTP_USER` and `SMTP_PASSWORD` empty; TLS still remains required. A service requiring an OAuth-only flow is not supported by these username/password settings.

`SMTP_FROM` must be one email address, not a display-name/address list. Configure the sending-domain authorisation, SPF/DKIM and delivery arrangements with the mail service. `APP_ORIGIN` must be the correct HTTPS site origin; reset links never derive their origin from a request Host header. Plain HTTP is accepted only for localhost/loopback testing.

Compose explicitly passes these variables into the **app** service. The recovery queue is drained by the running web application every five seconds, separately from large card-catalogue imports. Set `EMAIL_WORKER_ENABLED=false` to pause both recovery and account-notification dispatch during maintenance; omission or `true` enables the workers. Restart/recreate the app to adopt changed environment variables. After the update is merged, the normal upgrade command recreates it; for a later SMTP-only configuration change, use the same Compose files/options used by your installation when recreating the app.

Open `/admin/passwords`. The mail status reports whether the selected transport is configured, **not whether delivery has succeeded**. Use **Send test email** with your administrator password; the recipient is your own registered admin address, not an arbitrary address. An `accepted` state means the provider accepted the message; historical `sent` records have the same limited meaning. `delivered` requires a verified Postal event and does not prove inbox placement or that the recipient read it. Check the real inbox/spam folder before relying on recovery.

While email is disabled or misconfigured, public requests still receive the generic response. They expire rather than silently granting access. Administrators can use manual secure links instead. The app performs at most three automatic mail attempts with delayed retries and records generic error codes, never credentials, provider responses or message bodies. Unsent recovery jobs expire after 30 minutes; completed and expired delivery history is retained for up to 30 days. Reset tokens are generated immediately before sending, remain valid for 30 minutes, are stored only as hashes and are bound to the account's current password snapshot. Suppressed recipients are blocked before a recovery token is issued.

Authenticated password changes also queue a mandatory security notice. Optional marketplace and membership messages default off and can be enabled at `/emails`; they contain an authenticated application link rather than private conversation text or administrator reasons. Optional preferences and recipient access are checked again before sending. Notification jobs expire after 24 hours.

## Google AdSense

### Scope and separation from sponsorship

Open **Advertising** in administrator navigation (`/admin/adsense`). This is the actual AdSense JavaScript/display-unit integration, not a sponsor banner or AdMob. First-party sponsor configuration stays under `/admin/free-platform` and is not automatically enabled, disabled or converted. Both can be enabled independently; review total ad density before doing so.

Manual catalogue ads are requested on public listing/detail pages under `/explore` after card content is available. From v0.50.0, signed-out visitors and authenticated accounts whose **effective** access is explicitly Free are eligible. The selected provider and enabled modes determine the payload; the server checks audience and route eligibility before returning it. Optional Auto ads also cover public marketing pages and approved signed-in Free content pages; see [Auto ads](ADSENSE_AUTO_MARKETPLACE.md).

Collector, Collector Pro (`plus` internally), Complimentary and protected testers receive no AdSense loader from this integration. Administrators default to Hidden and can select Live ads for their own browser. Pending or still-paid Stripe records also suppress eligibility. Disabling access enforcement does not turn testers into ad recipients.

Private binders, login/password forms, account settings, billing, administration, messages and print views stay ad-free. Signed-out visitors cannot receive ads on `/app`, `/cards` or the authenticated marketplace. The existing first-party sponsor placements on overview/catalogue screens are unchanged and do not load Google's scripts.

### AdSense setup

1. In your own Google AdSense account, add/verify the appropriate website and follow Google's site-review instructions. A publisher ID, a seller declaration or this code alone does not mean the site is approved or guarantee ad fill/revenue. Public card lookup remains accessible without login; Google decides whether the actual content and implementation meet its requirements.
2. Create a **responsive display ad unit** in **Ads → By ad unit → Display ads**. Copy `data-ad-client` (the `ca-pub-` publisher ID) and the numeric `data-ad-slot`. Paste only those IDs into CardShelf; arbitrary advertising scripts or HTML are not accepted.
3. For verification before ad activation, enable **Publish the inert verification meta tag and this hostname's ads.txt entry**. This publishes `google-adsense-account` metadata on the homepage/catalogue index and a seller line at `/ads.txt`. It does not load Google JavaScript or show ads to visitors or paid accounts.
4. In Google AdSense, disable **Auto ads**, anchors, vignettes and automatic ad experiments. Do not add another global AdSense/Tag Manager loader elsewhere. CardShelf can control only its own integration; an independently installed global tag would defeat account and private-page exclusions.
5. Configure and publish Google's required **Privacy & messaging** consent messages for your audiences, including required choices and a revocation/privacy-options entry point. Test that configuration before enabling CardShelf's ad switch. The operator must review applicable jurisdiction and audience requirements, including child-directed content where relevant.
6. Confirm approval, consent-message setup and Auto-ads-off in CardShelf, supply a reason and your current administrator password, then save with **Enable Google AdSense for public visitors and Free accounts** checked. These checkboxes are operator acknowledgements, not automated verification of your Google account or a legal-compliance certification.

The integration relies on Google's published consent-management configuration delivered through the AdSense tag. It does not generate fake consent strings, force personalised ads, or mistake a homemade checkbox for a Google-certified consent-management platform. Google's EU requirements cover relevant EEA, UK and Swiss users. Additional requirements can apply elsewhere. Third-party CMP code loaded globally is not configured by this package.

The privacy notice now explains that enabled AdSense can involve Google/advertising partners, IP/device/page information, cookies or local storage, subject to the configured consent flow. The old first-party-only statement has been removed. Review that text against your actual practices before enabling Google ads; it is not a substitute for operator-specific legal/privacy advice.

### Your hostname: tcg.webwire.cloud

CardShelf controls only `tcg.webwire.cloud`. Its seller declaration has this form:

```text
google.com, pub-YOUR_16_DIGIT_PUBLISHER_ID, DIRECT, f08c47fec0942fa0
```

Review AdSense's root-domain/subdomain instructions for **webwire.cloud** separately. Where required, the root domain's existing `ads.txt` can declare the subdomain using `subdomain=tcg.webwire.cloud`, with the appropriate seller declaration on the subdomain. Preserve existing root-domain sellers and any other applications' records. This patch does not edit the Webwire root website, DNS or another server. Google may take time to recrawl and approve the setup.

### Script isolation, consent and performance

AdSense supports a nonce-based strict Content Security Policy. Only eligible Free **public catalogue documents** get a per-response nonce and the compatible policy. All document script tags/module preloads are nonced in the server render. The browser reads a script element's nonce property; the nonce is not duplicated into CSS-readable meta content. Other pages retain CardShelf's existing restrictive policy. Audience-dependent documents are `private, no-store` and vary by cookie to avoid cross-user caching.

The AdSense-compatible policy is deliberately different from the private application policy: it permits the resources needed by Google's advertising code and does not globally extend a Google-domain allowlist. Do not apply this policy to private screens. This release does not replace a separate security review of third-party code running on your public catalogue.

Entering the catalogue from another application route uses a full document request so the server selects the correct audience and policy. Once a document has loaded Google code, subsequent route navigation uses a full page load to destroy that code before reaching protected screens. Removing a script element alone cannot undo executed JavaScript. This is a deliberate tradeoff against fully seamless SPA navigation.

At most one manually requested display unit is created per document, only after a connected unit has a positive width. An unavailable/blocked loader does not trigger repeated injection. There is no timed Google ad refresh. The one-minute timer only rechecks CardShelf eligibility; losing Free access, disabling/changing the configuration, or an eligibility error causes a fresh document without retaining the old unit. Focus/visibility and back-forward-cache restoration also trigger checks/reload. Changes made in another tab/device are therefore not guaranteed to disappear at the exact instant of the administrative change; foreground checks and the periodic check detect them.

Do not click your own ads, repeatedly refresh to manufacture impressions, or run automated tests against live ads. The included automated checks use synthetic IDs and do not contact Google. Real AdSense approval, consent refusal/acceptance/revocation, ad-blocking and fill still need controlled installation acceptance testing.

## Upgrade and rollback boundary

After this feature branch has passed both GitHub checks and is merged, run from the existing Ubuntu checkout on `main`:

```sh
git pull --ff-only origin main && sudo sh scripts/upgrade.sh
```

Keep `.env`, the integration encryption key and the database volume. Migration 014 is additive. Old application code can ignore the new tables, but do not downgrade while there are ongoing password-recovery operations without planning the rollback. Do not manually drop populated recovery tables or reset account data to troubleshoot email/ads.

Email settings and Google settings are independent. Configuring either does not enable subscriptions or registration and does not change anyone's tier. Existing passwords are untouched until an account holder redeems a valid recovery link or uses the existing password-change form.

## Installation acceptance

Before relying on recovery, send an admin delivery test, then recover a test account through email and confirm old sessions/passwords no longer work. Check expired/reused links and an administrator-issued manual link. Confirm its cards, binder marks, tier, grants and billing history remain unchanged. Verify refusal/retry handling with an unavailable mail server without logging credentials.

Before serving Google ads, complete Google approval/consent setup and check a Free account against Collector, Pro, tester and Complimentary accounts. Inspect browser network traffic on catalogue versus account/reset/billing routes. Verify signed-out documents do not load AdSense, verification-only mode does not serve ads, and revoking consent/upgrading/navigating away is handled correctly. Test mobile widths, blockers and an empty/failed catalogue.

## Validation boundary

Local pure-logic, DOM-controller, source-contract and configuration tests are provided, together with database/API integration cases. Local script-level TypeScript checking uses explicit ambient framework declarations; it is **not** the Nuxt build or Vue template typecheck. A local browser attempt was blocked by the execution environment's browser policy. Full Node 24/Nuxt/PostgreSQL validation remains a GitHub Actions gate for the feature branch. SMTP delivery and Google's real scripts/consent service were not contacted during development checks.

## Primary implementation references

- OWASP Forgot Password Cheat Sheet: `https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html`
- Nodemailer SMTP transport: `https://nodemailer.com/smtp`
- Nodemailer v10.0.10 release: `https://github.com/nodemailer/nodemailer/releases/tag/v10.0.10`
- Google display ad units: `https://support.google.com/adsense/answer/9274025`
- Google CSP integration: `https://support.google.com/adsense/answer/16283098`
- Google consent-policy help: `https://www.google.com/about/company/user-consent-policy-help/`
- AdSense Privacy & messaging: `https://support.google.com/adsense/answer/17341119`
- Google ads.txt guide: `https://support.google.com/adsense/answer/12171612`
- Google ads.txt FAQs/subdomains: `https://support.google.com/adsense/answer/9785052`
