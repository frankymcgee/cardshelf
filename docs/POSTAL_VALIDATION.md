# CardShelf 0.20.0 validation

Validated on 20 September 2026 against the completed CardShelf **0.19.0 Arena
expansion**. Apply the 0.19.0 patch first if your checkout is still at 0.18.0.

## Executed checks

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

## Validation boundaries

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

## Applying the patch

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
