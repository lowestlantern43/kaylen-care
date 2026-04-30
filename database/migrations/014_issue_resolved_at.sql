ALTER TABLE issue_reports
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;

UPDATE issue_reports
SET resolved_at = COALESCE(resolved_at, updated_at, now())
WHERE resolved = true
  AND resolved_at IS NULL;
