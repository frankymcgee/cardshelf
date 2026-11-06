CREATE TABLE wishlist_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  printing_id uuid NOT NULL REFERENCES printings(id),
  target_aud_minor integer NOT NULL CHECK(target_aud_minor BETWEEN 1 AND 100000000),
  watch_market boolean NOT NULL DEFAULT true,
  watch_listings boolean NOT NULL DEFAULT true,
  conditions text[] NOT NULL DEFAULT ARRAY['NM'],
  enabled boolean NOT NULL DEFAULT true,
  revision integer NOT NULL DEFAULT 1,
  checked_at timestamptz,
  market_matched boolean NOT NULL DEFAULT false,
  market_cycle integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,printing_id),
  CHECK(cardinality(conditions) BETWEEN 1 AND 6 AND conditions <@ ARRAY['NM','LP','MP','HP','DMG','UNKNOWN']::text[]),
  CHECK(watch_market OR watch_listings)
);
CREATE INDEX wishlist_alert_due_idx ON wishlist_alerts(checked_at NULLS FIRST,id) WHERE enabled;
CREATE TABLE wishlist_alert_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  alert_id uuid NOT NULL REFERENCES wishlist_alerts(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK(kind IN ('market','listing')),
  amount_aud_minor integer NOT NULL CHECK(amount_aud_minor>0),
  target_aud_minor integer NOT NULL CHECK(target_aud_minor>0),
  listing_id uuid REFERENCES marketplace_listings(id) ON DELETE SET NULL,
  event_key text NOT NULL UNIQUE,
  seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX wishlist_alert_inbox_idx ON wishlist_alert_events(user_id,created_at DESC,id);
