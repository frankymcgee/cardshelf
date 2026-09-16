-- Additive appearance state. Existing binders keep their cover colour and layouts.
ALTER TABLE binders ADD COLUMN appearance jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(appearance) = 'object');
ALTER TABLE binders ADD COLUMN wallpaper_version text CHECK (wallpaper_version IS NULL OR wallpaper_version ~ '^[a-f0-9]{64}$');
CREATE TABLE binder_wallpapers (
  binder_id uuid PRIMARY KEY REFERENCES binders(id) ON DELETE CASCADE,
  data bytea NOT NULL CHECK (octet_length(data) BETWEEN 1 AND 2000000),
  width integer NOT NULL CHECK (width BETWEEN 1 AND 2048),
  height integer NOT NULL CHECK (height BETWEEN 1 AND 2048),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- The normal database backup now includes wallpapers; no new storage volume is needed.
