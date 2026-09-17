-- Opt-in, read-only provider sync. No changes to users, grants or subscription snapshots.
CREATE TABLE stripe_product_sync (
  environment text PRIMARY KEY REFERENCES stripe_connections(environment),
  managed boolean NOT NULL DEFAULT false,
  daily boolean NOT NULL DEFAULT false,
  mirror_plans boolean NOT NULL DEFAULT false,
  revision integer NOT NULL DEFAULT 1,
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  next_sync_at timestamptz,
  last_error text NOT NULL DEFAULT '',
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT mirror_plans OR environment = 'production')
);
CREATE TABLE stripe_products (
  environment text NOT NULL REFERENCES stripe_connections(environment),
  plan_code text NOT NULL CHECK (plan_code IN ('collector','plus')),
  product_id text NOT NULL,
  presentation jsonb NOT NULL,
  active boolean NOT NULL DEFAULT true,
  synced_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(environment,plan_code),
  UNIQUE(environment,product_id)
);
ALTER TABLE stripe_offers
  ADD COLUMN product_id text,
  ADD COLUMN product_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN sync_managed boolean NOT NULL DEFAULT false,
  ADD COLUMN sync_hash text,
  ADD COLUMN tax_mode text NOT NULL DEFAULT 'fixed' CHECK(tax_mode IN ('automatic','fixed','none')),
  ADD COLUMN tax_behavior text NOT NULL DEFAULT 'unspecified' CHECK(tax_behavior IN ('inclusive','exclusive','unspecified'));
ALTER TABLE membership_plans
  ADD COLUMN stripe_managed boolean NOT NULL DEFAULT false,
  ADD COLUMN stripe_product jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN stripe_synced_at timestamptz;
