-- Postal and notifications are opt-in. Existing SMTP recovery remains usable
-- until an administrator first saves Postal settings.
CREATE TABLE email_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  enabled boolean NOT NULL DEFAULT false,
  sender_name text NOT NULL DEFAULT 'CardShelf' CHECK(length(sender_name) BETWEEN 1 AND 80),
  from_address text NOT NULL DEFAULT 'noreply@cardshelf.cloud',
  reply_to text NOT NULL DEFAULT '',
  api_secret text,
  dkim_selector text NOT NULL DEFAULT '',
  dkim_public_key text NOT NULL DEFAULT '',
  webhook_public_key text NOT NULL DEFAULT '',
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  updated_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE email_preferences (
  user_id uuid PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
  marketplace boolean NOT NULL DEFAULT false,
  membership boolean NOT NULL DEFAULT false,
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE email_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key text NOT NULL UNIQUE CHECK(length(event_key) BETWEEN 1 AND 240),
  kind text NOT NULL CHECK(kind IN ('password_changed','marketplace_enquiry','marketplace_reply','membership_changed','test')),
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  payload jsonb NOT NULL DEFAULT '{}' CHECK(octet_length(payload::text)<=4000),
  status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','sending','accepted','delivered','failed','suppressed','expired','bounced')),
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 10),
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_token text,
  lease_until timestamptz,
  expires_at timestamptz NOT NULL DEFAULT now()+interval '1 day',
  provider text CHECK(provider IN ('postal','smtp')),
  provider_id text,
  message_id text,
  recipient_hash text,
  last_error text NOT NULL DEFAULT '',
  sent_with_ssl boolean,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  delivered_at timestamptz,
  finished_at timestamptz,
  event_at timestamptz
);
CREATE INDEX email_outbox_due_idx ON email_outbox(status,available_at);
CREATE INDEX email_outbox_provider_idx ON email_outbox(provider_id) WHERE provider_id IS NOT NULL;
CREATE TABLE email_suppressions (
  email text PRIMARY KEY CHECK(length(email) BETWEEN 3 AND 254),
  reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 100),
  source text NOT NULL CHECK(source IN ('manual','postal')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES app_users(id) ON DELETE SET NULL
);
CREATE TABLE email_webhook_receipts (
  event_key text PRIMARY KEY,
  provider_id text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE password_recovery_mail ADD COLUMN provider text CHECK(provider IN ('postal','smtp'));
ALTER TABLE password_recovery_mail ADD COLUMN provider_id text;
ALTER TABLE password_recovery_mail ADD COLUMN message_id text;
ALTER TABLE password_recovery_mail ADD COLUMN recipient_hash text;
ALTER TABLE password_recovery_mail ADD COLUMN accepted_at timestamptz;
ALTER TABLE password_recovery_mail ADD COLUMN delivered_at timestamptz;
ALTER TABLE password_recovery_mail ADD COLUMN event_at timestamptz;
ALTER TABLE password_recovery_mail ADD COLUMN sent_with_ssl boolean;
ALTER TABLE password_recovery_mail DROP CONSTRAINT password_recovery_mail_status_check;
ALTER TABLE password_recovery_mail ADD CONSTRAINT password_recovery_mail_status_check CHECK(status IN ('queued','sending','sent','ignored','failed','accepted','delivered','suppressed','expired','bounced'));
CREATE INDEX password_recovery_provider_idx ON password_recovery_mail(provider_id) WHERE provider_id IS NOT NULL;
