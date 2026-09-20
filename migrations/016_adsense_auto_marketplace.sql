-- Opt-in only: preserve existing manual units, verification and disabled state.
-- No memberships, billing records, card data or existing grants are changed.
ALTER TABLE adsense_settings
  ADD COLUMN auto_ads_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN marketplace_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN marketplace_slot_id text NOT NULL DEFAULT ''
    CHECK (marketplace_slot_id = '' OR marketplace_slot_id ~ '^[0-9]{5,20}$');

-- The original unnamed check required a catalogue slot for every enabled mode.
-- Identify that exact three-column guard rather than guessing its generated name
-- or dropping unrelated publisher/verification/format constraints.
DO $$
DECLARE old_check text; matches integer;
BEGIN
  SELECT count(*), min(c.conname::text) INTO matches, old_check
  FROM pg_constraint c
  WHERE c.conrelid = 'adsense_settings'::regclass AND c.contype = 'c'
    AND (SELECT array_agg(a.attname::text ORDER BY a.attname::text)
         FROM pg_attribute a WHERE a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey))
        = ARRAY['enabled','publisher_id','slot_id']::text[]
    AND pg_get_constraintdef(c.oid) LIKE '%NOT enabled%';
  IF matches <> 1 THEN
    RAISE EXCEPTION 'Expected the original AdSense enabled/slot guard; review schema before migrating';
  END IF;
  EXECUTE format('ALTER TABLE adsense_settings DROP CONSTRAINT %I', old_check);
END;
$$;
ALTER TABLE adsense_settings
  ADD CONSTRAINT adsense_enabled_modes CHECK (NOT enabled OR (
    publisher_id <> '' AND (slot_id <> '' OR auto_ads_enabled OR
      (marketplace_enabled AND marketplace_slot_id <> '')))),
  ADD CONSTRAINT adsense_marketplace_slot CHECK (NOT marketplace_enabled OR marketplace_slot_id <> '');
