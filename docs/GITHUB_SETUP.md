# GitHub builds and container releases

CardShelf's private source repository is `frankymcgee/cardshelf`. GitHub Actions
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
