-- The printed denominator excludes secret cards; card_count includes them.
ALTER TABLE card_sets
  ADD COLUMN printed_total integer CHECK(printed_total BETWEEN 1 AND 100000),
  ADD COLUMN printed_codes text[] NOT NULL DEFAULT '{}';

-- Existing full card responses retain the official denominator. Only backfill
-- sets whose imported cards agree, and never substitute the total card count.
WITH totals AS (
  SELECT set_id, CASE WHEN raw_data #>> '{set,cardCount,official}' ~ '^[0-9]{1,6}$'
    THEN (raw_data #>> '{set,cardCount,official}')::integer END AS printed_total
  FROM cards WHERE game='pokemon'
), consistent AS (
  SELECT set_id,min(printed_total) AS printed_total FROM totals
  WHERE printed_total BETWEEN 1 AND 100000 GROUP BY set_id HAVING count(DISTINCT printed_total)=1
)
UPDATE card_sets s SET printed_total=c.printed_total FROM consistent c WHERE s.id=c.set_id;
-- Set abbreviations/TCG Online codes are retained on subsequent set imports.
