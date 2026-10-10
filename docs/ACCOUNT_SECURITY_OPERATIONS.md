# Account security operations

This runbook covers staged activation, independently verified MFA-loss recovery,
and database restoration. Implementing this release does **not** enable an
administrator-enforcement policy, enroll a real account, authorize production
recovery, or authorize a production restore. Rehearse with synthetic accounts and
a disposable installation first.

## Before relying on account security

1. Keep the current image/deployment files, secured database backup and matching
   `.env` backup. Apply all migrations, including account security and email
   verification, through the normal upgrade flow. Never point tests at production.
2. Serve the application at its stable HTTPS `APP_ORIGIN`. A passkey belongs to its
   relying-party hostname; a different staging hostname is a different site.
   Do not weaken origin/RP checks to make production passkeys work in staging.
3. Configure and back up the existing `CARDSHELF_INTEGRATION_KEY` before enrolling
   a TOTP authenticator. The key encrypts TOTP seeds and integration credentials.
   Use `sh scripts/configure-integrations.sh` only as its instructions permit;
   never overwrite an existing key while encrypted data depends on it.
4. Verify the selected email provider using a synthetic account, including actual
   inbox delivery, a fresh verification link, expiry and one-time redemption.
   Delivery-provider acceptance alone does not prove inbox placement. Email
   verification proves control of the address; it is not an MFA factor. Existing
   accounts retain their explicit legacy-access status on upgrade without being
   falsely marked as having verified their mailbox.
5. Open account security at `/security`. Test factor enrollment, sign-in and recovery on an ordinary synthetic account
   before a real administrator. Add a second independent factor where possible.
   Store each account's one-time recovery codes offline, separately from its
   password and enrolled device. Codes are displayed once; the server keeps
   hashes and cannot retrieve their plaintext later.
6. Test a synthetic administrator's enrollment and fresh MFA sign-in, including
   interrupted enrollment, expired challenges, a used recovery code and attempts
   to access administrator APIs while authentication is pending. Confirm that a
   password reset does not remove an existing MFA requirement.
7. Set `CARDSHELF_REQUIRE_ADMIN_MFA=true` only after each
   administrator has a tested factor/recovery path and an independently verified
   server operator can follow the emergency process below. Keep this policy
   separate from rollout of the migrations and optional enrollment. The default
   is off. `CARDSHELF_WEBAUTHN_RP_ID`, when supplied, must exactly match the
   `APP_ORIGIN` hostname; it cannot be used to broaden passkey scope.

A first-factor password result, recovery-code result or enrollment challenge is
not a full account session. In a forced recovery, access remains enrollment-only
until a new factor is verified. Neither an email verification link nor a password
reset link grants administrative access or disables MFA.

## Server-operator MFA-loss recovery

This is a controlled server-console procedure, not a public or administrator-UI
MFA reset endpoint. It is suitable when an administrator has lost all factors and
unused recovery codes. The operator must independently establish the account
holder's identity and authority using the deployment owner's incident process.
Possession of the registered mailbox alone is insufficient. Record the evidence,
approver and incident reference in the restricted incident system, not in CLI
arguments or application logs.

The tool defaults to read-only inspection. For example, on an installation using
the supplied Compose wrapper:

```sh
sh scripts/compose.sh run --rm --no-deps -T app \
  node scripts/recover-admin-mfa.mjs --email admin@example.com --dry-run
```

Review the exact account, role, factor count and existing recovery state before
proceeding. An email substring, username or account selected by search position
is not accepted. The following commands are examples only, not instructions to
run them against a live account without separate incident authorization.

1. Verify the account holder and incident through a trusted, independent channel.
   Arrange for the account holder to be present and ready to enroll within 30
   minutes. Use a private console without terminal recording or shared output.
2. Restrict the service during the operation, including other app replicas and
   external job runners. Stop the supplied app and worker, keeping the database
   available. This also prevents an already-dispatched mail job racing cleanup.
3. Run the explicit recovery command with the same target address twice, the
   identity-verification acknowledgment, and a non-secret incident reference:

```sh
sh scripts/compose.sh stop app worker
sh scripts/compose.sh run --rm --no-deps -T app \
  node scripts/recover-admin-mfa.mjs \
  --email admin@example.com \
  --execute --confirm-email admin@example.com --confirm-identity \
  --reason 'INC-2026-10010 verified through approved process'
```

4. The command atomically revokes the target's sessions, pending authentication,
   challenges, step-up proofs, TOTP credentials, passkeys, recovery codes,
   password-reset tokens and email-verification tokens/queued requests. It
   increments the account security version and marks it for forced re-enrollment.
   The password, email-verification status, role, collection, memberships and
   billing are unchanged. The audit records the target, timestamp and a SHA-256
   digest of the incident reason, never the plaintext reason or recovery code.
5. The command displays one new 128-bit random recovery code once. Only its
   account-bound hash is stored, with a 30-minute expiry. This temporary operator
   grant uses the same single-use recovery-code path and is invalidated by any
   subsequent operator recovery. Do not paste it into a ticket, shell command,
   support chat, build log or email. Provide it only to the independently verified
   account holder through the approved private channel. Avoid saving stdout.
6. Restart only after the command succeeded and the recovery state is understood:

```sh
sh scripts/compose.sh up -d app worker
```

7. The account holder signs in with the **existing password**, selects recovery
   code authentication, and enters the temporary code. Consuming it creates an
   enrollment-only flow. They must enroll and verify a new TOTP authenticator or
   passkey before receiving a full session or administrative privileges. Save
   the new ordinary recovery codes privately and test a fresh sign-in. Other
   factor copies that existed before the operation remain invalid.
8. If the grant expires, is consumed in an interrupted flow that then expires, or
   the output was lost, re-inspect and repeat the independently authorized
   procedure. The server cannot reveal the old code. Issuing another code revokes
   all previous recovery state again; do not attempt to reuse an earlier code.
   A connection failure during commit can leave the result uncertain. Keep the
   service restricted and inspect the account again before a deliberate retry;
   do not assume the old credentials remain valid because no code was displayed.

There is intentionally no password-reset option in this CLI and no way to turn
an email link into MFA proof. If the password is also lost, use the separate
approved password-recovery process; MFA remains required. When both processes
are needed, finish password recovery first and then issue the short-lived MFA
recovery grant, because password changes invalidate pending authentication state.
Do not change `password_hash`, clear `mfa_reset_required`, downgrade the account,
relax enforcement, or manually insert a session to get around this procedure.

The same tool supports a restored **non-administrator** account only when it is
already marked for forced MFA recovery, by additionally passing
`--restored-account`. All the same exact-email, identity, incident and execution
requirements apply. This flag cannot recover an arbitrary ordinary account or
turn a normal password-only account into a privileged one.

## Restore policy: restored factors must not become trusted again

A historical backup can contain passkeys, authenticator seeds and recovery codes
that were revoked after the snapshot. Neither a restored counter nor a timestamp
can prove they are still authorized. Therefore `scripts/restore.sh` deliberately
removes all restored factors and recovery codes, rather than accepting them again.
This is destructive credential quarantine; there is no automatic unquarantine.
The account holder enrolls fresh credentials after independent operator review.

The restore helper:

1. Checks the archive header, stops app/worker and requires a successful safety
   backup before replacing the database.
2. Restores the archive, then applies the current migrations before cleanup.
3. In one transaction, increments every account's security version and marks
   **every restored administrator** as requiring operator-authorized MFA
   recovery, including administrators with no archived factors and regardless of
   the administrator-enforcement setting. A backup made before enrollment cannot
   reveal that MFA was enabled later, so allowing password-only access would be
   an unsafe downgrade. Ordinary accounts with restored factors, recovery codes
   or an existing recovery requirement are also marked. The marker is computed
   **before** credential deletion and recorded in the security audit.
4. Deletes all sessions, pending authentication, authenticator/WebAuthn challenge
   state, step-up proofs, TOTP credentials, passkeys, ordinary recovery codes,
   temporary operator grants, password-reset tokens, email-verification tokens
   and verification-mail requests. Queued/sending password-recovery and ordinary
   notification mail expire; their historical acceptance records remain.
5. Clears the restored SMTP connection-check status so the host must verify its
   own connection. It preserves provider settings and encrypted credentials.
6. Restarts app/worker only after migration and the full security cleanup succeed.
   Failure leaves them stopped. Never restart manually after failed cleanup until
   the cause is corrected and the entire cleanup transaction has succeeded.

Every restored administrator and every ordinary account with archived MFA state
is blocked from password-only login after restoration. A correct password alone
cannot remove the recovery marker, and there are no restored recovery codes left
to use. A server operator must review and verify each affected account, then
issue a short-lived grant using this runbook. Ordinary accounts without archived
MFA state retain their normal login policy. Account changes made after a backup
cannot be reconstructed from that backup; include them in the incident review.

### Restore rehearsal and acceptance

Use an isolated installation with outbound email and other integrations disabled
or pointed at approved test services. Restrict inbound traffic and use synthetic
accounts. Stop every app replica and external worker touching the database, not
only the two services in the supplied Compose project. Never restore a production
snapshot merely to test this feature without separate authorization and privacy
controls.

```sh
# Destructive: run only for an independently approved restore target.
sh scripts/restore.sh backups/cardshelf-YYYYMMDDTHHMMSSZ.dump --confirm-restore
```

Before reopening ordinary access, verify:

- No pre-restore session, password-reset/verification link, pending MFA request,
  challenge, recovery code or temporary operator grant works.
- A passkey revoked after the backup cannot return through the restored database.
  Likewise, an old TOTP secret cannot authenticate. The server retains neither.
- Every restored administrator and ordinary account with archived MFA state
  remains recovery-gated until reviewed, an operator grant is consumed and a
  fresh factor is verified. Test one synthetic administrator and one synthetic
  ordinary account using `--restored-account`.
- An administrator from a backup predating MFA remains recovery-gated even with
  no archived factors and `CARDSHELF_REQUIRE_ADMIN_MFA=false`. An ordinary account
  without archived MFA state retains its password-only access.
- Passwords, existing verified-email status, account ownership, collections,
  binders, memberships and billing history remain as expected from the backup.
- The site's hostname and TLS configuration are correct; newly registered
  passkeys are created for the intended relying-party ID.
- Provider connectivity is retested separately. Fresh verification/recovery
  emails are requested as needed; historical links and queued messages are not
  resent automatically.

Record the restore checkpoint and the reviewed accounts in the incident record.
Do not distribute a shared enrollment code or batch-clear recovery markers. Keep
unreviewed accounts recovery-gated even if this delays account access.

## Backup and encryption-key custody

`sh scripts/backup.sh` writes a full PostgreSQL archive; it does **not** include
`.env` or other host secrets. Keep an encrypted, access-controlled, off-server
copy of the matching `.env`, especially `CARDSHELF_INTEGRATION_KEY`, separately
from database backups. Inventory which key belongs to each backup without
recording the key in the inventory. Test retrieval through the authorized
operator process. Include separately managed Postal configuration/keys and
provider recovery procedures where applicable.

The database contains personal collection/account data, password hashes,
authenticator ciphertext and other sensitive integration/device credentials.
Recovery codes and operator grants are stored only as hashes; passkey records
contain public credentials rather than the authenticator's private key. These
properties do not make the database safe to share publicly. Restrict backups,
incident records, console access and any inspection output.

Losing or replacing the integration key does not decrypt old TOTP seeds or
provider secrets. Do not regenerate it as a troubleshooting step. Restore the
matching secured key if available. If it is permanently lost or compromised,
follow an approved key-rotation and provider-credential replacement procedure,
and use verified server recovery for affected MFA accounts. A database restore
still removes historical factors even when the matching encryption key exists;
key custody does not prove a restored factor remains authorized.

## Verification covered by this change

`node --test tests/account-security-operations.test.mjs` checks argument gates,
read-only defaults, account revalidation, transactional revocation, secret-free
audit parameters, hashed short-lived grants, restore ordering and fail-closed
service behavior. Database cases deliberately remain skipped during ordinary
unit tests, even when CI has already configured its disposable database.

After applying migrations, `npm run test:integration` includes
`tests/integration/account-security-operations.test.mjs`. That wrapper requires
`ALLOW_TEST_DATABASE=yes` and a PostgreSQL `DATABASE_URL` whose database name ends
in `_test`, then explicitly enables the real recovery and isolated restore tests.
To run the shared suite directly after migrations, also set
`CARDSHELF_SECURITY_DB_TESTS=yes`:

```sh
# DATABASE_URL must already identify the approved, migrated disposable _test DB.
ALLOW_TEST_DATABASE=yes CARDSHELF_SECURITY_DB_TESTS=yes \
  node --test tests/account-security-operations.test.mjs
```

These automated checks do not substitute for the isolated operator and
account-holder rehearsal above.
