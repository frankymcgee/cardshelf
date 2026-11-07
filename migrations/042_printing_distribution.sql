CREATE TABLE printing_distribution_rules (
  game text NOT NULL, language text NOT NULL, provider_card_id text NOT NULL, printing_key text NOT NULL,
  distribution text NOT NULL CHECK (distribution IN ('regular','product_exclusive','promo','unknown')),
  note text NOT NULL, evidence_url text NOT NULL,
  PRIMARY KEY(game,language,provider_card_id,printing_key)
);

-- English Pitch Black non-holo Build & Battle deck printings have distinct
-- TCGplayer Deck Exclusives product IDs. Holo/reverse use the regular set IDs.
INSERT INTO printing_distribution_rules
SELECT 'pokemon','en',v.card_id,f.key,
  CASE WHEN f.key='normal' THEN 'product_exclusive' ELSE 'regular' END,
  CASE WHEN f.key='normal' THEN 'Pitch Black Build & Battle deck exclusive (non-holo)' ELSE 'Pitch Black regular set finish' END,
  'https://www.tcgplayer.com/product/' || CASE WHEN f.key='normal' THEN v.deck_id ELSE v.set_id END
FROM (VALUES ('me05-028','707026','704785'),('me05-035','707028','704792'),
  ('me05-062','707025','704819'),('me05-070','707027','704827'),('me05-084','707029','704841')) v(card_id,deck_id,set_id)
CROSS JOIN (VALUES ('normal'),('holo'),('reverse')) f(key);

ALTER TABLE printings
  ADD COLUMN distribution_base text NOT NULL DEFAULT 'unknown' CHECK (distribution_base IN ('regular','product_exclusive','promo','unknown')),
  ADD COLUMN distribution_base_note text NOT NULL DEFAULT '',
  ADD COLUMN distribution_base_url text NOT NULL DEFAULT '',
  ADD COLUMN distribution_override text CHECK (distribution_override IN ('regular','product_exclusive','promo','unknown')),
  ADD COLUMN distribution_override_note text NOT NULL DEFAULT '',
  ADD COLUMN distribution_override_url text NOT NULL DEFAULT '',
  ADD COLUMN distribution_revision integer NOT NULL DEFAULT 1,
  ADD COLUMN distribution text GENERATED ALWAYS AS (coalesce(distribution_override,distribution_base)) STORED,
  ADD COLUMN distribution_note text GENERATED ALWAYS AS (CASE WHEN distribution_override IS NULL THEN distribution_base_note ELSE distribution_override_note END) STORED,
  ADD COLUMN distribution_url text GENERATED ALWAYS AS (CASE WHEN distribution_override IS NULL THEN distribution_base_url ELSE distribution_override_url END) STORED;

UPDATE printings p SET distribution_base=r.distribution,distribution_base_note=r.note,distribution_base_url=r.evidence_url
FROM cards c JOIN printing_distribution_rules r ON r.game=c.game AND r.language=c.language AND r.provider_card_id=c.provider_id
WHERE p.card_id=c.id AND p.key=r.printing_key AND p.source='tcgdex';

-- Existing binders retain their checklist and progress until their owner opts in.
ALTER TABLE binders ADD COLUMN printing_scope text NOT NULL DEFAULT 'all' CHECK (printing_scope IN ('regular','all'));
