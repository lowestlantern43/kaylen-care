BEGIN;

ALTER TABLE child_care_options
  DROP CONSTRAINT IF EXISTS child_care_options_category_valid;

ALTER TABLE child_care_options
  ADD CONSTRAINT child_care_options_category_valid
  CHECK (category IN ('food', 'drink', 'medication', 'given_by', 'location'));

COMMIT;
