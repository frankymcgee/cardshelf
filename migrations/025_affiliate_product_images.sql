-- Manual product images are kept locally; drafts are never publicly served.
CREATE TABLE affiliate_product_images (
  id uuid PRIMARY KEY,
  content bytea NOT NULL CHECK (octet_length(content) BETWEEN 1 AND 524288),
  width integer NOT NULL CHECK (width BETWEEN 1 AND 1200),
  height integer NOT NULL CHECK (height BETWEEN 1 AND 1200),
  uploaded_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX affiliate_product_images_created_idx ON affiliate_product_images(created_at);
