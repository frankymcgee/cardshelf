# Email providers — CardShelf 0.52.1

CardShelf can send password recovery, security notices and opted-in activity
notifications through **Postal API** or **authenticated SMTP**. Select the
provider under **More → Emails → Administration**. This applies to both durable
mail queues; it does not create a mailbox or download incoming email.

## Provider choice

| Service | Outgoing connection | Credentials | Delivery evidence |
|---|---|---|---|
| Postal | Deployment-pinned HTTPS API | Postal server API credential | API acceptance; correlated signed Postal delivery/bounce events |
| WPMU DEV Basic Email | `mailu.wpmudev.host`, port **587**, required **STARTTLS** | Full mailbox address and its password | SMTP acceptance; inspect the inbox, message headers and provider bounce reports |
| Custom SMTP | Public provider hostname, port **587 / STARTTLS** or **465 / TLS** | SMTP username and password or provider app password | SMTP acceptance; inspect the inbox and provider bounce reports |

External SMTP needs no Postal origin, API credential, signing public key,
containers, inbound SMTP listener or outbound port 25. Keep normal application
HTTPS and database/worker services. Allow the selected outbound submission port
through the host firewall. SMTP providers without password/app-password login,
or requiring OAuth-only authentication or an API-only transport, need a separate
adapter; their support is not implied by this SMTP option.

## WPMU DEV Basic Email

WPMU DEV's [current Basic Email guide](https://wpmudev.com/docs/hosting/emails/)
documents its SMTP host/port, full-address login and a hard limit of **10 messages
per minute per source IP**. The free mailbox is tied to a site they host and its
primary top-level domain; it is not a free standalone mailbox for any domain.
Its POP inbox has a 100 MB limit. Confirm your account can provision the desired
`cardshelf.cloud` mailbox in the Hub before selecting this service.

1. Create the sending mailbox in the WPMU DEV Hub and retain its password
   securely. Publish the exact mail/DNS records shown for that domain. Do not
   replace application A/AAAA records merely to change the mail transport.
2. In CardShelf's Emails administration, choose **External SMTP**, then
   **WPMU DEV Basic Email**. The preset fills the host, port and TLS mode.
3. Set the username to the full created mailbox address and enter its password.
   Use a sender address this mailbox is authorized to send from and a monitored
   reply address. The application's sender/reply addresses remain restricted to
   `cardshelf.cloud`.
4. Save with sending paused, then use **Check SMTP connection** with the current
   administrator password. The saved configuration is checked, not unsaved
   values. This performs DNS, verified TLS and login only; it sends no message.
5. Enable email, save, and run a connection check on that saved revision. Queue a
   test to your own administrator account. Check its receiving inbox and headers,
   then request and redeem a fresh password recovery email.

POP3 port **995** is for receiving mail in a client, not for CardShelf's outgoing
transport. Monitor that mailbox and provider reports for replies/bounces; add
manual recipient suppressions in CardShelf when appropriate. Basic SMTP does not
invent signed delivery or bounce events. WPMU DEV's default WordPress
transactional-email quotas are separate from this mailbox SMTP service; see its
[email-service distinctions](https://wpmudev.com/docs/getting-started/understanding-your-email-solutions/).

## Sending pace and queue safety

Set **Maximum emails per minute** to your provider's permitted rate, allowing
capacity for other applications sharing the account or source IP. WPMU's preset
rejects values above 10; custom SMTP accepts 1–60. Both CardShelf queues share an
atomic PostgreSQL reservation and space submissions evenly, with a small margin.
When both queues have eligible work, they alternate reservations so an activity
backlog cannot monopolize every slot and delay password recovery. Either queue
can use the available capacity when the other has no eligible work.
The recovery worker discards requests for unknown accounts in bounded batches
before reserving a sending slot and selects known accounts independently of that
backlog. Public recovery responses stay generic; no SMTP request or reset token
is created for an unknown account.
This limits CardShelf's attempts across processes; it does not reserve capacity
with the provider or include other applications' messages. A blocked reservation
does not claim a job, consume a delivery attempt or generate a recovery token.

An explicit authentication, TLS or SMTP rejection can retry up to three times.
A timeout, dropped DATA acknowledgment, malformed Postal success response or
crash after dispatch begins may mean the service already accepted the message.
Such jobs become **Delivery uncertain** and are never automatically resubmitted
or eligible for the ordinary notification retry action. Check provider records;
request a fresh recovery link when needed. A potentially accepted recovery link
remains valid until its normal expiry or password change. Plaintext reset tokens,
message bodies, credentials and provider error text are never stored in queue
history or application audit records.

Provider switching affects future queued submissions. Accepted and uncertain
jobs are not resent. Recorded deliveries retain their actual provider. The
saved Postal signing public key still verifies delayed historical Postal
events after selecting SMTP; those events cannot update SMTP rows. History from
Postal does not establish delivery through the new SMTP connection.

## Credentials, checks and upgrade

Migration **031_email_providers.sql** retains existing Postal credentials,
settings and deliveries. Previously sending jobs and unaccepted retry jobs with attempts are held as
uncertain, preventing an upgrade from blindly resending them. Legacy
server `.env` SMTP remains a fallback only until email settings are first saved;
an explicit paused/saved provider never revives that fallback.

Each provider has a separate authenticated encrypted credential. SMTP passwords
are bound to hostname, port, TLS mode and username. Blank means retain; a changed
server/account requires password re-entry or explicit removal. Changing provider
preserves the inactive credential. Removing the active credential pauses its
sending; removing the inactive credential does not disable the active provider.
Only presence flags are returned to the UI. Saving requires administrator
reauthentication, a current revision and the existing same-origin protections.

SMTP names must resolve exclusively to public IP addresses. Connections pin the
validated address while checking the certificate against the original hostname.
Private, loopback, link-local, metadata and reserved destinations are rejected.
TLS 1.2 or newer and certificate verification are required; there is no plaintext
or insecure-certificate switch. DNS, connection, greeting and socket operations
are bounded, with a 30-second submission deadline. Mail logging, URL/file content
loading and connection pooling are disabled. See the [Nodemailer transport
documentation](https://nodemailer.com/smtp) for the underlying verify/TLS behavior.
Submission TLS does not guarantee encryption between the provider and recipient.

The readiness page adapts to the selected transport. SMTP uses recent connection
verification and manual receiving-inbox acceptance; it does not require Postal
webhooks or treat SMTP acceptance as delivered. Checks are read only and make no
provider requests. A save invalidates prior SMTP verification; a failed check
clears it and a concurrent edit cannot record stale success. DNS diagnostics
inspect the selected sender and only query Postal server records for Postal.

Retain the **existing** `CARDSHELF_INTEGRATION_KEY` and the private application
configuration with off-server backups. Database backups retain encrypted
settings, provider history and suppressions. Restore runs current migrations and
expires pending mail/reset credentials and clears old SMTP verification evidence
before restarting. Test a current backup
in an isolated installation before relying on restoration. Switching transport
does not retire an existing Postal deployment or delete its databases: preserve
its backups and manage its Compose/proxy configuration separately if retiring it.
See [optional Postal operations](POSTAL_EMAIL.md) for that stack.

## Acceptance before public registration

Automated synthetic tests cover encryption/binding, secret-free APIs, destination
blocking, real STARTTLS and implicit TLS, rejected certificates/authentication,
lost acknowledgments, provider switching, pacing, recovery redemption and
desktop/phone settings. CI also exercises migration and native-image upgrades.
These tests do not contact your WPMU account or certify inbox placement.

Complete receiving-inbox and reset-redemption acceptance on the installed
version. Also complete the existing Live payment, physical-device push,
production-data restoration and two-seat Arena/tournament acceptance before
claiming a fully validated public launch. Feature gaps remain in
[PARITY_CHECKLIST.md](PARITY_CHECKLIST.md).
