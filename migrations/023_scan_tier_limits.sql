-- Preserve every current allowance on upgrade. The previous global setting is
-- retained for old-client compatibility, but new scan reservations use the tier.
ALTER TABLE card_scan_settings
  ADD COLUMN free_monthly_limit integer NOT NULL DEFAULT 100 CHECK(free_monthly_limit BETWEEN 0 AND 10000),
  ADD COLUMN collector_monthly_limit integer NOT NULL DEFAULT 100 CHECK(collector_monthly_limit BETWEEN 0 AND 10000),
  ADD COLUMN plus_monthly_limit integer NOT NULL DEFAULT 100 CHECK(plus_monthly_limit BETWEEN 0 AND 10000),
  ADD COLUMN complimentary_monthly_limit integer NOT NULL DEFAULT 100 CHECK(complimentary_monthly_limit BETWEEN 0 AND 10000);
UPDATE card_scan_settings SET free_monthly_limit=user_monthly_limit,
  collector_monthly_limit=user_monthly_limit,plus_monthly_limit=user_monthly_limit,
  complimentary_monthly_limit=user_monthly_limit,revision=revision+1;
