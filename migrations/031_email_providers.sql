-- Preserve Postal credentials and historical deliveries. A provider change is
-- explicit; no failed or accepted message falls back to a different transport.
ALTER TABLE email_settings ADD COLUMN provider text NOT NULL DEFAULT 'postal' CHECK(provider IN ('postal','smtp'));
ALTER TABLE email_settings ADD COLUMN smtp_preset text NOT NULL DEFAULT 'custom' CHECK(smtp_preset IN ('custom','wpmu'));
ALTER TABLE email_settings ADD COLUMN smtp_host text NOT NULL DEFAULT '' CHECK(length(smtp_host)<=253);
ALTER TABLE email_settings ADD COLUMN smtp_port integer NOT NULL DEFAULT 587 CHECK(smtp_port IN (465,587));
ALTER TABLE email_settings ADD COLUMN smtp_security text NOT NULL DEFAULT 'starttls' CHECK(smtp_security IN ('starttls','tls'));
ALTER TABLE email_settings ADD CONSTRAINT email_settings_smtp_tls_port CHECK((smtp_port=465 AND smtp_security='tls') OR (smtp_port=587 AND smtp_security='starttls'));
ALTER TABLE email_settings ADD COLUMN smtp_user text NOT NULL DEFAULT '' CHECK(length(smtp_user)<=320);
ALTER TABLE email_settings ADD COLUMN smtp_secret text;
ALTER TABLE email_settings ADD COLUMN smtp_rate_limit integer NOT NULL DEFAULT 10 CHECK(smtp_rate_limit BETWEEN 1 AND 60);
ALTER TABLE email_settings ADD COLUMN smtp_verified_at timestamptz;
ALTER TABLE email_settings ADD COLUMN smtp_verified_revision integer;
CREATE TABLE email_dispatch_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  last_queue text CHECK(last_queue IN ('notification','recovery')),
  next_send_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE email_outbox ADD COLUMN dispatch_started_at timestamptz;
ALTER TABLE password_recovery_mail ADD COLUMN dispatch_started_at timestamptz;
-- An upgrade cannot know whether an already sending job reached the provider.
UPDATE email_outbox SET dispatch_started_at=created_at WHERE status='sending';
UPDATE password_recovery_mail SET dispatch_started_at=created_at WHERE status='sending';
ALTER TABLE email_outbox DROP CONSTRAINT email_outbox_status_check;
ALTER TABLE email_outbox ADD CONSTRAINT email_outbox_status_check CHECK(status IN ('queued','sending','accepted','delivered','failed','suppressed','expired','bounced','uncertain'));
ALTER TABLE password_recovery_mail DROP CONSTRAINT password_recovery_mail_status_check;
ALTER TABLE password_recovery_mail ADD CONSTRAINT password_recovery_mail_status_check CHECK(status IN ('queued','sending','sent','ignored','failed','accepted','delivered','suppressed','expired','bounced','uncertain'));
-- Older workers did not distinguish rejection from a lost acknowledgment.
-- Hold their attempted, unaccepted jobs too. A known provider failure retains
-- its identifiers/history and is already ineligible for application retries.
UPDATE email_outbox SET status='uncertain',dispatch_started_at=coalesce(dispatch_started_at,updated_at),
  last_error='DELIVERY_UNCERTAIN',finished_at=now(),lease_token=NULL,lease_until=NULL
  WHERE status='sending' OR status IN ('queued','failed') AND attempts>0 AND accepted_at IS NULL AND provider_id IS NULL;
UPDATE password_recovery_mail SET status='uncertain',dispatch_started_at=coalesce(dispatch_started_at,created_at),
  last_error='DELIVERY_UNCERTAIN',finished_at=now(),lease_token=NULL,lease_until=NULL
  WHERE status='sending' OR status IN ('queued','failed') AND attempts>0 AND accepted_at IS NULL AND provider_id IS NULL;
