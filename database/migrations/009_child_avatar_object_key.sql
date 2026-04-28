BEGIN;

ALTER TABLE children
  ADD COLUMN IF NOT EXISTS avatar_object_key text;

COMMIT;
