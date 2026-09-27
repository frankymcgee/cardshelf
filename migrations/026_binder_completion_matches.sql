-- Exact-printing completion lookups use active, visible member listings only.
CREATE INDEX marketplace_completion_printing ON marketplace_listings(printing_id, price_minor, id)
  WHERE status='active' AND NOT hidden;
