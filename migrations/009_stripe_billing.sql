-- Stripe is an additional platform-subscription provider. No marketplace settlement.
-- Existing Square subscriptions, account grants and referral payout history are preserved.
CREATE TABLE stripe_connections (
  environment text PRIMARY KEY CHECK(environment IN ('sandbox','production')),
  account_id text NOT NULL,
  account_name text NOT NULL DEFAULT '',
  api_secret text NOT NULL,
  webhook_secret text NOT NULL,
  portal_id text,
  accepting_new boolean NOT NULL DEFAULT false,
  revision integer NOT NULL DEFAULT 1,
  checked_at timestamptz,
  webhook_seen_at timestamptz,
  last_error text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE stripe_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  environment text NOT NULL REFERENCES stripe_connections(environment),
  price_id text NOT NULL,
  plan_code text NOT NULL CHECK(plan_code IN ('collector','plus')),
  cadence text NOT NULL CHECK(cadence IN ('MONTHLY','ANNUAL')),
  amount_minor integer NOT NULL CHECK(amount_minor BETWEEN 100 AND 10000000),
  total_minor integer NOT NULL CHECK(total_minor BETWEEN 100 AND 20000000),
  tax_minor integer NOT NULL CHECK(tax_minor BETWEEN 0 AND total_minor),
  tax_rate_id text,
  tax_bps integer NOT NULL DEFAULT 0 CHECK(tax_bps BETWEEN 0 AND 10000),
  tax_inclusive boolean NOT NULL DEFAULT false,
  terms text NOT NULL, terms_hash text NOT NULL,
  published boolean NOT NULL DEFAULT false,
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(environment,price_id)
);
CREATE UNIQUE INDEX stripe_one_published_offer ON stripe_offers(environment,plan_code,cadence) WHERE published;
CREATE TABLE stripe_customers (
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  environment text NOT NULL REFERENCES stripe_connections(environment),
  stripe_id text NOT NULL,
  PRIMARY KEY(user_id,environment), UNIQUE(environment,stripe_id)
);
-- Persist intent BEFORE calling the provider. Uncertain requests remain blocked until reconciled.
CREATE TABLE stripe_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  environment text NOT NULL REFERENCES stripe_connections(environment),
  request_id uuid NOT NULL,
  offer_id uuid NOT NULL REFERENCES stripe_offers(id),
  offer_snapshot jsonb NOT NULL,
  customer_id text, session_id text, stripe_id text,
  checkout_url text,
  checkout_expires_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  current boolean NOT NULL DEFAULT true,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  paid_through timestamptz,
  synced_at timestamptz,
  next_sync_at timestamptz NOT NULL DEFAULT now(),
  last_error text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,environment,request_id), UNIQUE(environment,session_id), UNIQUE(environment,stripe_id)
);
CREATE UNIQUE INDEX stripe_one_current_subscription ON stripe_subscriptions(user_id,environment) WHERE current;
CREATE INDEX stripe_sync_due ON stripe_subscriptions(next_sync_at);
CREATE TABLE stripe_invoices (
  environment text NOT NULL,
  stripe_id text NOT NULL,
  subscription_id uuid NOT NULL REFERENCES stripe_subscriptions(id),
  payment_intent_id text, charge_id text,
  status text NOT NULL,
  total_minor integer NOT NULL CHECK(total_minor>=0),
  tax_minor integer NOT NULL CHECK(tax_minor BETWEEN 0 AND total_minor),
  paid_minor integer NOT NULL CHECK(paid_minor>=0),
  refunded_minor integer NOT NULL CHECK(refunded_minor BETWEEN 0 AND paid_minor),
  settled boolean NOT NULL DEFAULT false,
  disputed boolean NOT NULL DEFAULT false,
  refund_pending boolean NOT NULL DEFAULT false,
  period_start timestamptz, period_end timestamptz, cycle_number integer,
  verified_at timestamptz NOT NULL DEFAULT now(), first_paid_at timestamptz,
  PRIMARY KEY(environment,stripe_id)
);
CREATE INDEX stripe_invoice_charge ON stripe_invoices(environment,charge_id);
CREATE TABLE stripe_webhook_events (
  environment text NOT NULL REFERENCES stripe_connections(environment),
  event_id text NOT NULL, event_type text NOT NULL,
  resource_id text NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','done','failed')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text NOT NULL DEFAULT '', received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(environment,event_id)
);
CREATE INDEX stripe_event_due ON stripe_webhook_events(status,next_attempt_at);
-- Provider-aware, shared commission ledger, retaining foreign keys to both invoice tables.
ALTER TABLE referral_commissions ADD COLUMN provider text NOT NULL DEFAULT 'square' CHECK(provider IN ('square','stripe'));
ALTER TABLE referral_commissions DROP CONSTRAINT referral_commissions_environment_invoice_id_fkey;
ALTER TABLE referral_commissions DROP CONSTRAINT referral_commissions_environment_invoice_id_key;
ALTER TABLE referral_commissions ADD COLUMN square_invoice_id text GENERATED ALWAYS AS (CASE WHEN provider='square' THEN invoice_id END) STORED;
ALTER TABLE referral_commissions ADD COLUMN stripe_invoice_id text GENERATED ALWAYS AS (CASE WHEN provider='stripe' THEN invoice_id END) STORED;
ALTER TABLE referral_commissions ADD FOREIGN KEY(environment,square_invoice_id) REFERENCES square_invoices(environment,square_id);
ALTER TABLE referral_commissions ADD FOREIGN KEY(environment,stripe_invoice_id) REFERENCES stripe_invoices(environment,stripe_id);
ALTER TABLE referral_commissions ADD UNIQUE(provider,environment,invoice_id);
