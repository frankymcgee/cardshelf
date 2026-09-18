-- Additive only: no existing tracker is converted and no ownership is inferred on upgrade.
ALTER TABLE binders ADD COLUMN quick_tracking boolean NOT NULL DEFAULT false;
ALTER TABLE binders ADD CONSTRAINT quick_tracking_collection_only CHECK (NOT quick_tracking OR binder_type='collection');

-- A proof permits quick removal ONLY of the unchanged, single Unknown copy that
-- quick-add created. Detailed edits invalidate the revision; deletion cascades.
CREATE TABLE collection_quick_adds (
  user_id uuid NOT NULL,
  printing_id uuid NOT NULL,
  condition text NOT NULL DEFAULT 'UNKNOWN' CHECK (condition='UNKNOWN'),
  entry_revision integer NOT NULL CHECK (entry_revision>0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,printing_id),
  FOREIGN KEY(user_id,printing_id,condition) REFERENCES collection_entries(user_id,printing_id,condition) ON DELETE CASCADE
);
CREATE TABLE binder_collection_requests (
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  binder_id uuid NOT NULL REFERENCES binders(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('convert','ownership')),
  input_hash text NOT NULL CHECK (input_hash ~ '^[a-f0-9]{64}$'),
  result jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,request_id)
);
