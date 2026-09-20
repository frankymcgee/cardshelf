-- Opt-in automated arena. Legacy manual matches, collections and billing are retained unchanged.
CREATE TABLE arena_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  enabled boolean NOT NULL DEFAULT false,
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  updated_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE arena_decks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  title text NOT NULL CHECK(length(title) BETWEEN 1 AND 80),
  game text NOT NULL DEFAULT 'pokemon' CHECK(game='pokemon'),
  cards jsonb NOT NULL CHECK(jsonb_typeof(cards)='array' AND jsonb_array_length(cards)<=60),
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  request_id uuid NOT NULL,
  request_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,request_id)
);
CREATE INDEX arena_decks_owner ON arena_decks(user_id,updated_at DESC);
CREATE TABLE arena_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  guest_id uuid REFERENCES app_users(id) ON DELETE CASCADE,
  host_alias text NOT NULL CHECK(length(host_alias) BETWEEN 1 AND 40),
  guest_alias text CHECK(length(guest_alias) BETWEEN 1 AND 40),
  mode text NOT NULL CHECK(mode IN ('pvp','practice','tutorial')),
  engine_version text NOT NULL DEFAULT 'pokemon-core-v1',
  difficulty text NOT NULL DEFAULT 'normal' CHECK(difficulty IN ('easy','normal')),
  status text NOT NULL CHECK(status IN ('waiting','approval','ready','active','finished','cancelled')),
  host_deck jsonb NOT NULL,guest_deck jsonb,
  host_ready boolean NOT NULL DEFAULT false,guest_ready boolean NOT NULL DEFAULT false,
  invite_hash text UNIQUE,invite_expires_at timestamptz,
  state jsonb NOT NULL DEFAULT '{}' CHECK(octet_length(state::text)<=4000000),
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  request_id uuid NOT NULL,request_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK(guest_id IS NULL OR guest_id<>host_id),
  CHECK(mode='pvp' OR guest_id IS NULL),
  UNIQUE(host_id,request_id)
);
CREATE INDEX arena_match_host ON arena_matches(host_id,updated_at DESC);
CREATE INDEX arena_match_guest ON arena_matches(guest_id,updated_at DESC) WHERE guest_id IS NOT NULL;
CREATE TABLE arena_receipts (
  match_id uuid NOT NULL REFERENCES arena_matches(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,request_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(match_id,user_id,request_id),UNIQUE(user_id,request_id)
);
-- No automatic grants, advertising activation, data-provider downloads or subscription changes.
