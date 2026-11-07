ALTER TABLE binders ADD COLUMN exclusive_set_ids text[] NOT NULL DEFAULT '{}';
CREATE TABLE binder_exclusive_requests (
  user_id uuid NOT NULL REFERENCES app_users ON DELETE CASCADE,
  request_id uuid NOT NULL,
  binder_id uuid NOT NULL REFERENCES binders ON DELETE CASCADE,
  input_hash text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,request_id)
);
