-- Scanning is opt-in. Photos and credentials never enter scan receipts or audit logs.
CREATE TABLE card_scan_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  enabled boolean NOT NULL DEFAULT false,
  api_secret text,
  monthly_budget_micros bigint NOT NULL DEFAULT 0 CHECK(monthly_budget_micros BETWEEN 0 AND 1000000000),
  user_monthly_limit integer NOT NULL DEFAULT 100 CHECK(user_monthly_limit BETWEEN 1 AND 10000),
  input_price_micros integer NOT NULL DEFAULT 400000 CHECK(input_price_micros BETWEEN 400000 AND 1000000000),
  output_price_micros integer NOT NULL DEFAULT 1600000 CHECK(output_price_micros BETWEEN 1600000 AND 1000000000),
  revision integer NOT NULL DEFAULT 1,
  updated_by uuid REFERENCES app_users ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO card_scan_settings(singleton) VALUES(true);
CREATE TABLE card_scans (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES app_users ON DELETE SET NULL,
  image_hash text NOT NULL CHECK(length(image_hash)=64),
  provider text NOT NULL DEFAULT 'openai',
  model text NOT NULL,
  status text NOT NULL CHECK(status IN ('processing','ready','failed','added','undone')),
  budget_month date NOT NULL,
  accounted_micros bigint NOT NULL CHECK(accounted_micros>=0),
  settled boolean NOT NULL DEFAULT false,
  input_price_micros integer NOT NULL,
  output_price_micros integer NOT NULL,
  input_tokens integer,
  output_tokens integer,
  duration_ms integer,
  observations jsonb,
  candidate_ids text[] NOT NULL DEFAULT '{}',
  error_code text NOT NULL DEFAULT '',
  confirmation_hash text,
  addition jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  added_at timestamptz,
  undone_at timestamptz,
  CHECK(observations IS NULL OR octet_length(observations::text)<=4096)
);
-- Keep accounting after account deletion; anonymous receipts cannot be read by users.
CREATE INDEX card_scans_month ON card_scans(budget_month);
CREATE INDEX card_scans_user_month ON card_scans(user_id,budget_month,created_at DESC);
CREATE INDEX card_scans_processing ON card_scans(created_at) WHERE status='processing';
-- Account deletion keeps only operational accounting, not a former member's
-- extracted text, image fingerprint or collection/binder receipt.
CREATE FUNCTION anonymize_deleted_card_scan() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.image_hash := repeat('0',64);
  NEW.observations := NULL;
  NEW.candidate_ids := '{}';
  NEW.confirmation_hash := NULL;
  NEW.addition := NULL;
  RETURN NEW;
END;
$$;
CREATE TRIGGER card_scans_deleted_account BEFORE UPDATE OF user_id ON card_scans
  FOR EACH ROW WHEN (OLD.user_id IS NOT NULL AND NEW.user_id IS NULL)
  EXECUTE FUNCTION anonymize_deleted_card_scan();
