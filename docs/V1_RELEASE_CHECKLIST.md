# Backend 1.0 release gates

Reviewed 9 October 2026 against the repository and previous deployed acceptance
record. Version 1.0 is a product contract, not a replacement for unfinished
acceptance. Preserve existing users, tester grants, subscriptions and saved games.
See [scope/parity](PARITY_CHECKLIST.md), [verification](VERIFICATION.md) and
[Arena rules](ARENA_RULES.md). Do not label the current release 1.0 yet.

| Priority | Remaining work | Acceptance evidence |
|---|---|---|
| P0: Account trust | Implement email verification (expiring hashed tokens, resend pacing, safe email changes and existing-account migration); administrator MFA and recovery; review session revocation and sensitive-action reauthentication | Expiry/replay/rate-limit tests, legacy-account migration, administrator recovery and tenant-boundary review |
| P0: Recovery/operations | Exercise existing backup/restore tools with an isolated production-shaped restore; configure encrypted off-server retention and actionable worker/queue/database/disk alerts | Recorded restore time, successful login/data reconciliation, failed-job recovery, alert delivery and rollback rehearsal |
| P0: Paid lifecycle | Accept existing Stripe checkout/webhook/reconciliation paths on the deployed release: purchase, renewal, tier change, payment failure, cancellation and entitlement expiry; preserve grants | Received live webhook/payment evidence matched to periods, quotas and Arena access; no duplicate processing |
| P0: Communications | Finish receiving-inbox password-recovery/link redemption and sender-signing acceptance for WPMU Pro; test physical iPhone/Android install and push | Delivered messages and redeemed links, actual device delivery/preferences; uncertain SMTP delivery remains held |
| P0: Arena release scope | Ship current supported-pool corrections, accept two-member games/tournaments/reconnect, and publish precise unsupported behavior | Exact-head CI, deployed member acceptance, saved-engine compatibility; no claim of complete official parity |
| P1: Promised portability/parity | Add portable binder-layout JSON export and previewed transactional import; validate a real competitor export before promising an adapter; decide physical-copy allocation scope | Lossless round trip of pages/slots/settings; rollback and stale-revision tests; source-backed adapter fixtures |
| P0: Release contract | Freeze promised features, load-test representative 4 GB deployment, audit security/dependencies, document support/rollback, pass all required release checks | Dated acceptance record with owner/evidence for each gate; no unresolved release-blocking defect |

Existing functionality includes collection JSON/CSV import/export, hashed
passwords/sessions, request protections, quotas, billing reconciliation, job
queues, audit trails and backup tooling. These gates do not mean those systems
need rebuilding; several require configuration and end-to-end proof.

Complete official Pokémon card/rules parity requires a separate substantial
engine and legality programme, described in ARENA_RULES.md. A bounded Casual
Arena can ship in 1.0 if the product clearly promises that supported scope.
Native mobile apps, offline writes, marketplace settlement/escrow, automatic
price alerts and exhaustive card-printing coverage are additional product
scope, not automatically prerequisites for a stable core 1.0. They must remain
explicitly absent until implemented and accepted.

Recommended implementation order: account verification and administrator MFA;
restore/alerting acceptance; paid lifecycle and receiving-inbox/device acceptance;
binder portability if included in the launch promise; final load/security review
and release sign-off. Keep beta status until all chosen launch gates have evidence.
