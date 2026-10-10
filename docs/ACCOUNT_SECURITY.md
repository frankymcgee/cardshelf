# Account security

This change adds email verification, TOTP authenticator apps, passkeys/FIDO2
security keys (including compatible YubiKeys), and an administrator recovery path.
Deployment and operator recovery instructions are in
[Account security operations](ACCOUNT_SECURITY_OPERATIONS.md).

## Member flows

- New Free, invited and subscription-ready accounts must verify their email before
  receiving any private session. A verification email contains a short-lived link
  with the token in its fragment. Opening the page is not enough: enter the account
  password and submit. Resends return the same response for every address.
- Existing accounts retain their access with an explicit legacy exemption. Their
  addresses are not marked verified. The initial bootstrap-token administrator
  can configure outgoing mail before verifying the address.
- Open **Your account → Account security** to enroll an authenticator or passkey.
  Setup is incomplete until a valid code or signed WebAuthn response is verified.
  Adding any factor makes MFA mandatory for future sign-ins, including while the
  administrator rollout switch is off.
- Add a spare authenticator or security key separately. CardShelf supports up to
  five authenticator apps and ten passkeys. FIDO2 keys require device/PIN user
  verification; OTP-only hardware keys are not supported as passkeys.
- Save the ten one-use recovery codes offline when shown. Only their account-bound
  hashes are stored. Replacing the codes invalidates all previous codes.
- After a password, complete TOTP or passkey sign-in. If factors are lost, use the
  password and an unused recovery code. This opens only the enrollment screen;
  private data and administrator actions remain inaccessible until a new factor
  is verified. The new enrollment retires all old factors and recovery codes.
- Changing or removing factors requires the password plus proof of an existing
  factor. Add a replacement before removing the last factor. Sensitive
  administrator mutations and password changes by MFA users require recent
  strong authentication. Open Account security to verify again, then explicitly
  retry the intended action.

## Server guarantees

Session and pending-login tokens are distinct, random, hashed at rest and sent
only through SameSite Strict, HttpOnly cookies (Secure on HTTPS). Pending login
expires after ten minutes; enrollment/WebAuthn challenges expire after five.
Every private API resolves the full-session assurance check. Pending authentication
cannot act as a full session even if its token is placed in the session cookie.
Background push delivery checks the same account revision and factor requirements.

Cancelling a pending sign-in serializes with factor completion and revokes that
flow's descendant pending tokens or sessions, even if completion wins the race.
Only hashed ancestry is retained, and cancellation authority ends with the
original ten-minute pending window; recovery transitions cannot extend it. Unrelated sessions are not revoked by
cancellation. This bounded pending-flow guarantee is not an account-wide or
long-lived session-family logout guarantee for subsequent full-session rotations.

Security transitions serialize through the account row lock. Password changes,
password recovery, verification, recovery and factor changes invalidate sessions
and pending authentication as appropriate. Password reset never removes MFA or
creates an authenticated session. A session created by a password change retains
its original assurance and last strong-authentication time.

TOTP secrets use AES-256-GCM encryption with the existing integration encryption
key and account/credential-specific authenticated context. Successful time steps
cannot be reused. WebAuthn validates a one-use server challenge, exact configured
origin and hostname RP ID, user presence/verification, signature and counter.
Zero counters are supported for authenticators that do not implement counters;
nonzero counters must advance. Registration requests no identifying attestation.
Recovery codes and temporary operator grants are hashed, bounded and single-use.
Security audit entries never contain seeds, passwords, bearer links or raw codes.

The existing Postal/SMTP transport delivers verification mail. The queue stores no
plaintext verification link or token. A possibly accepted send is held as
uncertain rather than resent automatically. Existing notification and password
recovery queues share provider pacing with verification mail.

## Rollout and acceptance

Administrator enforcement is opt-in with CARDSHELF_REQUIRE_ADMIN_MFA=true. First
verify mail delivery, enroll two independent factors, save codes, and rehearse
recovery in an isolated environment. The switch is not changed by installing this
branch. Existing accounts, collections and membership grants are preserved.

Automated coverage uses disposable PostgreSQL and genuine software-generated
ES256 WebAuthn signatures. It checks incorrect origin/RP/challenge/UV/signature,
TOTP replay, cookie/API assurance boundaries, concurrent token and recovery-code
use, password reset/change, mail delivery handling and restored-backup cleanup.
These tests do not certify physical YubiKeys, platform passkey dialogs, cross-device
passkeys or delivery to a real mailbox. Perform those acceptance checks on the
actual HTTPS hostname before enforcing administrator MFA.

Restoring an old backup invalidates all restored authentication state and recovery
codes. Restored factors are removed. Every restored administrator and every non-admin
recorded as MFA-protected requires operator-authorized recovery. Review previously revoked credentials and restore
history before re-enrollment. See the operations guide before any restore.
