# Functional scope / parity checklist

This is a clean-room functional target based on public descriptions, not a claim
of access to or testing of every authenticated BinderBuilder workflow.

| Area | v0.1.1 implementation | Remaining parity / verification work |
|---|---|---|
| Catalogue | English/Japanese per-set imports, local search, illustrator and Pokédex filters | Full catalogue coverage audit; species/artist landing pages; scheduling |
| Printings | Provider flag records and manual additions; explicit unverified labels | Verified edition/finish combinations, stamps, provider corrections |
| Ownership | Quantities, condition, wishlist, notes, revision checks | Individual physical copies, grading, acquisition history |
| Progress | Unique imported-design counts by set | Complete master-variant progression and custom targets |
| Views | Card grid/list and custom binder pages | Arbitrary mixed-size pockets and additional browsing views |
| Binders | Configurable grid/page count; place, clear, move/swap; desktop spread/touch controls | Bulk set filling, insert/reorder whole pages, auto-sort |
| Sharing | Revocable read-only bearer link, private holdings excluded | Further sharing policies and trade/sale workflows |
| Portability | Documented collection JSON/CSV; preview/match/error report; full database backup | Actual BinderBuilder export adapter; portable binder JSON round-trip |
| Printing | Browser-print card-sized placeholders and checklist | Printer/device measurements and richer template options |
| Pricing | Not implemented | Provider selection, variant/condition mapping, AUD conversion, coverage reporting |
| Alerts | Not implemented | Price targets, email delivery, schedules, unsubscribe controls |
| Offline/PWA | Manifest and offline information page; no private API caching | Offline reads/writes, reconciliation, install/device acceptance tests |
| Hosting | Docker/Compose, optional HTTPS, migration/health/backup scripts | Actual build/start/restore verification, reproducible locked release |
| Security | Private accounts and core server-side safeguards in source | Full integration execution, account recovery/admin hardening, MFA/security review |

“Implemented” means source is present, not that all browser and database workflows
have been exercised. See VERIFICATION.md for the exact executed-test boundary.
