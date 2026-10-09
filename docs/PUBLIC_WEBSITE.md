# Public website and account access — 0.52.1

Public routes are `/`, `/features`, `/pokemon-arena`, `/pricing`, `/contact`,
`/privacy`, `/explore`, card detail and `/register`. Sign-in/recovery pages remain
public; collection and administration require the existing session and server
permissions. Read-only shared binder links keep their existing revocation rules.

`/early-access` permanently redirects to `/contact`, preserving only one of the
known account-help, support or privacy purposes. Arbitrary query parameters are
not forwarded. The public sitemap lists the canonical contact route.

New Free accounts use `/register` when the administrator enables registration.
They do not receive protected tester grants. When registration is paused, the
page says so and links to account help. Submitting a contact request saves it for
administrator review; it does not create an account or send a confirmation email.
The existing consent, honeypot, same-origin, length and rate-limit checks remain.

Collector/Collector Plus products and recurring prices come from configured
Stripe offers. Live/Test environments, checkout availability and feature
enforcement remain separately controlled. Existing non-expiring tester grants
and explicit Complimentary access are preserved. The original beta-era document
is superseded; payment infrastructure and public Free registration now exist.

Privacy covers account/collection data, Stripe, referrals, marketplace,
Postal/recovery, card photo recognition, Web Push, sharing and reference/artwork
providers. Advertising notices distinguish first-party sponsorship from Google
and isolated Adsterra placements and their consent controls.

Production acceptance is documented in [VERIFICATION.md](VERIFICATION.md), with
remaining scope in [PARITY_CHECKLIST.md](PARITY_CHECKLIST.md). Removing beta copy
does not enable registration, change memberships or certify provider delivery.
