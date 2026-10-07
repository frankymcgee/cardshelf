-- Preserve the selected Google configuration and all eligibility rules on upgrade.
ALTER TABLE adsense_settings
  ADD COLUMN provider text NOT NULL DEFAULT 'adsense' CHECK (provider IN ('adsense','adsterra')),
  ADD COLUMN adsterra_units jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(adsterra_units) = 'object');

ALTER TABLE adsense_settings DROP CONSTRAINT adsense_enabled_modes;
ALTER TABLE adsense_settings ADD CONSTRAINT adsense_enabled_modes CHECK (NOT enabled OR (
  (provider = 'adsense' AND publisher_id <> '' AND (slot_id <> '' OR auto_ads_enabled OR
    (marketplace_enabled AND marketplace_slot_id <> '')))
  OR (provider = 'adsterra' AND adsterra_units <> '{}'::jsonb)
));
