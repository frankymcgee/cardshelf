# Retiring the old mail server — CardShelf 0.55.0

CardShelf now uses external SMTP. The existing WPMU DEV Pro connection remains
configured after this upgrade. The application no longer sends through Postal or
accepts its webhook events, and new installs do not provision local mail services.

## Upgrade

After the PR is merged and its release images are published, run from the existing
CardShelf checkout:

```sh
git pull --ff-only origin main
sudo sh scripts/upgrade.sh
```

The host deployment contract changed, so update the source before running the
image upgrade. The normal backup runs before migration. Migration 035 removes
retired credentials, signing keys and webhook receipts, while retaining active
SMTP settings/passwords, connection verification, delivery history and recipient
suppressions. A configuration still selecting the retired provider is paused,
requiring explicit SMTP setup; it cannot silently start sending through an
inactive account. Queued jobs retain normal SMTP processing; accepted and
uncertain jobs are not requeued.

If `deploy/postal/.enabled` identifies the old same-host deployment, the upgrade
runs `scripts/retire-postal.sh` after CardShelf's new app and worker are healthy.
It restores the ordinary application Caddyfile and HTTPS Compose configuration,
then removes only this Compose project's `postal-web`, `postal-worker`,
`postal-smtp` and `postal-db` containers and their three dedicated networks.
Caddy is briefly recreated; application PostgreSQL and the shared Caddy
certificate/configuration volumes remain intact. The private Postal environment
and removed overlay are not needed to retire the stack.

The script removes only this checkout's certificate-sync and Postal-backup jobs
from the invoking account's crontab, first saving a private copy under `backups/`.
Review crontabs belonging to other accounts, system cron directories and any
custom systemd timers separately. Custom externally managed deployments require
their own service retirement; this helper targets the supplied Compose stack.

## Permanently remove retired mail data

The normal upgrade retains the old mail database volume and ignored private files
for recovery. After confirming WPMU delivery and retaining any required mail
archive, explicitly remove them with:

```sh
sudo sh scripts/retire-postal.sh --purge-data
```

This is permanent: it deletes this project's labelled `postal_database` Docker
volume and the local `deploy/postal` private directory, including old mail
credentials, signing keys and SMTP certificates. It does not delete application
data, shared Caddy certificates, other projects' volumes, or off-server backups.
It can be rerun. No global Docker prune or project-wide `down --volumes` is used.

Older CardShelf database/host backups can still contain retired encrypted
credentials; manage their retention according to your backup process. The helper
does not delete archives or modify DNS/provider accounts. Remove old Postal-only
webhook destinations, DNS records, obsolete SPF authorizations and firewall rules
through their respective management systems after checking they are unused.
Retain the records WPMU DEV supplies for the active mailbox. Shared web records
and a DMARC record used by current senders must remain valid.

## Verify

Check **More → Emails → Administration** for the saved WPMU preset and enabled
status, then send a test and receive/redeem a fresh recovery email. Inspect the
inbox and provider reports; acceptance alone does not establish delivery. Check
`sudo sh scripts/compose.sh ps -a` for healthy application services and normal
HTTPS access. Port 25 should no longer be published by the removed mail stack.
