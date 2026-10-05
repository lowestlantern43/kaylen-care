ALTER TABLE child_profiles ADD COLUMN IF NOT EXISTS smart_insights_enabled BOOLEAN NOT NULL DEFAULT false;
