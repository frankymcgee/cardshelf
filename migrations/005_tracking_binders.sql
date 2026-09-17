-- Existing binders stay in the full-featured collection mode. No account,
-- tester grant, collection quantity, condition, wallpaper or price is changed.
ALTER TABLE binders ADD COLUMN binder_type text NOT NULL DEFAULT 'collection'
  CHECK (binder_type IN ('tracking','collection'));
ALTER TABLE binder_slots ADD COLUMN is_collected boolean NOT NULL DEFAULT false;
CREATE TABLE binder_tracking_requests (
  binder_id uuid NOT NULL REFERENCES binders(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  position integer NOT NULL CHECK (position BETWEEN 0 AND 959),
  printing_id uuid NOT NULL,
  collected boolean NOT NULL,
  request_revision integer NOT NULL CHECK (request_revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (binder_id,request_id)
);
-- Draft descriptions only; preserve any descriptions/amounts already edited by an admin.
UPDATE membership_plans SET description=CASE code
  WHEN 'collector' THEN 'Quick tracking binders, set and series generation, sharing and printable checklists.'
  WHEN 'plus' THEN 'Everything in Collector, plus detailed collections, conditions, prices and custom binder appearance.' END,
  revision=revision+1,updated_at=now()
WHERE code IN ('collector','plus') AND state='draft'
  AND description='Unpublished subscription draft. Pricing has not been decided.';
