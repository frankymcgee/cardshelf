-- Additive, opt-in assisted-table beta. No collection, membership or billing mutation.
CREATE TABLE battle_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  enabled boolean NOT NULL DEFAULT false,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE battle_access (
  user_id uuid PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
  granted_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE battle_decks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  game text NOT NULL CHECK (game IN ('pokemon')),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 80),
  cards jsonb NOT NULL CHECK (jsonb_typeof(cards)='array' AND jsonb_array_length(cards)<=60),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  create_request_id uuid NOT NULL,
  create_hash text NOT NULL CHECK (create_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id,create_request_id)
);
CREATE INDEX battle_decks_owner ON battle_decks(user_id,updated_at DESC);
CREATE TABLE battle_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  guest_id uuid REFERENCES app_users(id) ON DELETE CASCADE,
  game text NOT NULL CHECK (game IN ('pokemon')),
  adapter_version integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','approval','lobby','active','finished','cancelled')),
  host_alias text NOT NULL CHECK (length(host_alias) BETWEEN 1 AND 40),
  guest_alias text CHECK (length(guest_alias) BETWEEN 1 AND 40),
  host_deck jsonb NOT NULL,
  guest_deck jsonb,
  invite_hash text UNIQUE CHECK (invite_hash IS NULL OR invite_hash ~ '^[a-f0-9]{64}$'),
  invite_expires_at timestamptz NOT NULL DEFAULT now()+interval '24 hours',
  host_ready boolean NOT NULL DEFAULT false,
  guest_ready boolean NOT NULL DEFAULT false,
  state jsonb NOT NULL DEFAULT '{}' CHECK (octet_length(state::text)<=4000000),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  create_request_id uuid NOT NULL,
  create_hash text NOT NULL CHECK (create_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (guest_id IS NULL OR guest_id<>host_id),
  UNIQUE (host_id,create_request_id)
);
CREATE INDEX battle_matches_host ON battle_matches(host_id,updated_at DESC);
CREATE INDEX battle_matches_guest ON battle_matches(guest_id,updated_at DESC) WHERE guest_id IS NOT NULL;
-- Receipts retain intent hashes, never a response containing hidden cards or invitation codes.
CREATE TABLE battle_requests (
  match_id uuid NOT NULL REFERENCES battle_matches(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  PRIMARY KEY (match_id,user_id,request_id),
  UNIQUE (user_id,request_id)
);
