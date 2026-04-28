BEGIN;

ALTER TABLE families
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS emergency_contacts jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE child_care_options
  DROP CONSTRAINT IF EXISTS child_care_options_category_valid;

ALTER TABLE child_care_options
  ADD CONSTRAINT child_care_options_category_valid
  CHECK (category IN ('food', 'medication', 'given_by', 'location'));

COMMIT;
