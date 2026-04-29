import dotenv from "dotenv";
import pg from "pg";
import { buildPostgresConnectionOptions } from "../db/connection.js";

dotenv.config();

const { Client } = pg;

const sql = `
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
`;

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is missing.");
  process.exit(1);
}

const client = new Client(buildPostgresConnectionOptions(process.env.DATABASE_URL));

try {
  await client.connect();
  await client.query(sql);
  console.log("Issue reporting tables installed successfully.");
} catch (error) {
  console.error("Issue reporting install failed:", error.message);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => null);
}
