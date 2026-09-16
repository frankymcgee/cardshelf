# Deployment, updates and recovery

## Status and prerequisites

This is an initial source-code deployment candidate, not an already deployed
service. The package's full Docker/Nuxt/PostgreSQL stack could not be executed in
the authoring environment. Follow the first-deployment checklist and retain the
resolved dependency lockfile before using it as a release.

Use a separate Linux server/VM with Docker Engine and the Compose plugin. No
Frappe components are required. A practical initial allocation to evaluate is
2 vCPU / 4 GB RAM plus SSD space, but this is an **unbenchmarked starting
assumption**, not a measured minimum or capacity commitment. Node dependency
installation/build can require more memory than steady-state serving. Disk use
will depend on catalogue size, database growth and backup retention.

## 1. Configure

The intended deployment is `https://tcg.webwire.cloud`. Domain configuration here
does not modify DNS or deploy anything to a server.

From the extracted package root (or the repository root after publication):

```sh
sh scripts/configure.sh https://tcg.webwire.cloud
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
| `APP_VERSION` | Local image tag; defaults to `0.1.1` |

Request origins are compared exactly after canonicalising the configured URL.
If the page loads but mutations show “Request origin is not allowed”, correct
`APP_ORIGIN` to the address in the browser, then recreate app and worker. Do not
weaken the origin check or use `*` to work around a configuration mismatch.

## 2. Select one exposure method

### Supplied Caddy HTTPS proxy

Point the hostname's DNS records at your server, make TCP ports 80/443 reachable,
and make sure another service is not already using those ports. Then:

```sh
docker compose -f compose.yaml -f compose.https.yaml up -d --build
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

Start the base stack with `docker compose up -d --build`. Route the externally
visible domain to the loopback app endpoint, set the correct `APP_ORIGIN`, and
let that proxy handle TLS. Set `TRUST_PROXY=true` only when untrusted clients
cannot bypass it or supply the forwarded IP used for throttling. No WebSocket
proxy configuration is currently required; this version is not realtime chat.

### Private local evaluation

```sh
sh scripts/configure.sh http://localhost:3000
docker compose up -d --build
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

1. Confirm the Docker build completes its **unit tests, typecheck and Nuxt build**.
   Do not remove those gates to obtain an image if one fails.
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

## 4. Retain the lockfile

The authoring environment could not resolve npm packages. The first connected
build generates `package-lock.json` inside the image. Copy it into your source:

```sh
docker compose cp app:/app/package-lock.json ./package-lock.json
```

Commit it. Future Docker builds use `npm ci`. Review dependency audit results on
a connected machine and pin validated base-image digests for releases. Changing
a package version or base image should be followed by the same acceptance tests.

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
can be reissued when domain requirements are satisfied. There are no user-uploaded
files or locally stored card images in this initial version.

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

## 7. Update from a newer source release

First retain `.env`, the database volume and an off-server backup. Replace only
source files, not `.env` or stored data. From the updated package directory:

```sh
sh scripts/backup.sh
docker compose stop app worker
docker compose build
docker compose run --rm migrate
docker compose up -d app worker
```

For a first deployment or proxy configuration changes, include the HTTPS override
as in section 2. A running Caddy container can remain running while the app is
updated. Check all service health/logs after the update. Do not run the new
migration against a database that is still being changed by the old app/worker.

## Development without Docker

Install Node.js 24 and provide a local PostgreSQL 17 database. Export the runtime
variables into your shell; Nuxt production/worker/migration scripts do not
implicitly execute a dotenv file as shell code.

```sh
export DATABASE_URL='postgresql://cardshelf:your-password@localhost:5432/cardshelf'
export APP_ORIGIN='http://localhost:3000'
export BOOTSTRAP_TOKEN='your-generated-64-character-hex-token'
npm install
npm run migrate
npm run dev
# In a second shell with the same environment:
npm run worker
```

Use a separate database for tests. The integration tests refuse a database name
that does not end in `_test` and require `ALLOW_TEST_DATABASE=yes`.
