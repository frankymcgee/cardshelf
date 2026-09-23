CREATE TABLE arena_tournaments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  title text NOT NULL CHECK(length(title) BETWEEN 1 AND 100),
  description text NOT NULL DEFAULT '' CHECK(length(description)<=1000),
  capacity integer NOT NULL CHECK(capacity BETWEEN 2 AND 64),
  engine_version text NOT NULL,
  status text NOT NULL DEFAULT 'registration' CHECK(status IN ('registration','running','completed','cancelled')),
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  bracket_size integer CHECK(bracket_size IN (2,4,8,16,32,64)),
  champion_id uuid,
  request_id uuid NOT NULL, request_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz, ended_at timestamptz,
  UNIQUE(created_by,request_id)
);
CREATE TABLE arena_tournament_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid NOT NULL REFERENCES arena_tournaments(id) ON DELETE CASCADE,
  user_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  alias text NOT NULL CHECK(length(alias) BETWEEN 1 AND 40),
  status text NOT NULL DEFAULT 'invited' CHECK(status IN ('invited','accepted','declined','withdrawn','removed')),
  seed integer CHECK(seed BETWEEN 1 AND 64),
  deck_id uuid REFERENCES arena_decks(id) ON DELETE SET NULL,
  deck_revision integer, deck_snapshot jsonb,
  spectator_consent boolean NOT NULL DEFAULT false,
  invited_at timestamptz NOT NULL DEFAULT now(), responded_at timestamptz,
  UNIQUE(tournament_id,user_id), UNIQUE(tournament_id,seed)
);
ALTER TABLE arena_tournaments ADD CONSTRAINT arena_tournament_champion FOREIGN KEY(champion_id) REFERENCES arena_tournament_entries(id) ON DELETE SET NULL;
CREATE TABLE arena_tournament_nodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid NOT NULL REFERENCES arena_tournaments(id) ON DELETE CASCADE,
  round integer NOT NULL CHECK(round BETWEEN 1 AND 6),
  position integer NOT NULL CHECK(position BETWEEN 0 AND 31),
  left_id uuid REFERENCES arena_tournament_entries(id) ON DELETE SET NULL,
  right_id uuid REFERENCES arena_tournament_entries(id) ON DELETE SET NULL,
  winner_id uuid REFERENCES arena_tournament_entries(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','ready','playing','draw','completed','bye','cancelled')),
  outcome text NOT NULL DEFAULT '', reason text NOT NULL DEFAULT '',
  attempt integer NOT NULL DEFAULT 0 CHECK(attempt BETWEEN 0 AND 20),
  match_id uuid REFERENCES arena_matches(id) ON DELETE SET NULL,
  UNIQUE(tournament_id,round,position), UNIQUE(match_id)
);
ALTER TABLE arena_matches ADD COLUMN tournament_id uuid REFERENCES arena_tournaments(id) ON DELETE CASCADE;
ALTER TABLE arena_matches ADD COLUMN tournament_node_id uuid REFERENCES arena_tournament_nodes(id) ON DELETE SET NULL;
CREATE INDEX arena_tournament_member ON arena_tournament_entries(user_id,tournament_id);
CREATE INDEX arena_tournament_games ON arena_matches(tournament_id,created_at);
CREATE TABLE arena_tournament_receipts (
  tournament_id uuid NOT NULL REFERENCES arena_tournaments(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  request_id uuid NOT NULL, request_hash text NOT NULL, response jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,request_id)
);
