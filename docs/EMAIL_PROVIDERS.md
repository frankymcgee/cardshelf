# Email delivery — CardShelf 0.55.0

CardShelf sends recovery links, email verification, account security notices and
opted-in activity notifications through authenticated external SMTP. Configure
**More → Emails → Administration**. SMTP needs no locally hosted mail server.

| Service | Outgoing host | Encryption | Login |
| --- | --- | --- | --- |
| WPMU DEV Pro Email | `mail.mailconfig.net` | TLS on 465 or required STARTTLS on 587 | Full mailbox address and mailbox password |
| WPMU DEV Basic Email | `mailu.wpmudev.host` | Required STARTTLS on 587 | Full mailbox address and mailbox password |
| Custom SMTP | Provider's public hostname | TLS on 465 or required STARTTLS on 587 | SMTP username and password/app password |

## WPMU DEV setup

1. Provision the sending mailbox in the WPMU DEV Hub and publish its domain
   authentication records. Keep the application’s web DNS records unchanged.
2. Choose the matching Basic or Pro preset. Use an authorized `cardshelf.cloud`
   sender address and the full mailbox address as the SMTP username. Enter the
   mailbox password, then save with email paused.
3. Use **Check SMTP connection** with your administrator password. It checks the
   saved hostname, TLS and login without sending a message.
4. Enable email and save, then send a test to your administrator account. Check
   the receiving inbox/spam folder and message headers for sender signing.
5. Request and redeem a fresh recovery link. Check email verification and any
   optional notifications you enable under your personal Emails preferences.

The Pro preset defaults new connections to TLS on port 465. Selecting it for an
existing `mail.mailconfig.net` connection retains its valid TLS/port pair. Changing
host, port, encryption or username requires password re-entry. Existing working
WPMU connections survive the 0.55.0 migration without re-entry or re-verification.

Choose a sending pace within the account's allowance, including capacity used by
other applications. Basic is limited to 10 messages per minute; CardShelf accepts
1–60 for Pro/custom SMTP. The per-minute pace does not enforce account daily
quotas. Check the Hub for the mailbox's current allowance. See WPMU DEV’s
[Pro Email guide](https://wpmudev.com/docs/hub-2-0/pro-email/) and
[Basic Email guide](https://wpmudev.com/docs/hosting/emails/).

## Credentials and delivery

Passwords are encrypted using the existing `CARDSHELF_INTEGRATION_KEY`, bound to
the SMTP hostname, port, TLS mode and account. Blank retains the saved password;
explicit removal pauses sending. Credentials never appear in API responses or
audit records. Changes require administrator password confirmation and a current
settings revision. Keep the existing encryption key and private `.env` secure.

Connections validate public DNS destinations, pin the selected address and verify
the certificate against the original hostname. TLS 1.2 or newer is required.
Recovery, verification and notifications share one durable pacing reservation so
an activity backlog cannot monopolize account-access mail.

Explicit failures can retry within the bounded attempt limit. A lost submission
acknowledgement or crash after dispatch starts becomes **Delivery uncertain** and
is never automatically resent or eligible for an ordinary notification retry.
Check provider records before requesting a fresh recovery message. A potentially
accepted recovery link retains its normal expiry. No token plaintext, message
body or provider error text is persisted in the queue.

SMTP acceptance does not establish inbox delivery. Monitor the provider's bounce
reports and receiving mailbox, and manage recipient suppressions in CardShelf.
Historical delivery/suppression records remain available; they do not establish
success for the current SMTP connection. DNS checks inspect the sender's SPF,
DMARC and configured public DKIM record only. They do not prove signing or
alignment of outgoing mail.

Readiness uses the current connection's recent TLS/login verification and a
separate receiving-inbox acceptance check. Saving changes invalidates the old
connection check. Restoring a backup also clears verification evidence and expires
pending mail/reset credentials before restarting.

Legacy `.env` SMTP is used only when no email settings have ever been saved. A
saved paused or incomplete configuration never revives the fallback. New
installations should use the administrator interface.

## Retired local mail stack

Postal is no longer a supported provider. Migration 035 deletes its saved API
credential, signing public key and webhook receipts. Settings still selecting it
are converted to paused SMTP; the operator must configure a connection explicitly.
Active SMTP settings, encrypted passwords, verification revisions, historical mail
records and suppressions are retained. Accepted or uncertain mail is not requeued.

For removal of previously installed containers, private configuration and mail
storage, follow [mail resource retirement](MAIL_RETIREMENT.md). Old migrations
remain immutable so both existing databases and fresh installations can apply the
full migration sequence.
