# CardShelf email with Postal

Postal is one optional sending provider. For WPMU DEV or another SMTP service,
use [EMAIL_PROVIDERS.md](EMAIL_PROVIDERS.md); its setup does not require this stack.

CardShelf uses `https://cardshelf.cloud`. Its application email controls are under **More → Emails**: sender identity, Postal API credential, tests, delivery history and the sending switch. The credential is encrypted using the existing `CARDSHELF_INTEGRATION_KEY`; keep that key when upgrading or restoring. `POSTAL_ORIGIN=https://postal.cardshelf.cloud` is a server-controlled HTTPS endpoint, not a user-supplied delivery URL.

This bundle runs Postal beside the existing CardShelf stack. It adds MariaDB and Postal's web, SMTP and worker services. The existing Caddy remains the only listener on ports 80/443; Postal's web port 5000 and database port 3306 stay internal. SMTP receives bounces on port 25. Postal 3.3.7, MariaDB 11.4.13 and Caddy 2.11.4 are pinned release tags, verified against their official release/image sources on 20 September 2026. No `latest` image is used. Postal needs all three processes, with configuration mounted at `/config`. [Postal containers](https://docs.postalserver.io/other/containers/), [Postal 3.3.7](https://github.com/postalserver/postal/releases/tag/3.3.7).

## Before installation

Use a Linux host with Docker Engine, the Docker Compose plugin, OpenSSL, an up-to-date system CA trust store and GNU core utilities already installed. The deployment account needs Docker access. These scripts do not install packages, invoke `sudo`, change DNS, or create accounts on external services. Postal recommends a dedicated server and at least 4 GB RAM, two CPU cores and 25 GB storage for Postal alone. A shared CardShelf host needs additional capacity for PostgreSQL, the application, catalogue jobs, mail queues and backups. Monitor free disk space and memory. [Postal prerequisites](https://docs.postalserver.io/getting-started/prerequisites/).

Confirm all of the following with the hosting provider before enabling mail:

- A stable public sending IP with controllable reverse DNS/PTR, suitable mail reputation and outbound TCP 25 permitted.
- Inbound TCP 25 reaches this host; no existing Postfix, Exim or other service already occupies it.
- TCP 80/443 reach the existing Caddy for HTTPS issuance. Do not start a second Postal Caddy container. DNS lookups and outbound HTTPS must work.
- Mail hostnames use ordinary DNS records, not an HTTP-only CDN/proxy. Publish IPv6/AAAA only when routing, outbound delivery, firewall, PTR and SPF are also correct for that IPv6 address.

## Set the application domain explicitly

For a new installation, the normal command now defaults to the requested domain:

```sh
sh scripts/configure.sh https://cardshelf.cloud
```

For an existing installation, first take its usual backup and a secure copy of `.env`. Change only these origin entries in that existing file after arranging the new domain's DNS:

```dotenv
APP_ORIGIN=https://cardshelf.cloud
APP_DOMAIN=cardshelf.cloud
```

Preserve database credentials, `BOOTSTRAP_TOKEN` and especially `CARDSHELF_INTEGRATION_KEY`. If the integration key is missing, run `sh scripts/configure-integrations.sh`. Update any external provider callbacks that still point at the previous site hostname. Users sign in at the new domain; browser cookies for the old domain are not transferred. The Postal bootstrap deliberately rejects a mismatched origin rather than rewriting the live `.env`.

## Generate and initialize Postal

Run from the CardShelf repository root. The application should already be deployed using the normal HTTPS configuration; use the release's `scripts/upgrade.sh` for an existing app.

```sh
sh scripts/configure-postal.sh
sh scripts/compose.sh pull postal-db postal-web postal-worker postal-smtp caddy
sh deploy/postal/prepare-permissions.sh
sh scripts/compose.sh up -d --wait --wait-timeout 180 postal-db
sh scripts/compose.sh run --rm --no-deps postal-web postal initialize
sh scripts/compose.sh run --rm --no-deps postal-web postal make-user
sh scripts/compose.sh up -d --no-deps --wait --wait-timeout 180 postal-web postal-worker
sh scripts/compose.sh up -d --no-deps caddy
```

`configure-postal.sh` generates a database password, a Rails session secret and a 2048-bit installation signing key. It refuses to overwrite existing material. Generated files are excluded from both Git and Docker build contexts. Postal's official image runs UID 999; the permissions helper uses a short-lived Docker container as root, with no network, to set ownership on only this generated directory. It does not elevate the host shell or mount the Docker socket into CardShelf.

Postal creates its schema and its first administrator through the two explicit commands above. Keep that administrator credential in your password manager. [Official installation flow](https://docs.postalserver.io/getting-started/installation/), [configuration schema](https://github.com/postalserver/postal/blob/3.3.7/doc/config/yaml.yml).

The generated `deploy/postal/.enabled` makes `sh scripts/compose.sh` select all three Compose files and the private Postal environment file. Use this wrapper for the combined stack. CardShelf's upgrade, backup and restore scripts also use it. Existing installations without that marker keep their previous Compose behavior. Preserve your existing application `Caddyfile`: the Postal overlay imports it and adds only the Postal and SMTP hostnames. If you use a different reverse proxy instead of the supplied Caddy, adapt these routes and certificate handoff before enabling the overlay.

## If postal-web is unhealthy

Versions through 0.20.2 probe Postal's web server using the loopback address without its configured hostname. Postal's Rails host authorization rejects that request with HTTP 403 even when the web server is running. Version 0.20.3 sends `Host: postal.cardshelf.cloud` while still connecting directly to `127.0.0.1:5000`; it accepts the normal login redirect without following it through public DNS or HTTPS.

After updating your checkout to 0.20.3 or later, recreate only the web container so Docker loads the corrected health check:

```sh
sh scripts/compose.sh up -d --no-deps --force-recreate --wait --wait-timeout 180 postal-web
```

A plain container restart keeps the old probe. Preserve the generated configuration, keys and database; this fix does not require running `configure-postal.sh`, `postal initialize` or `postal make-user` again. Resume the installation at the worker/Caddy steps once the web service is healthy.

If it remains unhealthy, inspect only its health state and recent application logs:

```sh
postal_web_id=$(sh scripts/compose.sh ps -q postal-web)
if [ -n "$postal_web_id" ]; then
  docker inspect --format '{{json .State.Health}}' "$postal_web_id"
fi
sh scripts/compose.sh logs --tail=80 postal-web
```

The corrected probe includes curl error output so connection failures and HTTP errors appear in Docker's health log. These checks do not dump the container environment or private configuration.

## DNS records

All names below are full names in the `cardshelf.cloud` zone. DNS panels may expect only the part before `.cardshelf.cloud`. Replace `<PUBLIC_IPV4>` with this server's real public IPv4; it is intentionally not supplied by the patch. A TTL of 300 is convenient during setup.

| Name | Type | Value |
| --- | --- | --- |
| `cardshelf.cloud` | A | `<PUBLIC_IPV4>` |
| `postal.cardshelf.cloud` | A | `<PUBLIC_IPV4>` |
| `smtp.cardshelf.cloud` | A | `<PUBLIC_IPV4>` |
| `rp.postal.cardshelf.cloud` | A | `<PUBLIC_IPV4>` |
| `spf.postal.cardshelf.cloud` | TXT | `v=spf1 ip4:<PUBLIC_IPV4> -all` |
| `rp.postal.cardshelf.cloud` | MX | Priority `10`, target `smtp.cardshelf.cloud` |
| `rp.postal.cardshelf.cloud` | TXT | `v=spf1 include:spf.postal.cardshelf.cloud -all` |
| `postal._domainkey.rp.postal.cardshelf.cloud` | TXT | Exact installation DKIM value produced by the command below |
| `psrp.cardshelf.cloud` | CNAME | `rp.postal.cardshelf.cloud` |
| `<POSTAL_SELECTOR>._domainkey.cardshelf.cloud` | TXT | Exact sending-domain DKIM name/value from Postal's DNS Setup screen |
| `cardshelf.cloud` | TXT | Merge `include:spf.postal.cardshelf.cloud` into the existing single SPF record |

Obtain the installation's real DKIM record:

```sh
sh scripts/compose.sh run --rm --no-deps postal-web postal default-dkim-record
```

For a domain with no existing senders, an initial apex SPF value is `v=spf1 include:spf.postal.cardshelf.cloud -all`. If an SPF record already exists, retain its legitimate senders and add the Postal include before its final `all` mechanism. **Do not publish a second SPF record.** Keep within SPF's DNS lookup limit. Leave the apex MX records for your existing mailbox provider intact: Postal does not need to replace them to send application email. The `rp.postal` MX handles delivery bounces. CNAME names must not also have TXT/A/MX records. [Postal DNS setup](https://docs.postalserver.io/getting-started/dns-configuration/).

At the provider that owns the IP, set its PTR to `smtp.cardshelf.cloud`; the forward A record must resolve back to that IP. The generated Postal HELO hostname matches this name. PTR changes belong with the IP provider, not the ordinary domain zone.

In Postal's console, add `cardshelf.cloud` as the sending domain and copy its exact generated DKIM selector/key. Publish a domain-verification TXT token only if its screen requests one. Run its DNS checks after propagation. Domain DKIM and the installation signing key are different keys; do not substitute either public key for the other. The `psrp` return path gives relaxed SPF alignment with the sending domain. [Sending-domain setup](https://docs.postalserver.io/features/sending-domains/).

Start DMARC in monitoring mode. If `dmarc@cardshelf.cloud` is an existing, monitored mailbox, use:

```text
Name: _dmarc.cardshelf.cloud
Type: TXT
Value: v=DMARC1; p=none; rua=mailto:dmarc@cardshelf.cloud; adkim=r; aspf=r
```

If that mailbox does not exist, omit `rua` until you provision a working reporting address; Postal is not an IMAP mailbox service. Review real messages and aggregate reports for every authorized sender before moving to `p=quarantine`, then `p=reject`. Merge changes into the one existing DMARC record. Do not apply rejection while legitimate senders are still failing alignment.

## HTTPS and SMTP TLS

After the `postal` and `smtp` A records resolve and Caddy has issued certificates:

```sh
sh scripts/compose.sh logs --tail=80 caddy
sh deploy/postal/sync-certificates.sh
sh scripts/compose.sh up -d --no-deps --wait --wait-timeout 180 postal-smtp
```

CardShelf submits mail through the HTTPS API with certificate verification. Inside this stack the same hostname resolves to Caddy via a Docker network alias, avoiding a public-IP hairpin while preserving TLS hostname checks. Postal webhooks similarly reach `cardshelf.cloud` through Caddy. Only that exact callback hostname is allowed through Postal's private-destination request guard.

SMTP has a separate public certificate and chain. The sync script discovers certificates across Caddy's issuer directories, checks the trusted chain, server purpose, hostname, key match and validity period, and installs the newest valid pair with private permissions. It restarts only Postal SMTP when the pair changes. Postal caches this material, so renewal without that restart would continue serving the old certificate. [Postal SMTP TLS](https://docs.postalserver.io/features/smtp-tls/).

Schedule the sync script hourly or daily under the deployment account that already has Docker access. For example, in that account's crontab, adapting the repository path:

```cron
15 * * * * /bin/sh /opt/cardshelf/deploy/postal/sync-certificates.sh
```

Monitor scheduler failures and certificate expiry. If an interrupted job leaves `deploy/postal/.smtp-sync.lock`, first confirm no sync is running, then remove that empty lock directory and rerun. Caddy's own HTTPS renewal remains automatic.

The supplied Postal setting `ssl_version: TLSv1_2` means **TLS 1.2 only** for incoming STARTTLS; it does not enable obsolete SSL protocols or claim TLS 1.3 support. Enabling STARTTLS does not force every remote MTA to use it. CardShelf does not send API credentials over SMTP. Direct delivery to other mail servers still depends on the recipient's TLS support and Postal's outbound behavior; HTTPS submission is not end-to-end message encryption. Do not create broad SMTP-IP credentials or disable certificate verification. Verify the exposed SMTP endpoint from another host:

```sh
openssl s_client -starttls smtp -connect smtp.cardshelf.cloud:25 -servername smtp.cardshelf.cloud -verify_hostname smtp.cardshelf.cloud -verify_return_error -tls1_2
```

## One-time Postal console setup, then More → Emails

Open `https://postal.cardshelf.cloud` and sign in as the Postal administrator:

1. Create the CardShelf organization and a production mail server.
2. Add/verify `cardshelf.cloud`, complete its DNS Setup checks and leave click/open tracking disabled unless you deliberately configure it later.
3. Create an **API credential** for that mail server. API v1 does not provision the whole Postal installation; organization/server/domain/credential setup remains this one-time console step.
4. In **More → Emails**, save that API credential, your sender address/name, and the requested email settings. Complete the credential and DNS checks first, then enable sending for your own test. Pause sending again if the result needs investigation.
5. Configure Postal's delivery webhook using the exact URL shown in the hub and its requested event types. Copy the installation's signing **public** key into the hub for verification; never copy `signing.key`.

Read the public key after the private directory's permissions have been prepared:

```sh
sh scripts/compose.sh run --rm --no-deps -T --entrypoint cat postal-web /config/signing-public.pem
```

The integration verifies the current `X-Postal-Signature-256` signature over the original request body. Use the pinned Postal version and the corresponding signing public key. After a test, inspect the recipient's headers for SPF/DKIM/DMARC alignment and the hub's delivery event. A Postal API acceptance is a queue acceptance, not proof of inbox delivery.

Postal's own administrator password-reset and operational notices are separate from CardShelf messages. If you need them, configure Postal's `smtp` section using a Postal SMTP credential or an existing verified TLS relay, then restart Postal. Its `enable_starttls: true` and `openssl_verify_mode: peer` options enforce verified STARTTLS for that administrative relay. Keep its host credentials private; all CardShelf application message controls remain in **More → Emails**. [Postal administrative email](https://docs.postalserver.io/getting-started/installation/), [SMTP credentials](https://docs.postalserver.io/features/smtp-authentication/).

## Operations, backups and upgrades

```sh
sh scripts/compose.sh ps
sh scripts/compose.sh logs --tail=100 postal-web postal-worker postal-smtp
sh scripts/backup.sh
sh deploy/postal/backup.sh
```

The ordinary CardShelf backup contains PostgreSQL data, including encrypted email integration settings and the application's delivery queue. On restore, the script runs current migrations, revokes historical sessions/reset tokens and expires queued or in-progress application/recovery mail before restarting the app. Previously accepted/delivered history, suppressions and integration settings are retained; request a fresh reset link when needed. It does **not** contain Postal's MariaDB message databases, signing keys, `.env` or Caddy certificate volumes. The separate Postal backup includes its main database and all per-mail-server databases. For a coordinated maintenance backup, pause sending in the hub and stop `postal-web`, `postal-worker` and `postal-smtp` before taking the Postal dump; this prevents new schema creation while dumping. Start those services again after the backup.

Keep encrypted, access-restricted off-server copies of:

- The CardShelf PostgreSQL dump and its original root `.env`, particularly `CARDSHELF_INTEGRATION_KEY`.
- The Postal SQL dump, `deploy/postal/.env`, `deploy/postal/.enabled` and the complete private `deploy/postal/config` directory, including signing keys and SMTP certificate material.
- Your application/Postal Caddyfiles, Caddy data/config volumes and the image versions/digests used for that backup.

Postal stores mail content and recipient information; backups and logs need the same protection as production data. Set suitable retention in Postal and monitor queue/disk growth. Never publish a support bundle containing these files.

`scripts/upgrade.sh` upgrades CardShelf while preserving the selected Postal overlay; it does not migrate Postal. Before upgrading Postal itself, read its release notes, back up first, change its explicit image tag consistently in the overlay and the two scoped helper scripts, pull the new images, stop its three application processes, run `sh scripts/compose.sh run --rm --no-deps postal-web postal upgrade`, then recreate them. Do not rotate signing keys or the integration encryption key as part of an ordinary upgrade. Test restoring into an isolated host before relying on backups.

For a Postal restore, use the same MariaDB/Postal versions as the backup first, restore the matching private configuration, stop its three application processes, and restore the full SQL dump into `postal-db` using `mariadb` as its internal root account. This is a destructive database replacement and must be a deliberate maintenance operation. Keep a fresh safety backup, then run the appropriate Postal upgrade command before starting a newer version. Resync the SMTP certificate after restoring Caddy/configuration. Restoring only PostgreSQL or only MariaDB does not restore the complete mail system.

The patch validates local code, configuration and scripts. DNS propagation, public certificates, PTR, port-25 reachability, IP reputation and actual external delivery require these deployment checks on your server.
