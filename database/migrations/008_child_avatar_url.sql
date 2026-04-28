BEGIN;

ALTER TABLE children
  ADD COLUMN IF NOT EXISTS avatar_url text;

COMMIT;
