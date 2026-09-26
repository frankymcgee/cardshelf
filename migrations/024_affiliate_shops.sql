CREATE TABLE affiliate_shop_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  enabled boolean NOT NULL DEFAULT false,
  shops jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(shops) = 'array' AND jsonb_array_length(shops) <= 12),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO affiliate_shop_settings(singleton) VALUES (true);
