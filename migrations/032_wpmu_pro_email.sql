-- Add a separate Pro preset without touching saved connection identities,
-- encrypted credentials, verification evidence, queued mail or delivery history.
ALTER TABLE email_settings DROP CONSTRAINT email_settings_smtp_preset_check;
ALTER TABLE email_settings ADD CONSTRAINT email_settings_smtp_preset_check
  CHECK(smtp_preset IN ('custom','wpmu','wpmu_pro'));
