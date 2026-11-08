-- Curated rules and administrator overrides take precedence over automatic data.
ALTER TABLE printing_distribution_rules ADD COLUMN automatic boolean NOT NULL DEFAULT false;
