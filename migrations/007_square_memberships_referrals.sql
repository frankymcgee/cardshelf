-- Additive subscription/referral infrastructure. Existing testers keep their grants.
-- No marketplace payment/settlement fields and no card numbers or bank details.
CREATE TABLE account_tier_overrides (
  user_id uuid PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
  tier text NOT NULL CHECK (tier IN ('inherit','collector','plus','complimentary')),
  reason text NOT NULL,
  expires_at timestamptz,
  revision integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (tier <> 'complimentary' OR expires_at IS NULL)
);
CREATE TABLE subscription_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  environment text NOT NULL CHECK (environment IN ('sandbox','production')),
  plan_code text NOT NULL CHECK (plan_code IN ('collector','plus')),
  cadence text NOT NULL CHECK (cadence IN ('MONTHLY','ANNUAL')),
  variation_id text NOT NULL,
  amount_minor integer NOT NULL CHECK (amount_minor BETWEEN 100 AND 10000000),
  tax_bps integer NOT NULL DEFAULT 0 CHECK (tax_bps BETWEEN 0 AND 10000),
  terms text NOT NULL,
  terms_hash text NOT NULL,
  published boolean NOT NULL DEFAULT false,
  verified_at timestamptz,
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(environment,variation_id)
);
CREATE UNIQUE INDEX one_published_subscription_offer ON subscription_offers(environment,plan_code,cadence) WHERE published;
CREATE TABLE square_customers (
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  environment text NOT NULL,
  square_id text NOT NULL,
  PRIMARY KEY(user_id,environment), UNIQUE(environment,square_id)
);
CREATE TABLE square_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  environment text NOT NULL CHECK (environment IN ('sandbox','production')),
  offer_id uuid NOT NULL REFERENCES subscription_offers(id),
  request_id uuid NOT NULL,
  offer_snapshot jsonb NOT NULL,
  start_date text NOT NULL,
  square_id text,
  customer_id text,
  status text NOT NULL DEFAULT 'PENDING',
  current boolean NOT NULL DEFAULT true,
  canceled_date text,
  paid_through text,
  invoice_url text,
  last_error text NOT NULL DEFAULT '',
  synced_at timestamptz,
  next_sync_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,environment,request_id), UNIQUE(environment,square_id)
);
CREATE UNIQUE INDEX one_current_square_subscription ON square_subscriptions(user_id,environment) WHERE current;
CREATE INDEX square_subscription_sync ON square_subscriptions(next_sync_at);
CREATE TABLE square_invoices (
  environment text NOT NULL,
  square_id text NOT NULL,
  subscription_id uuid NOT NULL REFERENCES square_subscriptions(id),
  order_id text NOT NULL,
  status text NOT NULL,
  total_minor integer NOT NULL CHECK (total_minor >= 0),
  tax_minor integer NOT NULL CHECK (tax_minor >= 0),
  paid_minor integer NOT NULL CHECK (paid_minor >= 0),
  refunded_minor integer NOT NULL CHECK (refunded_minor >= 0),
  settled boolean NOT NULL DEFAULT false,
  disputed boolean NOT NULL DEFAULT false,
  refund_pending boolean NOT NULL DEFAULT false,
  period_end text,
  cycle_number integer,
  currency text NOT NULL DEFAULT 'AUD' CHECK (currency='AUD'),
  public_url text,
  verified_at timestamptz NOT NULL DEFAULT now(),
  first_paid_at timestamptz,
  PRIMARY KEY(environment,square_id)
);
CREATE TABLE square_invoice_payments (
  environment text NOT NULL,
  payment_id text NOT NULL,
  invoice_id text NOT NULL,
  PRIMARY KEY(environment,payment_id),
  FOREIGN KEY(environment,invoice_id) REFERENCES square_invoices(environment,square_id)
);
CREATE TABLE square_webhook_events (
  environment text NOT NULL,
  event_id text NOT NULL,
  event_type text NOT NULL,
  resource_id text,
  payment_id text,
  status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','done','failed')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text NOT NULL DEFAULT '',
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(environment,event_id)
);
CREATE INDEX square_webhook_queue ON square_webhook_events(status,next_attempt_at);
CREATE TABLE referral_partners (
  user_id uuid PRIMARY KEY REFERENCES app_users(id) ON DELETE RESTRICT,
  code text NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN ('approved','suspended')),
  reward_type text NOT NULL CHECK (reward_type IN ('percentage','fixed')),
  reward_value integer NOT NULL CHECK (reward_value BETWEEN 0 AND 1000000),
  max_payments integer NOT NULL DEFAULT 1 CHECK (max_payments BETWEEN 1 AND 120),
  hold_days integer NOT NULL DEFAULT 30 CHECK (hold_days BETWEEN 0 AND 180),
  terms text NOT NULL,
  revision integer NOT NULL DEFAULT 1,
  opted_in_revision integer,
  opted_in_at timestamptz,
  approved_at timestamptz NOT NULL DEFAULT now(),
  CHECK (reward_type <> 'percentage' OR reward_value <= 10000)
);
CREATE TABLE referral_attributions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referred_user_id uuid NOT NULL UNIQUE REFERENCES app_users(id) ON DELETE RESTRICT,
  partner_user_id uuid NOT NULL REFERENCES referral_partners(user_id),
  terms_snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(referred_user_id <> partner_user_id)
);
CREATE TABLE referral_commissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attribution_id uuid NOT NULL REFERENCES referral_attributions(id),
  environment text NOT NULL CHECK(environment='production'),
  invoice_id text NOT NULL,
  earned_minor integer NOT NULL CHECK(earned_minor>=0),
  paid_minor integer NOT NULL DEFAULT 0 CHECK(paid_minor>=0),
  eligible_at timestamptz NOT NULL,
  approved boolean NOT NULL DEFAULT false,
  blocked boolean NOT NULL DEFAULT false,
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(environment,invoice_id),
  FOREIGN KEY(environment,invoice_id) REFERENCES square_invoices(environment,square_id)
);
CREATE TABLE referral_payout_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  commission_id uuid NOT NULL REFERENCES referral_commissions(id),
  request_id uuid NOT NULL UNIQUE,
  amount_minor integer NOT NULL CHECK(amount_minor>0),
  external_reference text NOT NULL,
  recorded_by uuid NOT NULL REFERENCES app_users(id),
  recorded_at timestamptz NOT NULL DEFAULT now()
);
-- Payout records record operator-completed payments. They NEVER initiate transfers.
