BEGIN;

ALTER TABLE children
  ADD COLUMN IF NOT EXISTS nhs_number text;

COMMIT;
