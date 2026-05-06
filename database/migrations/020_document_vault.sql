CREATE TABLE IF NOT EXISTS family_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  child_id uuid REFERENCES children(id) ON DELETE SET NULL,
  title text NOT NULL,
  category text NOT NULL DEFAULT 'Other',
  document_date date,
  notes text,
  file_name text NOT NULL,
  file_type text NOT NULL,
  file_size_bytes integer NOT NULL DEFAULT 0,
  object_key text NOT NULL,
  created_by_user_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_family_documents_family
  ON family_documents(family_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_family_documents_child
  ON family_documents(child_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_family_documents_category
  ON family_documents(family_id, category)
  WHERE deleted_at IS NULL;
