-- Admin-managed OAuth credentials. Tokens are AES-GCM encrypted by the app;
-- the encryption key is a server secret, never part of a database backup.
CREATE TABLE square_connections (
  environment text PRIMARY KEY CHECK (environment IN ('sandbox','production')),
  source text NOT NULL DEFAULT 'environment' CHECK (source IN ('environment','oauth','disconnected')),
  application_id text NOT NULL,
  application_secret text NOT NULL,
  access_secret text,
  refresh_secret text,
  webhook_secret text,
  merchant_id text,
  merchant_name text NOT NULL DEFAULT '',
  location_id text,
  location_name text NOT NULL DEFAULT '',
  timezone text,
  scopes text[] NOT NULL DEFAULT '{}',
  expires_at timestamptz,
  refreshed_at timestamptz,
  connected_at timestamptz,
  refresh_retry_at timestamptz,
  checked_at timestamptz,
  webhook_seen_at timestamptz,
  last_error text NOT NULL DEFAULT '',
  revision integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE square_oauth_states (
  state_hash text PRIMARY KEY CHECK (length(state_hash)=64),
  environment text NOT NULL REFERENCES square_connections(environment),
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  session_hash text NOT NULL,
  connection_revision integer NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);
CREATE INDEX square_oauth_state_expiry ON square_oauth_states(expires_at);
-- No grants, subscriptions, offers or marketplace records are modified.
