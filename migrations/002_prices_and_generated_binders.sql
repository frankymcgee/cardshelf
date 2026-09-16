-- Additive migration: existing collections and binder layouts are not changed.
ALTER TABLE jobs DROP CONSTRAINT jobs_kind_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_kind_check CHECK (kind IN ('import-set','refresh-prices'));
CREATE TABLE card_price_cache (
  card_id text PRIMARY KEY REFERENCES cards ON DELETE CASCADE,
  quotes jsonb NOT NULL DEFAULT '[]', reference_prices jsonb NOT NULL DEFAULT '[]',
  fetched_at timestamptz, attempted_at timestamptz,
  next_attempt_at timestamptz NOT NULL DEFAULT now(), last_error text NOT NULL DEFAULT ''
);
CREATE TABLE card_price_history (
  card_id text NOT NULL REFERENCES cards ON DELETE CASCADE,
  source text NOT NULL, variant text NOT NULL, currency text NOT NULL,
  metric text NOT NULL, amount numeric(18,6) NOT NULL CHECK (amount > 0),
  source_updated_at timestamptz NOT NULL, observed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(card_id,source,variant,currency,metric,source_updated_at)
);
CREATE INDEX price_history_card_date ON card_price_history(card_id,source_updated_at DESC);
CREATE TABLE price_fx_rates (
  currency text PRIMARY KEY CHECK (currency IN ('USD','EUR')),
  aud_rate numeric(18,8) NOT NULL CHECK (aud_rate > 0), rate_date date NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE binders ADD COLUMN generation jsonb;
CREATE TABLE binder_generation_requests (
  user_id uuid NOT NULL REFERENCES app_users ON DELETE CASCADE,
  request_id uuid NOT NULL, input_hash text NOT NULL, binder_ids uuid[] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,request_id)
);
