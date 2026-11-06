ALTER TABLE card_price_cache ADD COLUMN market_metrics jsonb NOT NULL DEFAULT '[]';
ALTER TABLE card_price_cache ADD COLUMN provider_status jsonb NOT NULL DEFAULT '{}';
