-- Existing IDs, tester grants, subscriptions, inventory and sharing tokens survive.
ALTER TABLE card_sets ADD COLUMN game text NOT NULL DEFAULT 'pokemon' CHECK(game IN ('pokemon','yugioh','mtg'));
ALTER TABLE cards ADD COLUMN game text NOT NULL DEFAULT 'pokemon' CHECK(game IN ('pokemon','yugioh','mtg'));
ALTER TABLE binders ADD COLUMN game text NOT NULL DEFAULT 'pokemon' CHECK(game IN ('pokemon','yugioh','mtg'));
ALTER TABLE card_sets DROP CONSTRAINT card_sets_language_provider_id_key;
ALTER TABLE card_sets ADD UNIQUE(game,language,provider_id);
ALTER TABLE cards DROP CONSTRAINT cards_language_provider_id_key;
ALTER TABLE cards ADD UNIQUE(game,language,provider_id);
ALTER TABLE printings DROP CONSTRAINT printings_source_check;
ALTER TABLE printings ADD CHECK(source IN ('tcgdex','manual','ygoprodeck','mtgjson'));
CREATE INDEX cards_game_set ON cards(game,set_id);
CREATE INDEX binders_user_game ON binders(user_id,game);
CREATE TABLE account_game_choices (
  user_id uuid PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
  game text NOT NULL CHECK(game IN ('pokemon','yugioh','mtg')),
  revision integer NOT NULL DEFAULT 1,updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE free_accounts (
  user_id uuid PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Registration is an explicit admin opt-in; legacy Add a collector stays a tester invite.
CREATE TABLE free_platform_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  registration_enabled boolean NOT NULL DEFAULT false,
  ads_enabled boolean NOT NULL DEFAULT false,
  sponsor_name text NOT NULL DEFAULT '',sponsor_text text NOT NULL DEFAULT '',
  sponsor_url text NOT NULL DEFAULT '',sponsor_cta text NOT NULL DEFAULT '',
  sponsor_image bytea,sponsor_image_alt text NOT NULL DEFAULT '',
  revision integer NOT NULL DEFAULT 1,
  updated_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE game_provider_cache (
  cache_key text PRIMARY KEY,payload_gzip bytea NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE catalogue_artwork (
  id text PRIMARY KEY CHECK(id ~ '^[a-f0-9]{64}$'),
  provider text NOT NULL CHECK(provider IN ('ygoprodeck','scryfall')),
  remote_id text NOT NULL,content bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(provider,remote_id)
);
ALTER TABLE jobs DROP CONSTRAINT jobs_kind_check;
ALTER TABLE jobs ADD CHECK(kind IN ('import-set','refresh-prices','import-game-set'));
-- Enforce cross-game integrity even if a future endpoint forgets its application guard.
CREATE FUNCTION cardshelf_validate_card_game() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM card_sets WHERE id=NEW.set_id AND game=NEW.game) THEN
    RAISE EXCEPTION 'Card and set must belong to the same game' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER card_game_integrity BEFORE INSERT OR UPDATE OF set_id,game ON cards
  FOR EACH ROW EXECUTE FUNCTION cardshelf_validate_card_game();
CREATE FUNCTION cardshelf_validate_pocket_game() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM binders b JOIN printings p ON p.id=NEW.printing_id
      JOIN cards c ON c.id=p.card_id WHERE b.id=NEW.binder_id AND b.game=c.game) THEN
    RAISE EXCEPTION 'A binder can contain cards from only its own game' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER pocket_game_integrity BEFORE INSERT OR UPDATE OF binder_id,printing_id ON binder_slots
  FOR EACH ROW EXECUTE FUNCTION cardshelf_validate_pocket_game();
CREATE FUNCTION cardshelf_preserve_binder_game() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.game<>OLD.game THEN RAISE EXCEPTION 'Binder game is immutable' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER binder_game_immutable BEFORE UPDATE OF game ON binders
  FOR EACH ROW EXECUTE FUNCTION cardshelf_preserve_binder_game();
-- Free is not a Stripe product and cannot accidentally be published as a paid offer.
ALTER TABLE membership_plans DROP CONSTRAINT membership_plans_code_check;
ALTER TABLE membership_plans ADD CHECK(code IN ('testing','free','collector','plus'));
ALTER TABLE membership_plans DROP CONSTRAINT membership_plans_state_check;
ALTER TABLE membership_plans ADD CHECK(state IN ('testing','free','draft'));
INSERT INTO membership_plans(code,name,description,state,monthly_price_minor,annual_price_minor)
  VALUES('free','Free','Public card catalogue and source prices. Optional sponsored placements; no paid collection tools.','free',0,0);
