# CardShelf 0.1.1 — GitHub preparation report

Date: 16 September 2026

## Publication status

**Prepared locally only. No GitHub repository has been created and no remote
commit has been pushed.** The connected account was confirmed as `frankymcgee`.
The available integration supports reading repositories and publishing
files/commits, but does not expose creation of a new repository. The requested
remote `frankymcgee/cardshelf` could not be resolved by that connection during
preparation. The source has not been deployed to a server, and no DNS settings
have been changed.

Intended private repository: `frankymcgee/cardshelf`, branch `main`.
Intended deployment origin: `https://tcg.webwire.cloud`.

## Changes in this preparation

- Incremented the application version to **0.1.1**, including package metadata,
  local image default, configuration helper, status response, provider user agent,
  settings-page version and service-worker cache stamp.
- Set configuration-script defaults and the example environment for
  `https://tcg.webwire.cloud`, with `APP_DOMAIN=tcg.webwire.cloud` and proxy trust
  for the supplied HTTPS deployment. Explicit localhost evaluation still works.
- Added Git text/binary attributes, publication instructions and five regression
  tests for deployment configuration.
- Preserved the original feature scope, Docker definitions, migrations, UI,
  worker, tests, documentation and original test evidence.

No production passwords, setup tokens, private keys or database contents were
added. The example environment has placeholders only. Real `.env` files must be
generated on the deployment server and remain outside version control.

## Checks executed for 0.1.1

| Check | Result | Scope |
|---|---|---|
| Core/configuration unit tests | **60 passed, 0 failed, 0 skipped** | The original 55 tests plus five deployment-script tests |
| JavaScript syntax | **27 files passed** | `node --check`; not TypeScript typechecking or module resolution |
| POSIX shell syntax | **3 scripts passed** | `sh -n`; backup/restore scripts were not executed |
| JSON/manifest parse | **3 files passed** | Metadata, TypeScript configuration and manifest |
| YAML parse | **3 files passed** | Compose files and CI workflow; not Docker validation |

The five new tests check the exact default domain/release, randomly generated
credentials and restrictive file permissions, refusal to overwrite an existing
`.env`, localhost evaluation and canonicalization of explicit HTTPS port 443.
They ran in temporary directories, and generated secrets were removed afterward.
Test output: [unit-tests-0.1.1.tap](test-results/unit-tests-0.1.1.tap).

These local checks ran on **Node.js v22.16.0**. The deployment target remains
Node.js 24, as defined in the Dockerfile and CI workflow. Passing the dependency-
free suite on this runtime does not establish the full Node.js 24 build result.

## Not executed

Dependency installation, dependency audit, full Nuxt typecheck/build, PostgreSQL
integration tests, Docker image build/startup, GitHub Actions, browser/mobile
acceptance, domain/HTTPS reachability and backup restoration were **not executed**
for this preparation. Docker and PostgreSQL executables were not available here.

The application remains a deployment candidate rather than a verified
production release. See [the original 0.1.0 report](VERIFICATION.md) for the
original checks and [deployment instructions](DEPLOYMENT.md) for acceptance work.
