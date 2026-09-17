-- Listings are advertisements, not payments, orders or inventory allocations.
CREATE TABLE marketplace_listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id uuid NOT NULL REFERENCES app_users ON DELETE CASCADE,
  request_id uuid NOT NULL, input_hash text NOT NULL,
  printing_id uuid NOT NULL REFERENCES printings,
  seller_alias text NOT NULL CHECK (length(seller_alias) BETWEEN 2 AND 40),
  condition text NOT NULL CHECK (condition IN ('NM','LP','MP','HP','DMG','UNKNOWN')),
  price_minor integer NOT NULL CHECK (price_minor BETWEEN 1 AND 10000000),
  currency text NOT NULL DEFAULT 'AUD' CHECK (currency = 'AUD'),
  delivery text NOT NULL CHECK (delivery IN ('postage','pickup','both')),
  postage_minor integer NOT NULL CHECK (postage_minor BETWEEN 0 AND 100000),
  region text NOT NULL CHECK (length(region) BETWEEN 2 AND 80),
  description text NOT NULL CHECK (length(description) BETWEEN 10 AND 2000),
  ownership_confirmed_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','reserved','sold','withdrawn')),
  hidden boolean NOT NULL DEFAULT false,
  moderation_reason text NOT NULL DEFAULT '',
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(seller_id, request_id), CHECK(delivery <> 'pickup' OR postage_minor = 0)
);
CREATE INDEX marketplace_browse ON marketplace_listings(created_at DESC, id) WHERE NOT hidden AND status IN ('active','reserved');
CREATE INDEX marketplace_seller ON marketplace_listings(seller_id, created_at DESC);
CREATE TABLE marketplace_photos (
  listing_id uuid NOT NULL REFERENCES marketplace_listings ON DELETE CASCADE,
  side text NOT NULL CHECK(side IN ('front','back')),
  data bytea NOT NULL CHECK(octet_length(data) BETWEEN 1 AND 1000000),
  PRIMARY KEY(listing_id,side)
);
CREATE TABLE marketplace_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL REFERENCES marketplace_listings ON DELETE CASCADE,
  buyer_id uuid NOT NULL REFERENCES app_users ON DELETE CASCADE,
  quoted_price_minor integer NOT NULL, quoted_postage_minor integer NOT NULL,
  closed boolean NOT NULL DEFAULT false, revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(listing_id,buyer_id)
);
CREATE INDEX marketplace_inbox ON marketplace_conversations(buyer_id,updated_at DESC);
CREATE TABLE marketplace_messages (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES marketplace_conversations ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES app_users ON DELETE CASCADE,
  request_id uuid NOT NULL,
  body text NOT NULL CHECK(length(body) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(sender_id,request_id)
);
CREATE INDEX marketplace_message_thread ON marketplace_messages(conversation_id,id DESC);
CREATE TABLE marketplace_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL REFERENCES marketplace_listings ON DELETE CASCADE,
  reporter_id uuid NOT NULL REFERENCES app_users ON DELETE CASCADE,
  reason text NOT NULL CHECK(reason IN ('suspected_counterfeit','misleading','prohibited','abuse','other')),
  details text NOT NULL CHECK(length(details) BETWEEN 10 AND 1500),
  status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved')),
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(listing_id,reporter_id)
);
CREATE INDEX marketplace_reports_open ON marketplace_reports(created_at DESC) WHERE status='open';
-- Nothing in this migration changes accounts, grants, collections, binders or plan prices.
