CREATE TABLE collection_cost_lots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  printing_id uuid NOT NULL REFERENCES printings(id),
  condition text NOT NULL CHECK(condition IN ('NM','LP','MP','HP','DMG','UNKNOWN')),
  acquired_on date NOT NULL,
  quantity integer NOT NULL CHECK(quantity BETWEEN 1 AND 9999),
  remaining_quantity integer NOT NULL CHECK(remaining_quantity>=0 AND remaining_quantity<=quantity),
  currency text NOT NULL CHECK(currency IN ('AUD','USD','EUR')),
  goods_minor integer NOT NULL CHECK(goods_minor BETWEEN 0 AND 100000000),
  postage_minor integer NOT NULL CHECK(postage_minor BETWEEN 0 AND 100000000),
  aud_rate numeric(16,8) NOT NULL CHECK(aud_rate>0 AND aud_rate<=1000),
  cost_aud_minor bigint NOT NULL CHECK(cost_aud_minor BETWEEN 0 AND 200000000000),
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX collection_cost_coverage_idx ON collection_cost_lots(user_id,printing_id,condition) WHERE remaining_quantity>0;
CREATE TABLE collection_cost_sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lot_id uuid NOT NULL REFERENCES collection_cost_lots(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  sold_on date NOT NULL,
  quantity integer NOT NULL CHECK(quantity BETWEEN 1 AND 9999),
  currency text NOT NULL CHECK(currency IN ('AUD','USD','EUR')),
  gross_minor integer NOT NULL CHECK(gross_minor BETWEEN 0 AND 100000000),
  fees_minor integer NOT NULL CHECK(fees_minor BETWEEN 0 AND 100000000),
  postage_minor integer NOT NULL CHECK(postage_minor BETWEEN 0 AND 100000000),
  aud_rate numeric(16,8) NOT NULL CHECK(aud_rate>0 AND aud_rate<=1000),
  net_aud_minor bigint NOT NULL,
  cost_aud_minor bigint NOT NULL CHECK(cost_aud_minor>=0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE collection_cost_requests (
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  input_hash text NOT NULL,
  result jsonb NOT NULL,
  PRIMARY KEY(user_id,request_id)
);

-- All inventory writers, including imports, scan undo and quick tracking, must
-- leave enough copies to cover purchase lots. Check the final transaction state
-- so a purchase or sale can update inventory and its lot atomically.
CREATE FUNCTION check_collection_cost_coverage() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner_id uuid; printing uuid; grade text; owned integer; tracked bigint;
BEGIN
  IF TG_OP='DELETE' THEN owner_id:=OLD.user_id; printing:=OLD.printing_id; grade:=OLD.condition;
  ELSE owner_id:=NEW.user_id; printing:=NEW.printing_id; grade:=NEW.condition; END IF;
  IF NOT EXISTS(SELECT 1 FROM app_users WHERE id=owner_id) THEN RETURN NULL; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('collection:'||owner_id::text,0));
  SELECT quantity INTO owned FROM collection_entries WHERE user_id=owner_id AND printing_id=printing AND condition=grade;
  SELECT coalesce(sum(remaining_quantity),0) INTO tracked FROM collection_cost_lots WHERE user_id=owner_id AND printing_id=printing AND condition=grade;
  IF tracked>coalesce(owned,0) THEN
    RAISE EXCEPTION 'Record a sale or release purchase cost tracking before reducing these copies.' USING ERRCODE='23514',CONSTRAINT='collection_cost_coverage';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER collection_cost_entry_coverage AFTER INSERT OR UPDATE OR DELETE ON collection_entries DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_collection_cost_coverage();
CREATE CONSTRAINT TRIGGER collection_cost_lot_coverage AFTER INSERT OR UPDATE OR DELETE ON collection_cost_lots DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_collection_cost_coverage();
