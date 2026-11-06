ALTER TABLE binders ADD COLUMN start_on_right boolean NOT NULL DEFAULT false;
ALTER TABLE binders ADD COLUMN compact_on_remove boolean NOT NULL DEFAULT false;
ALTER TABLE binders ADD CONSTRAINT compact_collection_only CHECK (NOT compact_on_remove OR binder_type='collection');

-- Retire incorrect catalogue choices without deleting ownership, pockets or history.
ALTER TABLE printings ADD COLUMN provider_active boolean NOT NULL DEFAULT true;
ALTER TABLE printings ADD COLUMN availability_override boolean;
ALTER TABLE printings ADD COLUMN availability_revision integer NOT NULL DEFAULT 1;
ALTER TABLE printings ADD COLUMN catalogue_available boolean GENERATED ALWAYS AS (coalesce(availability_override,provider_active)) STORED;
UPDATE printings p SET provider_active=(c.raw_data->'variants'->p.key='true'::jsonb)
FROM cards c WHERE c.id=p.card_id AND p.source='tcgdex'
  AND jsonb_typeof(c.raw_data->'variants')='object' AND c.raw_data->'variants' ? p.key
  AND p.key IN ('normal','holo','reverse','firstEdition','shadowless','wPromo');

-- A card with no reliable finish flags still has an explicit unknown choice.
INSERT INTO printings(card_id,key,label,source,verified,metadata)
SELECT c.id,'unspecified','Unspecified printing','tcgdex',false,'{"basis":"missing_provider_flags"}'::jsonb FROM cards c
WHERE c.game='pokemon' AND NOT EXISTS(SELECT 1 FROM printings p WHERE p.card_id=c.id AND p.catalogue_available)
ON CONFLICT(card_id,key) DO UPDATE SET provider_active=true;
