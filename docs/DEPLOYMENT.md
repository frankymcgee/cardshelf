# Deployment, updates and recovery

## Status and prerequisites

Releases are built and tested in GitHub Actions, then published to the private
GitHub Container Registry. See [GitHub setup](GITHUB_SETUP.md) for the release gates
and one-time registry login. Use Linux AMD64 or ARM64, Docker Engine, the Compose v2
plugin with `up --wait` and `run --pull`, and `flock` (standard on Ubuntu/Debian).
The production server needs no Node/npm toolchain.

A practical starting point to evaluate is 2 vCPU / 4 GB RAM plus SSD space; this is
not a measured capacity guarantee. Database/catalogue size and backup retention
will determine storage needs. Source builds require additional memory.

## 1. Configure

The default deployment origin is `https://cardshelf.cloud`. Domain configuration here
does not modify DNS or deploy anything to a server.

From the extracted package root (or the repository root after publication):

```sh
sh scripts/configure.sh https://cardshelf.cloud
```

The script refuses to overwrite `.env`. Save the displayed first-use setup
token securely. Never commit `.env` or include it in a public issue.

| Setting | Meaning |
|---|---|
| `APP_ORIGIN` | The exact browser-visible origin, including a non-default port if used |
| `APP_DOMAIN` | Hostname served by the optional HTTPS proxy |
| `APP_BIND` | Host address for direct app port; defaults to `127.0.0.1` |
| `APP_PORT` | Direct host port; defaults to `3000` |
| `POSTGRES_PASSWORD` | Random database credential; generated as URL-safe hexadecimal |
| `BOOTSTRAP_TOKEN` | Random first-use setup token; ignored for account creation after setup closes |
| `TRUST_PROXY` | Trust forwarded client IP only behind your controlled proxy |
| `CATALOGUE_REQUEST_INTERVAL_MS` | Minimum pause between card import requests; default 300 ms |
| `APP_VERSION` | Installed release version, recorded by the upgrade helper |
| `CARDSHELF_IMAGE` | Published image reference; the upgrade helper pins the exact digest |

Request origins are compared exactly after canonicalising the configured URL.
If the page loads but mutations show “Request origin is not allowed”, correct
`APP_ORIGIN` to the address in the browser, then recreate app and worker. Do not
weaken the origin check or use `*` to work around a configuration mismatch.

## 2. Select one exposure method

First complete `sudo docker login ghcr.io -u frankymcgee` as described in
[GitHub setup](GITHUB_SETUP.md). Use the same Docker account for subsequent commands.
Wait for the release publishing job to succeed; Compose downloads the ready image.

### Supplied Caddy HTTPS proxy

Point the hostname's DNS records at your server, make TCP ports 80/443 reachable,
and make sure another service is not already using those ports. Then:

```sh
docker compose -f compose.yaml -f compose.https.yaml up -d --wait
```

Caddy's certificate issuance needs its documented domain/connectivity conditions.
The app port remains loopback-only and PostgreSQL is not published to the host.
The helper's HTTPS path is intended for standard port 443, not a custom TLS port.

Check service status:

```sh
docker compose -f compose.yaml -f compose.https.yaml ps
docker compose logs --tail=100 migrate app worker
docker compose -f compose.yaml -f compose.https.yaml logs --tail=100 caddy
```

`migrate` exiting successfully is expected: it is a one-shot service, not a daemon.
`app`, `db`, `worker`, and optional `caddy` are the long-running services.

### Existing reverse proxy

Start the base stack with `docker compose up -d --wait`. Route the externally
visible domain to the loopback app endpoint, set the correct `APP_ORIGIN`, and
let that proxy handle TLS. Set `TRUST_PROXY=true` only when untrusted clients
cannot bypass it or supply the forwarded IP used for throttling. No WebSocket
proxy configuration is currently required; this version is not realtime chat.

### Private local evaluation

```sh
sh scripts/configure.sh http://localhost:3000
docker compose up -d --wait
```

For a remote host, make an SSH tunnel from your computer:

```sh
ssh -L 3000:127.0.0.1:3000 your-user@your-server
```

Use `http://localhost:3000` in the browser. Match `APP_ORIGIN` to the forwarded
address. If port 3000 is occupied locally, choose a different explicit port and
configure it consistently. Do not expose the loopback evaluation endpoint as
an unauthenticated internet-facing HTTP service.

## 3. First deployment checklist

1. Confirm GitHub's release validation and **Publish release images** jobs succeeded.
   Do not bypass those gates to obtain an image if one fails.
2. Confirm the app and worker health checks are healthy and migrations succeed.
3. Complete administrator setup with your private token; verify setup cannot be
   claimed again. Create a second collector to check private-data separation.
4. Import a small set. Check the job finishes, card images display, printing labels
   are sensible, and any provider discrepancies are visible rather than assumed.
5. Add ownership in two conditions; refresh/re-sign-in and verify quantities.
   Open the same entry twice and confirm stale updates are rejected.
6. Create a binder, place owned and missing cards, swap them, change pages, and
   verify collection quantities stay unchanged. Test mobile touch/scrolling.
7. Enable a public share, check it in a signed-out/private window, then revoke
   it and confirm the old link no longer returns the layout.
8. Export/import ownership JSON, generate a database dump, and perform a restore
   rehearsal on a separate instance. Keep an off-server copy of your backup.

These checks are required acceptance work; this package does not claim they
have already been performed on your server or devices.

## 4. Reproducible release images

The validated `package-lock.json` is committed with the source. GitHub uses `npm ci`
and builds production images for Linux AMD64 and ARM64. Do not copy a lockfile from
the running container over the release's committed lockfile. Dependency and base-image
changes require the same validation gates before publication.

## 5. Routine backup

```sh
sh scripts/backup.sh
```

The script makes a transaction-consistent PostgreSQL custom-format archive in
`backups/`, with restrictive permissions and a SHA-256 sidecar where `sha256sum`
is available. It also refuses to overwrite an archive with the same timestamp.
The database need not be stopped for a normal dump.

A full recovery set consists of the dump, a securely stored `.env`, the source
and retained lockfile for the application version, plus any proxy configuration
changes. Caddy's certificate volumes can be preserved separately or certificates
can be reissued when domain requirements are satisfied. Also retain any separately managed Postal configuration, signing keys and volumes
when using self-hosted mail; see [Postal operation](POSTAL_EMAIL.md).

Dumps contain password hashes, session records and private collection notes.
Encrypt them at rest/off-server. The supplied script does not encrypt, upload,
prune or schedule backups. Configure your own backup scheduler and retention.
For example, a daily host cron entry may run the script from a fixed absolute
package directory; test your chosen scheduler and check its logs.

**Never use `docker compose down -v` as an update command.** It removes the named
PostgreSQL volume and can destroy the only copy of your database.

## 6. Restore deliberately

The restore script must be explicitly confirmed:

```sh
sh scripts/restore.sh backups/cardshelf-YYYYMMDDTHHMMSSZ.dump --confirm-restore
```

It checks the archive header, stops app/worker, takes a safety backup of the
current database, then restores in a single transaction. If the safety backup or
restore fails, it leaves the services stopped and prints the failure rather than
pretending recovery completed. After a successful restore it revokes all restored
sessions, requeues interrupted imports, applies current migrations and starts
app/worker. Everyone must sign in again.

A database snapshot also restores account/password state from that point in time.
Check accounts and credentials after a restore. A code rollback is not guaranteed
to be schema-compatible; preserve the matching pre-update dump and source version.
Rehearse restoration on a separate instance before relying on it in a real incident.

## 7. Update from GitHub-built releases

Complete the [one-time switch](GITHUB_SETUP.md#one-time-switch-for-the-existing-server)
after the first release is published. Routine updates then use:

```sh
sudo sh scripts/upgrade.sh
```

The helper downloads the image while the old site is running, checks its version and
host deployment compatibility, validates Compose, prepares the private `.env` update,
and takes a safety backup. Only then does it stop app/worker, migrate the database,
persist the image digest and wait for healthy replacement containers. It never stops
the database or proxy and does not recreate volumes. Simultaneous upgrades are refused.

If the release needs different host files, it stops before any downtime and asks you
to refresh the reviewed source checkout. Local host-file edits must also be reconciled.
Application-only releases do not need a routine `git pull`. Existing Postal installs
continue through the same Postal-aware Compose wrapper.

- Pull, metadata, configuration or backup failure: the old site stays running.
- Migration failure: app/worker remain stopped, `.env` retains the previous image,
  and the safety backup is available for investigation. Do not blindly start an old
  app against a potentially partially migrated database.
- Health-check failure after migration: the new digest remains pinned and the helper
  exits with an error. Inspect `sudo sh scripts/compose.sh logs --tail=100 app worker`.
  A code-only rollback is not assumed safe after a schema change.

To build a reviewed local checkout instead, use `sudo sh scripts/upgrade.sh --build`.
To select a specific published release, pass its version instead of `--build`.
Keep the matching source/configuration and pre-update dump for recovery.

## Development without Docker

Install Node.js 24 and provide a local PostgreSQL 17 database. Export the runtime
variables into your shell; Nuxt production/worker/migration scripts do not
implicitly execute a dotenv file as shell code.

```sh
export DATABASE_URL='postgresql://cardshelf:your-password@localhost:5432/cardshelf'
export APP_ORIGIN='http://localhost:3000'
export BOOTSTRAP_TOKEN='your-generated-64-character-hex-token'
npm ci
npm run migrate
npm run dev
# In a second shell with the same environment:
npm run worker
```

Use a separate database for tests. The integration tests refuse a database name
that does not end in `_test` and require `ALLOW_TEST_DATABASE=yes`.
