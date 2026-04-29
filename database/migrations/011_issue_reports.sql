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
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT issue_reports_severity_check
    CHECK (severity IN ('small', 'annoying', 'blocking')),
  CONSTRAINT issue_reports_status_check
    CHECK (status IN ('open', 'reviewing', 'fixed', 'closed'))
);

CREATE INDEX IF NOT EXISTS idx_issue_reports_created_at
  ON issue_reports (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_issue_reports_status
  ON issue_reports (status);

CREATE INDEX IF NOT EXISTS idx_issue_reports_family_id
  ON issue_reports (family_id);

CREATE INDEX IF NOT EXISTS idx_issue_reports_user_id
  ON issue_reports (user_id);
