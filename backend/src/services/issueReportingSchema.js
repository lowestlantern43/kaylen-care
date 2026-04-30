import { query } from "../db/pool.js";

const issueReportingSchemaSql = `
CREATE TABLE IF NOT EXISTS platform_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}'::JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL
);

INSERT INTO platform_settings (key, value)
VALUES ('feedback', '{"enabled": true}'::JSONB)
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS issue_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  family_id UUID REFERENCES families(id) ON DELETE SET NULL,
  child_id UUID REFERENCES children(id) ON DELETE SET NULL,
  route TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'small',
  browser_info JSONB NOT NULL DEFAULT '{}'::JSONB,
  app_version TEXT,
  screenshot_url TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  internal_note TEXT NOT NULL DEFAULT '',
  resolved BOOLEAN NOT NULL DEFAULT false,
  resolved_at TIMESTAMPTZ,
  notified BOOLEAN NOT NULL DEFAULT false,
  context_section TEXT NOT NULL DEFAULT '',
  device_type TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE issue_reports
  ADD COLUMN IF NOT EXISTS internal_note TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS resolved BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ,
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
SET resolved = true,
    resolved_at = COALESCE(resolved_at, updated_at, now())
WHERE status = 'resolved';

ALTER TABLE issue_reports
  ADD CONSTRAINT issue_reports_status_check
  CHECK (status IN ('new', 'in_progress', 'resolved'));

CREATE INDEX IF NOT EXISTS idx_issue_reports_created_at
  ON issue_reports (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_issue_reports_status
  ON issue_reports (status);

CREATE INDEX IF NOT EXISTS idx_issue_reports_family_id
  ON issue_reports (family_id);

CREATE INDEX IF NOT EXISTS idx_issue_reports_user_id
  ON issue_reports (user_id);

CREATE INDEX IF NOT EXISTS idx_issue_reports_resolved_notified_user
  ON issue_reports (user_id, resolved, notified);
`;

let setupPromise = null;

export async function ensureIssueReportingSchema() {
  if (!setupPromise) {
    setupPromise = query(issueReportingSchemaSql).catch((error) => {
      setupPromise = null;
      throw error;
    });
  }

  await setupPromise;
}
