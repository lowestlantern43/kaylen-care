BEGIN;

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS stripe_promotion_code_id text,
  ADD COLUMN IF NOT EXISTS stripe_promotion_code text,
  ADD COLUMN IF NOT EXISTS stripe_coupon_id text,
  ADD COLUMN IF NOT EXISTS stripe_coupon_name text,
  ADD COLUMN IF NOT EXISTS stripe_discount_percent_off numeric,
  ADD COLUMN IF NOT EXISTS stripe_discount_amount_off integer,
  ADD COLUMN IF NOT EXISTS stripe_discount_currency text;

COMMIT;
