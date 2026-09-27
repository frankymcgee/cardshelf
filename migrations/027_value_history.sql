-- Observed ownership/layout snapshots, never reconstructed historical holdings.
CREATE TABLE value_history_snapshots (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES app_users ON DELETE CASCADE,
  binder_id uuid REFERENCES binders ON DELETE CASCADE,
  snapshot_date date NOT NULL,
  recorded_at timestamptz NOT NULL,
  valuation jsonb NOT NULL,
  owned_reference jsonb,
  holdings jsonb NOT NULL,
  rates jsonb NOT NULL
);
CREATE UNIQUE INDEX value_history_collection_day
  ON value_history_snapshots(user_id,snapshot_date) WHERE binder_id IS NULL;
CREATE UNIQUE INDEX value_history_binder_day
  ON value_history_snapshots(binder_id,snapshot_date) WHERE binder_id IS NOT NULL;
CREATE INDEX value_history_retention ON value_history_snapshots(snapshot_date);
CREATE INDEX value_history_owner_scope ON value_history_snapshots(user_id,binder_id,snapshot_date DESC);
