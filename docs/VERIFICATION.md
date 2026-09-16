# CardShelf 0.1.0 — verification report

Date: 16 September 2026

## Release status

**Initial source implementation / deployment candidate, not a validated production
release and not full BinderBuilder feature parity.** The package has not been
installed on the user's server, published to a registry, or pushed to a repository.

This report distinguishes executed checks from checks that are only supplied as
code or instructions. A passing pure-function test is not evidence that the Nuxt
application, database queries, browser interface, HTTPS proxy or Docker services
work together.

## Checks actually executed

| Check | Result | Scope and limitations |
|---|---|---|
| Dependency-free Node test suite | **55 passed, 0 failed, 0 skipped** | Validation, binder slot/resize logic, printing normalization, password hashing and verification, token handling, request-origin validation, JSON/CSV parsing and merge rules, configuration parsing. No running database or application server. |
| JavaScript syntax | **26 files passed** | `node --check` on service modules, worker, utility scripts, service worker and test sources. |
| TypeScript/script transpilation syntax | **24 source blocks passed** | TypeScript 5.8.3 `transpileModule` on `.ts` files and extracted Vue script blocks. **Not** Vue/Nuxt typechecking or module-resolution validation. |
| Vue template tag balance | **18 templates passed** | Structural tag-balance check, not Vue compilation, accessibility testing or browser rendering. |
| JSON/manifest parsing | **3 files passed** | Package metadata, TypeScript configuration and PWA manifest. |
| YAML parsing | **3 files passed** | Both Compose files and CI workflow parse. Docker Compose itself was unavailable. |
| Compose source assertions | **Passed** | Database has no host-published port; application defaults to host loopback; app and worker require successful schema migration. This is source inspection, not firewall/network testing. |
| CSS parsing | **Passed** | Top-level stylesheet rules parse. No responsive rendering claim is made. |
| POSIX shell syntax | **Passed** | Configuration, backup and restore scripts pass `sh -n`. Backup/restore were not executed. |
| Configuration helper smoke tests | **8 cases passed** | HTTP with explicit port, standard HTTPS and HTTPS `:443` accepted; out-of-range port, nonstandard HTTPS port, missing HTTP port, path and injection-like URL rejected. |
| Configuration file handling | **Passed** | Accepted cases produced `.env` mode 0600, correctly formatted random secrets and a valid format check; repeated setup refused to overwrite the file. Tests used temporary directories, which were discarded. |

The core tests ran with **Node.js 22.16.0** in the authoring environment. The
application's declared and containerized runtime is **Node.js 24**; running the
suite against that target runtime remains part of the connected build/CI checks.
The exact TAP output is included at [test-results/unit-tests.tap](test-results/unit-tests.tap).

## Checks not executed

The environment had no Docker daemon/CLI or PostgreSQL server, and could not
resolve npm/API hosts from the build container. Therefore the following are
**unverified**, not implicitly passing:

- Installing the pinned npm dependencies or resolving their transitive graph.
- Generating/retaining a real npm lockfile; Nuxt preparation, full typechecking
  and production build; startup of the generated server bundle.
- PostgreSQL migrations and all SQL-backed operations, including concurrency,
  transaction isolation, permissions, session invalidation and import matching.
- The supplied HTTP/database integration suite and GitHub Actions workflow.
- Building and starting Docker Compose services; health checks, Caddy HTTPS,
  reverse-proxy headers, worker leases and provider retry behavior in operation.
- Live TCGdex catalogue imports and live image display against representative sets.
- Browser behavior, drag/drop, touch movement, scrolling, printing, PWA installation,
  screen reader behavior and iOS/Android compatibility.
- A backup/restore round trip, disaster recovery, load testing, or security audit.

## Gates supplied for a connected environment

The Dockerfile runs unit tests, full Nuxt/Vue typechecking and a production build
before producing the application image. A failure must be investigated rather
than bypassed. No prebuilt image is included.

`.github/workflows/ci.yml` defines a Node 24/PostgreSQL 17 job that also migrates an
empty test database, starts the production server and runs
`tests/integration/api.test.mjs`. That suite defines 16 API/database scenarios
covering protected setup, authentication, user separation, mutation protections,
collection revisions, binder behavior, sharing revocation, import replay,
manual-printing permissions and session changes. It requires an explicitly
permitted, disposable database ending in `_test`; never point it at real data.
This workflow was **not executed** in this session.

Follow the acceptance checklist in [DEPLOYMENT.md](DEPLOYMENT.md). Before entering
valuable collection data, verify a real set import, two-user isolation, collection
edits, binder moves, public-link revocation, export/import and a complete backup
restoration on the intended server.

## Known scope gaps

See [PARITY_CHECKLIST.md](PARITY_CHECKLIST.md). In particular, pricing and alerts,
full offline browsing/editing/synchronization, actual BinderBuilder-export
compatibility, comprehensive verified printing coverage, local artwork storage,
individual-copy records and account recovery/MFA are not implemented. Card images
still load from the external provider; a locally stored catalogue is not the same
as fully independent image hosting.
