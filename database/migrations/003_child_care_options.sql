BEGIN;

CREATE TABLE IF NOT EXISTS child_care_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  child_id uuid NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  category text NOT NULL,
  label text NOT NULL,
  default_value text,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT child_care_options_category_valid CHECK (
    category IN ('food', 'medication', 'given_by')
  ),
  CONSTRAINT child_care_options_label_not_blank CHECK (length(trim(label)) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS child_care_options_unique_active
  ON child_care_options (family_id, child_id, category, lower(label))
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS child_care_options_child_category_idx
  ON child_care_options (family_id, child_id, category)
  WHERE deleted_at IS NULL;

COMMIT;
