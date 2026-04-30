ALTER TABLE issue_reports
  ADD COLUMN IF NOT EXISTS internal_note TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS resolved BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS notified BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS context_section TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS device_type TEXT NOT NULL DEFAULT '';

ALTER TABLE issue_reports
  DROP CONSTRAINT IF EXISTS issue_reports_status_check;

UPDATE issue_reports
SET status = CASE status
  WHEN 'open' THEN 'new'
  WHEN 'reviewing' THEN 'in_progress'
  WHEN 'fixed' THEN 'resolved'
  WHEN 'closed' THEN 'resolved'
  ELSE status
END;

UPDATE issue_reports
SET resolved = true
WHERE status = 'resolved';

ALTER TABLE issue_reports
  ADD CONSTRAINT issue_reports_status_check
  CHECK (status IN ('new', 'in_progress', 'resolved'));

CREATE INDEX IF NOT EXISTS idx_issue_reports_resolved_notified_user
  ON issue_reports (user_id, resolved, notified);
