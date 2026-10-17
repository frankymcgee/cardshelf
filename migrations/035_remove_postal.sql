-- Retire the old transport without changing an existing SMTP connection,
-- its encrypted password, verification revision, delivery history or suppressions.
-- An installation still selecting the retired provider must configure SMTP
-- explicitly; never silently start sending through a previously inactive account.
UPDATE email_settings SET provider='smtp',enabled=false,revision=revision+1,
  smtp_verified_at=NULL,smtp_verified_revision=NULL,dkim_selector='',dkim_public_key='',updated_at=now()
  WHERE provider<>'smtp';
ALTER TABLE email_settings ALTER COLUMN provider SET DEFAULT 'smtp';
ALTER TABLE email_settings DROP CONSTRAINT email_settings_provider_check;
ALTER TABLE email_settings ADD CONSTRAINT email_settings_provider_check CHECK(provider='smtp');
ALTER TABLE email_settings DROP COLUMN api_secret;
ALTER TABLE email_settings DROP COLUMN webhook_public_key;
DROP TABLE email_webhook_receipts;
-- Historical provider/source identifiers remain on delivery and suppression rows.
-- No historical accepted, failed, delivered or uncertain message is requeued.
