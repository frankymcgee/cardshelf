-- Additive only: no user password, membership, subscription or sponsor is changed.
CREATE TABLE password_recovery_tokens (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  password_fingerprint text NOT NULL CHECK (password_fingerprint ~ '^[a-f0-9]{64}$'),
  requested_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz
);
CREATE INDEX password_recovery_user_idx ON password_recovery_tokens(user_id);
CREATE INDEX password_recovery_expiry_idx ON password_recovery_tokens(expires_at);

-- No reset token, password or SMTP credential is stored in this queue.
CREATE TABLE password_recovery_mail (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL CHECK (length(email) BETWEEN 3 AND 254),
  kind text NOT NULL CHECK (kind IN ('reset', 'changed', 'test')),
  requested_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  available_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '30 minutes',
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sending','sent','ignored','failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 3),
  lease_token text,
  lease_until timestamptz,
  last_error text NOT NULL DEFAULT '',
  finished_at timestamptz
);
CREATE INDEX password_recovery_mail_due_idx ON password_recovery_mail(status, available_at);

CREATE TABLE adsense_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  enabled boolean NOT NULL DEFAULT false,
  verification_enabled boolean NOT NULL DEFAULT false,
  publisher_id text NOT NULL DEFAULT '',
  slot_id text NOT NULL DEFAULT '',
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  CHECK (publisher_id = '' OR publisher_id ~ '^ca-pub-[0-9]{16}$'),
  CHECK (slot_id = '' OR slot_id ~ '^[0-9]{5,20}$'),
  CHECK (NOT enabled OR (publisher_id <> '' AND slot_id <> '')),
  CHECK (NOT verification_enabled OR publisher_id <> '')
);
