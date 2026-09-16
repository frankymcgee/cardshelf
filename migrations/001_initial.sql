CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE TABLE app_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL,
  name text NOT NULL, password_hash text NOT NULL,
  role text NOT NULL DEFAULT 'user' CHECK (role IN ('admin','user')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX app_users_email_ci ON app_users (lower(email));
CREATE TABLE sessions (
  token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES app_users ON DELETE CASCADE,
  expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user ON sessions (user_id);
CREATE INDEX sessions_expiry ON sessions (expires_at);
CREATE TABLE auth_attempts (bucket text PRIMARY KEY, attempts integer NOT NULL, reset_at timestamptz NOT NULL);
CREATE TABLE card_sets (
  id text PRIMARY KEY, provider_id text NOT NULL, language text NOT NULL CHECK (language IN ('en','ja')),
  name text NOT NULL, series text NOT NULL DEFAULT '', release_date date,
  card_count integer NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(language, provider_id)
);
CREATE TABLE cards (
  id text PRIMARY KEY, provider_id text NOT NULL, set_id text NOT NULL REFERENCES card_sets,
  language text NOT NULL CHECK (language IN ('en','ja')), local_id text NOT NULL,
  name text NOT NULL, illustrator text NOT NULL DEFAULT '', rarity text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT '', image_url text, dex_ids integer[] NOT NULL DEFAULT '{}',
  raw_data jsonb NOT NULL DEFAULT '{}', updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(language, provider_id)
);
CREATE INDEX cards_name_search ON cards USING gin (name gin_trgm_ops);
CREATE INDEX cards_illustrator_search ON cards USING gin (illustrator gin_trgm_ops);
CREATE INDEX cards_set ON cards (set_id);
CREATE INDEX cards_language ON cards (language);
CREATE INDEX cards_dex_ids ON cards USING gin (dex_ids);
CREATE TABLE printings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), card_id text NOT NULL REFERENCES cards,
  key text NOT NULL, label text NOT NULL, source text NOT NULL CHECK (source IN ('tcgdex','manual')),
  verified boolean NOT NULL DEFAULT false, metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(card_id, key)
);
CREATE INDEX printings_card ON printings (card_id);
CREATE TABLE collection_entries (
  user_id uuid NOT NULL REFERENCES app_users ON DELETE CASCADE,
  printing_id uuid NOT NULL REFERENCES printings, condition text NOT NULL CHECK (condition IN ('NM','LP','MP','HP','DMG','UNKNOWN')),
  quantity integer NOT NULL DEFAULT 0 CHECK (quantity BETWEEN 0 AND 9999), wishlist boolean NOT NULL DEFAULT false,
  notes text NOT NULL DEFAULT '' CHECK (length(notes) <= 2000), revision integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id, printing_id, condition)
);
CREATE INDEX collection_positive ON collection_entries(user_id, printing_id) WHERE quantity > 0;
CREATE TABLE binders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES app_users ON DELETE CASCADE,
  title text NOT NULL, description text NOT NULL DEFAULT '', color text NOT NULL DEFAULT '#5546d8',
  columns integer NOT NULL CHECK (columns IN (2,3,4)), rows integer NOT NULL CHECK (rows IN (2,3,4)),
  page_count integer NOT NULL CHECK (page_count BETWEEN 1 AND 60), revision integer NOT NULL DEFAULT 1,
  share_token text UNIQUE, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX binders_user ON binders(user_id);
CREATE TABLE binder_slots (
  binder_id uuid NOT NULL REFERENCES binders ON DELETE CASCADE,
  position integer NOT NULL CHECK (position >= 0), printing_id uuid NOT NULL REFERENCES printings,
  PRIMARY KEY(binder_id, position)
);
CREATE INDEX binder_slots_printing ON binder_slots(printing_id);
CREATE TABLE jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid REFERENCES app_users ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind = 'import-set'), scope_key text NOT NULL, payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','completed','failed')),
  progress integer NOT NULL DEFAULT 0, total integer NOT NULL DEFAULT 0, attempts integer NOT NULL DEFAULT 0,
  message text NOT NULL DEFAULT 'Queued', errors jsonb NOT NULL DEFAULT '[]',
  lease_token text, heartbeat_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz
);
CREATE UNIQUE INDEX jobs_active_scope ON jobs(scope_key) WHERE status IN ('queued','running');
CREATE INDEX jobs_queued ON jobs(created_at) WHERE status = 'queued';
CREATE TABLE app_state (key text PRIMARY KEY, value jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, user_id uuid REFERENCES app_users ON DELETE SET NULL,
  action text NOT NULL, detail jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
