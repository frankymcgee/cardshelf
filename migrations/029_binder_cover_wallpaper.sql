-- Outside covers keep their existing binders.color; interior appearance is unchanged.
ALTER TABLE binders ADD COLUMN cover_wallpaper_version text
  CHECK (cover_wallpaper_version IS NULL OR cover_wallpaper_version ~ '^[a-f0-9]{64}$');
CREATE TABLE binder_cover_wallpapers (
  binder_id uuid PRIMARY KEY REFERENCES binders(id) ON DELETE CASCADE,
  data bytea NOT NULL CHECK (octet_length(data) BETWEEN 1 AND 2000000),
  width integer NOT NULL CHECK (width BETWEEN 1 AND 2048),
  height integer NOT NULL CHECK (height BETWEEN 1 AND 2048),
  updated_at timestamptz NOT NULL DEFAULT now()
);
