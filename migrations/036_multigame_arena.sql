-- Existing Pokémon decks and version-pinned matches keep their identities.
ALTER TABLE arena_decks DROP CONSTRAINT arena_decks_game_check;
ALTER TABLE arena_decks ADD CONSTRAINT arena_decks_game_check CHECK(game IN ('pokemon','yugioh','mtg'));
