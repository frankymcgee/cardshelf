-- Preserve existing access without claiming that a mailbox was verified.
-- Legacy/manual imports remain explicitly grandfathered. Every application
-- account-creation path sets required=true and grandfathered_at=NULL.
ALTER TABLE app_users ADD COLUMN email_verified_at timestamptz;
ALTER TABLE app_users ADD COLUMN email_verification_required boolean NOT NULL DEFAULT false;
ALTER TABLE app_users ADD COLUMN email_verification_grandfathered_at timestamptz DEFAULT now();

CREATE TABLE email_verification_tokens (
  token_hash text PRIMARY KEY CHECK(token_hash ~ '^[a-f0-9]{64}$'),
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  email text NOT NULL CHECK(length(email) BETWEEN 3 AND 254),
  password_fingerprint text NOT NULL CHECK(password_fingerprint ~ '^[a-f0-9]{64}$'),
  security_version bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz
);
CREATE INDEX email_verification_user_idx ON email_verification_tokens(user_id);
CREATE INDEX email_verification_expiry_idx ON email_verification_tokens(expires_at);

-- The worker generates a secret only in memory just before dispatch. No token,
-- URL, password, message body or provider credential is persisted in this queue.
CREATE TABLE email_verification_mail (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES app_users(id) ON DELETE CASCADE,
  email text NOT NULL CHECK(length(email) BETWEEN 3 AND 254),
  created_at timestamptz NOT NULL DEFAULT now(),
  available_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now()+interval '1 day',
  status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','sending','sent','ignored','failed','accepted','delivered','suppressed','expired','bounced','uncertain')),
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),
  lease_token text,
  lease_until timestamptz,
  last_error text NOT NULL DEFAULT '',
  provider text CHECK(provider IN ('postal','smtp')),
  provider_id text,
  message_id text,
  recipient_hash text,
  dispatch_started_at timestamptz,
  accepted_at timestamptz,
  delivered_at timestamptz,
  event_at timestamptz,
  sent_with_ssl boolean,
  finished_at timestamptz
);
CREATE INDEX email_verification_mail_due_idx ON email_verification_mail(status,available_at);
CREATE INDEX email_verification_mail_user_idx ON email_verification_mail(user_id);
CREATE INDEX email_verification_provider_idx ON email_verification_mail(provider_id) WHERE provider_id IS NOT NULL;
ALTER TABLE email_dispatch_state DROP CONSTRAINT email_dispatch_state_last_queue_check;
ALTER TABLE email_dispatch_state ADD CONSTRAINT email_dispatch_state_last_queue_check CHECK(last_queue IN ('notification','recovery','verification'));
