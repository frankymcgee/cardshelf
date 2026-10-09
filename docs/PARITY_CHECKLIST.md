# Functional scope and parity — 0.53.0

Backend launch gates are tracked in [V1_RELEASE_CHECKLIST.md](V1_RELEASE_CHECKLIST.md);
current Arena corrections and limits are in [ARENA_RULES.md](ARENA_RULES.md).

Updated 9 October 2026 (Australia/Perth). This matrix describes shipped CardShelf capabilities,
not a certificate of complete BinderBuilder or official Pokémon game parity.
No authenticated competitor workflow or representative competitor export has
been available for this inspection. Existing data, grants and billing records
must survive any later work on the remaining features.

| Area | Implemented capability | Remaining parity or acceptance work |
|---|---|---|
| Catalogue | English/Japanese Pokémon imports; English Yu-Gi-Oh! and paper Magic; local search, public detail, set and game filters | Entire provider catalogue is not imported automatically; species/artist landing pages, exhaustive language/printing audit |
| Printings | Provider variants, manually added printings, explicit uncertain mappings, foil effects | Verified master checklist, exact edition/stamp/artwork combinations for every card |
| Ownership | Quantity by printing and condition, wishlist, notes, revision checks | Individually identified physical copies, grades, acquisition/cost history |
| Progress | Collection and independent Tracking binders, set/series generation, missing-printing completion and bulk wishlist | Verified exhaustive master-set progression and additional custom targets |
| Binders | Grid/pages, planned vs owned states, move/swap, generated sets/series, inside/outside appearance, wallpapers/covers | Arbitrary mixed pocket sizes, insertion/reordering of whole pages, richer auto-sort; physical-copy allocation |
| Sharing/print | Revocable read-only bearer links, printable checklist/placeholder layouts | Additional sharing policies, printer measurements and richer print templates |
| Portability | CardShelf JSON/CSV ownership export, previewed safe import, complete server backup/restore tools | Actual BinderBuilder export adapter and portable binder-layout JSON round trip |
| Market values | Printing/source coverage, AUD conversion, planned/owned values, daily history and attribution | No guaranteed local sale prices or condition/grade valuation; coverage and approximation remain explicit; automatic price-target alerts absent |
| Membership | Free, Collector, Collector Plus, explicit Complimentary assignments; protected tester grants; Stripe offers/checkout/portal/verified periods; approved referrals | Fresh Live purchase/renewal/cancel acceptance on deployed version; account email verification and MFA absent |
| Marketplace | Member listings/photos, exact printing selection, private enquiries/replies, seller tools, moderation, affiliate links | No integrated card-sale checkout, settlement, shipping or escrow; these are external workflows |
| Recognition | Single and sequential batch photo scan, English/Japanese imported Pokémon matches, manual confirmation, binder destination and guarded undo; usage/budget limits | Other-game recognition, graded-card recognition, offline/local-model inference; physical camera acceptance |
| Emails/push | Postal or encrypted authenticated SMTP (separate WPMU DEV Basic/Pro presets), verified TLS/login checks, shared pacing, uncertain-delivery holds, recovery, optional email preferences; session-bound encrypted Web Push and per-device preferences | WPMU Pro TLS/login and test acceptance observed; complete sender-signing and receiving-inbox recovery acceptance, plus physical iPhone/Android push and install tests |
| Arena | Versioned server engine, hidden hands, supported Casual Expanded cards, original tutorials, CPU/saved opponents, private matches, deck import/export/workshop, tournaments and commentary, accessible motion/audio controls | **Full official card/rules parity is absent.** Special Energy and unsupported effects remain rejected; current two-account/tournament/reconnect acceptance needed |
| PWA/offline | Installable manifest, service worker and offline information page; private APIs are not cached | Offline collection reads/writes and conflict reconciliation; native App Store/Play Store apps |
| Advertising | First-party Free sponsor; Google Auto ads and isolated Adsterra banners/native; eligibility and private-page exclusions | Real provider fill and applicable consent acceptance; provider availability is not a code-only guarantee |
| Operations | Migrations, worker heartbeats, health endpoint, pinned builds, AMD64/ARM64 CI image/upgrade rehearsals, backup scripts, new read-only readiness report | Production-data restore, external DNS/TLS/monitoring, operator scheduling/retention, capacity and independent security audit |

Source and automated tests establish implemented behavior only within the tested
boundaries. See [VERIFICATION.md](VERIFICATION.md) for executed checks and live
findings. Legacy assisted `/battle` URLs redirect to Arena. Old records are retained and
their APIs are retired; they do not bypass current Arena entitlements.
