-- Subscription preparation ONLY. This migration does not enforce a paywall,
-- change passwords/sessions/roles, or alter collection/binder data.
LOCK TABLE app_users IN SHARE ROW EXCLUSIVE MODE;
CREATE TABLE membership_plans (
  code text PRIMARY KEY CHECK (code IN ('testing','collector','plus')),
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  currency text NOT NULL DEFAULT 'AUD' CHECK (currency = 'AUD'),
  monthly_price_minor integer CHECK (monthly_price_minor BETWEEN 0 AND 10000000),
  annual_price_minor integer CHECK (annual_price_minor BETWEEN 0 AND 100000000),
  state text NOT NULL DEFAULT 'draft' CHECK (state IN ('testing','draft')),
  revision integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO membership_plans(code,name,description,state) VALUES
 ('testing','Testing access','All current features. No billing or automatic expiry.','testing'),
 ('collector','Collector','Unpublished subscription draft. Pricing has not been decided.','draft'),
 ('plus','Collector Plus','Unpublished subscription draft. Pricing has not been decided.','draft');
CREATE TABLE account_memberships (
  user_id uuid PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
  plan_code text NOT NULL DEFAULT 'testing' REFERENCES membership_plans(code),
  subscription_status text NOT NULL DEFAULT 'none'
    CHECK (subscription_status IN ('none','trialing','active','past_due','paused','canceled')),
  provider text NOT NULL DEFAULT 'none',
  provider_customer_id text,
  provider_subscription_id text,
  current_period_end timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX membership_external_subscription ON account_memberships(provider,provider_subscription_id)
  WHERE provider_subscription_id IS NOT NULL;
CREATE TABLE account_access_grants (
  user_id uuid PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('legacy_tester','beta_tester')),
  granted_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  CHECK (expires_at IS NULL) -- Testing grants cannot silently become expiring trials.
);
INSERT INTO account_memberships(user_id) SELECT id FROM app_users;
INSERT INTO account_access_grants(user_id,kind) SELECT id,'legacy_tester' FROM app_users;
-- Also cover existing setup/admin user-creation paths, without changing login code.
CREATE FUNCTION cardshelf_grant_testing_access() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO account_memberships(user_id) VALUES(NEW.id) ON CONFLICT(user_id) DO NOTHING;
  INSERT INTO account_access_grants(user_id,kind) VALUES(NEW.id,'beta_tester') ON CONFLICT(user_id) DO NOTHING;
  RETURN NEW;
END;
$$;
CREATE TRIGGER app_users_testing_membership AFTER INSERT ON app_users
  FOR EACH ROW EXECUTE FUNCTION cardshelf_grant_testing_access();
CREATE TABLE platform_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  name text NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('early_access','support','privacy')),
  message text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','contacted','archived')),
  consent_version text NOT NULL DEFAULT 'request-v1',
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(email,purpose)
);
CREATE INDEX platform_requests_queue ON platform_requests(status,created_at DESC);
