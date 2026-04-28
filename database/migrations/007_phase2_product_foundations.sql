BEGIN;

CREATE TABLE IF NOT EXISTS medication_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  child_id uuid NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  medication_name text NOT NULL,
  dose text,
  scheduled_time time NOT NULL,
  days_of_week integer[] NOT NULL DEFAULT ARRAY[0,1,2,3,4,5,6],
  is_active boolean NOT NULL DEFAULT true,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT medication_schedules_name_not_blank CHECK (length(trim(medication_name)) > 0)
);

CREATE INDEX IF NOT EXISTS medication_schedules_child_active_idx
  ON medication_schedules (family_id, child_id, scheduled_time)
  WHERE deleted_at IS NULL AND is_active = true;

CREATE TABLE IF NOT EXISTS custom_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  child_id uuid REFERENCES children(id) ON DELETE CASCADE,
  name text NOT NULL,
  icon text NOT NULL DEFAULT 'Note',
  colour text NOT NULL DEFAULT 'slate',
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT custom_categories_name_not_blank CHECK (length(trim(name)) > 0)
);

CREATE INDEX IF NOT EXISTS custom_categories_family_child_idx
  ON custom_categories (family_id, child_id)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS share_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  child_id uuid REFERENCES children(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  sections jsonb NOT NULL DEFAULT '{}'::jsonb,
  include_sensitive boolean NOT NULL DEFAULT false,
  expires_at timestamptz NOT NULL,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS share_links_token_hash_unique
  ON share_links (token_hash);

CREATE INDEX IF NOT EXISTS share_links_family_created_idx
  ON share_links (family_id, created_at DESC);

DROP TRIGGER IF EXISTS medication_schedules_set_updated_at ON medication_schedules;
CREATE TRIGGER medication_schedules_set_updated_at
BEFORE UPDATE ON medication_schedules
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS custom_categories_set_updated_at ON custom_categories;
CREATE TRIGGER custom_categories_set_updated_at
BEFORE UPDATE ON custom_categories
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
