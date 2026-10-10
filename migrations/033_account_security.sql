-- Existing accounts/sessions keep password-only access until explicit rollout.
ALTER TABLE app_users ADD COLUMN security_version bigint NOT NULL DEFAULT 0;
ALTER TABLE app_users ADD COLUMN mfa_reset_required boolean NOT NULL DEFAULT false;
ALTER TABLE sessions ADD COLUMN security_version bigint NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN auth_strength text NOT NULL DEFAULT 'password' CHECK (auth_strength IN ('password','mfa'));
ALTER TABLE sessions ADD COLUMN strong_authenticated_at timestamptz;
-- Pending sign-in cancellation also revokes a session that won the completion
-- race. Keep only hashed ancestry and bound that capability to its original TTL.
ALTER TABLE sessions ADD COLUMN pending_auth_hashes text[] NOT NULL DEFAULT '{}' CHECK(cardinality(pending_auth_hashes)<=2);
ALTER TABLE sessions ADD COLUMN pending_auth_expires_at timestamptz;
ALTER TABLE sessions ADD CONSTRAINT sessions_pending_auth_expiry CHECK((cardinality(pending_auth_hashes)=0)=(pending_auth_expires_at IS NULL));
CREATE INDEX sessions_pending_auth ON sessions USING gin(pending_auth_hashes);
CREATE TABLE account_totp_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES app_users ON DELETE CASCADE,
  label text NOT NULL, secret_ciphertext text NOT NULL, last_used_step bigint NOT NULL DEFAULT -1,
  created_at timestamptz NOT NULL DEFAULT now(), last_used_at timestamptz
);
CREATE INDEX account_totp_user ON account_totp_credentials(user_id);
CREATE TABLE account_passkeys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES app_users ON DELETE CASCADE,
  credential_id text NOT NULL UNIQUE, public_key bytea NOT NULL, counter bigint NOT NULL DEFAULT 0 CHECK(counter>=0),
  transports text[] NOT NULL DEFAULT '{}', device_type text NOT NULL, backed_up boolean NOT NULL DEFAULT false,
  label text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), last_used_at timestamptz
);
CREATE INDEX account_passkeys_user ON account_passkeys(user_id);
CREATE TABLE account_recovery_codes (
  code_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES app_users ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz, used_at timestamptz
);
CREATE INDEX account_recovery_codes_user ON account_recovery_codes(user_id);
CREATE TABLE account_pending_auth (
  token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES app_users ON DELETE CASCADE,
  security_version bigint NOT NULL, scope text NOT NULL CHECK(scope IN ('mfa','enrollment')),
  recovery_mode boolean NOT NULL DEFAULT false, password_verified_at timestamptz NOT NULL DEFAULT now(),
  pending_auth_hashes text[] NOT NULL DEFAULT '{}' CHECK(cardinality(pending_auth_hashes)<=2),
  attempts integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL
);
CREATE INDEX account_pending_auth_user ON account_pending_auth(user_id);
CREATE INDEX account_pending_auth_expiry ON account_pending_auth(expires_at);
CREATE INDEX account_pending_auth_ancestry ON account_pending_auth USING gin(pending_auth_hashes);
CREATE TABLE account_security_challenges (
  token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES app_users ON DELETE CASCADE,
  context_hash text NOT NULL, security_version bigint NOT NULL,
  kind text NOT NULL CHECK(kind IN ('totp-enroll','passkey-register','passkey-login','passkey-reauth')),
  challenge text, payload jsonb NOT NULL DEFAULT '{}', attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL
);
CREATE INDEX account_security_challenges_user ON account_security_challenges(user_id);
CREATE INDEX account_security_challenges_expiry ON account_security_challenges(expires_at);
CREATE TABLE account_security_proofs (
  token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES app_users ON DELETE CASCADE,
  session_hash text NOT NULL REFERENCES sessions(token_hash) ON DELETE CASCADE,
  security_version bigint NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL
);
CREATE INDEX account_security_proofs_user ON account_security_proofs(user_id);
