-- Never edit historical migrations or remove financial/account history.
-- An absent row preserves existing explicitly configured Stripe server defaults.
-- The first password-confirmed UI save establishes the shared runtime policy.
CREATE TABLE stripe_billing_controls (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  environment text NOT NULL CHECK (environment IN ('sandbox','production')),
  subscriptions_enabled boolean NOT NULL DEFAULT false,
  enforcement_enabled boolean NOT NULL DEFAULT false,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT enforcement_enabled OR environment = 'production')
);
-- Square tables remain historical/read-only. No grants, credentials, invoices,
-- commissions, collections or binder layouts are deleted or converted here.
