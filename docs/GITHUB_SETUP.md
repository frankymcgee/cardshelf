# GitHub builds and container releases

CardShelf's source repository is `frankymcgee/cardshelf`. GitHub Actions
builds releases and publishes them to `ghcr.io/frankymcgee/cardshelf`. The server
downloads a finished image; it does not install npm packages or compile Nuxt.

## Release process

1. Open a pull request. The existing unit, integration, browser and Arena checks
   run. Both native Linux AMD64 and ARM64 images are built and tested on GitHub.
2. Merge the reviewed change into `main`. **Validate CardShelf** runs all application
   and Arena gates again, then tests both actual container images against disposable
   PostgreSQL databases, including migrations, a backup and a pull-based upgrade.
3. **Publish release images** publishes those exact tested images, then promotes a
   multi-platform image with `:stable`, `:<package version>` and `:sha-<commit>` tags.
   Wait for this job to succeed before updating the server. Pull requests never publish.
4. Run `sudo sh scripts/upgrade.sh` on the server. The installed release is recorded
   as an immutable registry digest in `.env`, along with its application version.

Increment `package.json`, `package-lock.json` and the release stamps for each
release. Commit lockfile changes with dependency changes. Builds use `npm ci`;
there is no dependency resolution or lockfile rewriting on the production server.
Docker layer caches are separate for the two architectures. Main release runs are
serialized to prevent overlapping promotions. The publishing job alone receives
`packages: write`; it uses GitHub's automatic `GITHUB_TOKEN`, with no added PAT secret.

## Validation triggers

| Event | Automatic validation |
| --- | --- |
| Push a feature branch | Open or update a pull request to validate it. There is no separate branch-push run. |
| Open, reopen or update a pull request | One application workflow and the applicable Arena workflows. Existing browser suites and both native image checks remain enabled. |
| Push or merge into `main` | The full release workflow, including both Arena suites, native image checks and publication. |
| Run a workflow manually | The selected workflow runs on the selected branch. Only the main-branch release workflow can publish images. |

A new PR revision cancels older validation for the same PR and workflow, including
both Arena suites. Other PRs are independent. Main-branch releases retain their
existing serialization and are not interrupted by PR updates. Reusable Arena
workflows use separate concurrency groups, so they cannot cancel their caller or
each other; release calls and manual runs are isolated by run ID.

Each workflow still has a different purpose: seeing application, Arena table and
Arena match checks on one PR is expected. The removed duplication was running the
same checks for both the feature-branch push and its pull-request update.

## Action runtimes and runner images

All external actions are pinned to reviewed commit SHAs with release comments.
Checkout v7.0.1, setup-node v7.0.0, upload-artifact v7.0.1,
download-artifact v8.0.1, Buildx setup v4.4.1, build-push v7.4.0 and
Docker login v4.6.0 declare the Node 24 action runtime. Application jobs also use
Node 24. Hosted jobs use `ubuntu-24.04`; the native image matrix retains
`ubuntu-24.04` and `ubuntu-24.04-arm`, independently of the `ubuntu-latest` rollout.

Artifact uploads retain ZIP archiving (`archive: true` for release image archives),
so the release-image artifact names and extracted tarball paths stay unchanged.
The application job checks two tiny compressed fixtures through upload/download,
pattern selection and `merge-multiple`, comparing archive and extracted bytes.
Main-branch publishing still downloads and loads the actual tested native images.
The new downloader's default digest mismatch failure remains enabled.

When updating pins, review each major version's inputs and runtime requirements;
do not assume upgrading the application's Node version upgrades action runtimes.
See [Node 20 action deprecation](https://github.blog/changelog/2025-09-19-deprecation-of-node-20-on-github-actions-runners/)
and [the Ubuntu 26.04 rollout](https://github.com/actions/runner-images/issues/14748).

## One-time switch for the existing server

After this PR is merged and **Publish release images** succeeds, run from the
existing CardShelf directory:

```sh
git pull --ff-only origin main
sudo docker login ghcr.io -u frankymcgee
sudo sh scripts/configure-integrations.sh
sudo sh scripts/upgrade.sh
```

Use a GitHub **personal access token (classic)** with **`read:packages`** at the
password prompt, from an account allowed to read this private package. Authorize
SSO if your GitHub organisation requires it. A repository deploy key used for
`git pull` does not authenticate Docker. Use `sudo docker login` if upgrades run
with `sudo`, so the same Docker client account has the saved credential. Never put
the token in `.env`, GitHub source, shell arguments or chat.

The workflow does not change package visibility. Keep the package private. If a
pre-existing GHCR package blocks publishing, connect it to this repository and
allow this repository's Actions to write it in the package settings. For a new
package, the built-in token and source label establish the repository association.

Do not regenerate the existing `.env` or integration encryption key. The integration
helper is idempotent. If `git pull` reports an existing untracked `package-lock.json`,
move that local file aside before retrying; the release now includes its validated lockfile.

## Routine server update

```sh
sudo sh scripts/upgrade.sh
```

The helper pulls while the site is online, validates image metadata and server
configuration, makes a database backup, stops only app/worker, migrates, and waits
for their replacement containers to become healthy. PostgreSQL, Caddy and Postal
stay running. No `docker compose down`, build or routine `git pull` is needed.
The download and backup still take time; downtime covers migration and restart.

A release that changes host-side Compose/proxy/upgrade files fails its compatibility
check **before stopping anything**. Update to the reviewed source for that release,
then rerun the helper. Local edits to those deployment files also trigger the check;
review and reconcile them rather than bypassing it. Ordinary application-only releases
can be pulled without refreshing the server checkout.

To select a published version explicitly:

```sh
sudo sh scripts/upgrade.sh 0.40.0
```

This is not an automatic downgrade or schema rollback mechanism. After migrations,
an older image may be incompatible with the database; use the recovery procedure in
[Deployment](DEPLOYMENT.md). Keep off-server backups and the matching `.env`.

## Source-build fallback

If the registry is unavailable and you have a reviewed complete source checkout:

```sh
sudo sh scripts/upgrade.sh --build
```

This builds locally with the same Dockerfile and locked dependencies, then follows
the same backup/migration/health sequence. It takes longer and is an explicit fallback.
No production Compose build block is needed. Advanced deployments can select another
registry repository through `CARDSHELF_IMAGE_REPOSITORY` when invoking the helper.

## References

- [GitHub Container Registry and authentication](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)
- [GitHub reusable workflows](https://docs.github.com/en/actions/how-tos/sharing-automations/reuse-workflows)
- [Docker GitHub Actions cache](https://docs.docker.com/build/ci/github-actions/cache/)
