# CardShelf Postal validation

## 0.20.3 Postal web health probe

The previous loopback web probe omitted Postal's configured hostname. Postal
3.3.7 [adds `postal.web_hostname` to Rails' host allowlist](https://github.com/postalserver/postal/blob/3.3.7/config/application.rb),
so that request can receive HTTP 403 while the web server is running. The probe
now sends `Host: postal.cardshelf.cloud` directly to `127.0.0.1:5000`, accepts the
normal login redirect without following it, and retains failure detection for
HTTP errors. Curl errors are included in the Docker health log.

The focused deployment suite passed all seven tests. Its new regression reads
the generated Postal hostname and executes the configured curl command against
a local HTTP fixture: a matching-host 302 succeeds without following the
redirect, omission of the Host header fails with 403, and an application 500
fails with an error message. The Postal Compose overlay also parses as YAML.

This fixture is not a running Postal instance. GitHub CI validates CardShelf;
the server operator must recreate `postal-web` after updating and confirm its
health on the actual deployment. See the recovery steps in `POSTAL_EMAIL.md`.

## 0.20.2 native PostgreSQL follow-up

Applying 0.20.1 directly to the feature branch fixed the original administrator
email failure. Both native PostgreSQL 17 CI runs passed all 18 email subtests,
then failed the suite cleanup assertion: 342 of 343 integration tests passed.
The PostgreSQL driver inferred a timestamp parameter for schedule restoration
and serialized the captured string through JavaScript `Date`, truncating
microseconds. The earlier PGlite checks used millisecond-resolution `now()`
fixtures, so they did not expose this precision loss.

The restore query now binds the timestamp as text before PostgreSQL casts it to
`timestamptz`. The seeded backlog uses an explicit `.123456` fractional timestamp,
so the existing exact-restoration assertion detects truncation locally too. All
queue preservation assertions and CI gates remain enabled. Production email
behavior is unchanged; no migration or Postal configuration change is required.

The explicit-microsecond fixture reproduced the cleanup failure locally before
the cast change (18 passed, one parent failure); the corrected email suite passed
all 19 tests with exact schedule restoration.

This follow-up is committed directly to `feature/postal-email-system`. The
[existing pull request](https://github.com/frankymcgee/cardshelf/pull/21) reruns both
GitHub workflows on the updated branch; those results are the native PostgreSQL
integration gate.

## 0.20.1 CI correction

Both the [pull-request run](https://github.com/frankymcgee/cardshelf/actions/runs/35511505045)
and [push run](https://github.com/frankymcgee/cardshelf/actions/runs/35511497458)
passed unit tests, type checking, the production build and migrations, then failed
the same administrator delivery integration test. The earlier API suite changes a
password and leaves a pending security notification. The email suite incorrectly
assumed its own notification would be the next item in the global queue. The
original local email validation ran separately and missed this interaction.

The correction temporarily postpones pre-existing queued notifications during the
email suite, then restores their exact original schedules in `finally`. A seeded
older notification exercises this condition even when the suite runs alone;
assertions verify that existing notifications are neither sent nor otherwise
changed. Production queue logic and CI gates are unchanged.

Correction validation on 20 September 2026:

- All 1,677 unit tests, TypeScript/Vue type checking and the production build passed.
- Reproduced the original failure by running the API and email suites against one
  database, then verified all 19 Postal tests passed after the correction.
- The email suite also passed on a fresh database with its seeded queue backlog.
- The patch passed clean application, reversal and reapplication checks against
  0.20.0; the resulting 519 tracked files and their modes matched the candidate.
- Database checks used PGlite 0.5.8 / PostgreSQL 18.3 WASM. The combined API/email
  run still reported the existing ownership-concurrency mismatch (HTTP 500 versus
  409). A full integration attempt passed the Postal group but also encountered
  Free-registration errors and stalled in Stripe product tests; it was stopped.
  These tests passed on native PostgreSQL 17 in the original GitHub runs. This
  local full-suite attempt is not counted as a passing CI run.

Apply this incremental patch to the existing `feature/postal-email-system` branch
containing 0.20.0, using your usual patch workflow:

```sh
git apply --check /path/to/cardshelf-0.20.1-postal-ci-fix.patch
git apply /path/to/cardshelf-0.20.1-postal-ci-fix.patch
```

After committing and pushing the correction, both GitHub CI workflows must pass
before merging. No database migration or Postal configuration change is required.

## Original 0.20.0 validation

Validated on 20 September 2026 against the completed CardShelf **0.19.0 Arena
expansion**. Apply the 0.19.0 patch first if your checkout is still at 0.18.0.

### Executed checks

| Check | Result |
| --- | --- |
| Full `npm test` suite | 1,677 passed; no failures or skips |
| TypeScript / Vue type checking | Passed |
| Nuxt production build | Passed |
| New email HTTP/database suite | 18 passed |
| Existing recovery / AdSense HTTP/database regressions | 19 passed |
| Existing marketplace HTTP/database regressions | 18 passed |
| Database migrations | All 18 applied successfully |
| Browser acceptance | 15 checks passed; four desktop/mobile screenshots reviewed |
| Postal bootstrap, certificate, restore and existing deployment tests | 15 passed, included in the full unit suite |
| Shell parsing | Nine deployment scripts passed `sh -n` |
| Merged Compose configuration | Passed with Compose 2.39.3 |
| Patch application and reversal | Checked in an isolated clean 0.19.0 source tree |

The new tests exercise administrator permissions and password confirmation,
credential encryption/redaction, preference isolation, the delivery-disable switch,
legacy SMTP precedence, transactional notification hooks, fake delivery attempts,
retries, recipient suppression, signed Postal callback verification, exact message
correlation, replay handling and delivery/bounce ordering. The browser checks cover
More navigation, settings, password errors, credential retention/removal, test
queuing, delivery/TLS labels, suppressions and personal preferences. No JavaScript
runtime errors or page-wide horizontal overflow were observed.

Certificate tests use a generated test CA to verify selection of a trusted matching
certificate, rejection of an untrusted staging certificate, renewal reload, unchanged
certificate handling and failure without replacing working certificate files. They
do not contact a public certificate authority. Generated secrets are excluded from
Git and Docker build contexts.

### Validation boundaries

Database/API checks used **PGlite 0.5.8, PostgreSQL 18.3 WASM**, with the actual
migrations and production Node server. The native PostgreSQL 17 CI suite remains
the deployment gate; it was not executed in this environment. Integration tests use
a disposable database, synthetic credentials and recording mail senders. The
automatic mail dispatcher is paused in tests. No real email was sent.

The Postal API and webhook contracts were checked against the pinned Postal 3.3.7
source. Postal, MariaDB and Caddy containers were not started here; merged Compose
validation does not prove that a live container stack boots or delivers mail.
Browser DNS checks correctly displayed unavailable lookup results in this environment.
They did not verify the live `cardshelf.cloud` zone.

On the deployment host, complete the [Postal setup and acceptance procedure](POSTAL_EMAIL.md):
verify DNS, PTR, port 25, public certificate issuance/renewal, mail authentication
headers, delivery callbacks and actual inbox receipt. Application tests and those
email controls do not establish compliance with an unspecified security framework.

### Applying the original 0.20.0 patch

From a clean checkout containing the 0.19.0 Arena expansion:

```sh
git apply --check /path/to/cardshelf-0.20.0-postal-email.patch
git apply /path/to/cardshelf-0.20.0-postal-email.patch
```

Use your usual reviewed branch/patch workflow. Preserve `.env`, the integration
encryption key, databases and volumes. Follow `docs/POSTAL_EMAIL.md` for the one-time
Postal deployment and **More → Emails** for application settings. Saving a setting
does not install Postal, create a mailbox, or publish DNS records.

Reversing the source patch is not a database rollback. Migration 018 is additive;
restore and rollback operations must follow the documented backup procedure.
