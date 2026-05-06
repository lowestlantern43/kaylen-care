ALTER TABLE families
  ADD COLUMN IF NOT EXISTS archive_delete_after timestamptz,
  ADD COLUMN IF NOT EXISTS archive_warning_14_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS archive_warning_7_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS permanently_deleted_at timestamptz;

UPDATE families
SET archive_delete_after = COALESCE(archive_delete_after, deleted_at + interval '90 days')
WHERE deleted_at IS NOT NULL
  AND permanently_deleted_at IS NULL;
