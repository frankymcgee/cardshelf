-- Keys survive image upgrades and are included in normal database backups.
-- Never expose the private key or subscription credentials in API responses.
CREATE TABLE push_identity (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  public_key text NOT NULL,
  private_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  session_hash text NOT NULL REFERENCES sessions(token_hash) ON DELETE CASCADE,
  endpoint text NOT NULL UNIQUE CHECK(length(endpoint) BETWEEN 1 AND 2048),
  p256dh text NOT NULL,
  auth text NOT NULL,
  marketplace boolean NOT NULL DEFAULT true,
  membership boolean NOT NULL DEFAULT true,
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX push_subscriptions_user ON push_subscriptions(user_id);
CREATE INDEX push_subscriptions_session ON push_subscriptions(session_hash);
CREATE TABLE push_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key text NOT NULL CHECK(length(event_key) BETWEEN 1 AND 200),
  subscription_id uuid NOT NULL REFERENCES push_subscriptions(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK(kind IN ('marketplace_enquiry','marketplace_reply','membership_changed','test')),
  payload jsonb NOT NULL DEFAULT '{}' CHECK(octet_length(payload::text)<=1000),
  status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','sending','accepted','failed','suppressed','expired')),
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),
  available_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now()+interval '1 hour',
  lease_token text,
  lease_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  UNIQUE(event_key,subscription_id)
);
CREATE INDEX push_outbox_due ON push_outbox(status,available_at);
