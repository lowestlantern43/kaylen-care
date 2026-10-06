ALTER TABLE child_profiles ADD COLUMN IF NOT EXISTS school_settings JSONB NOT NULL DEFAULT '{}'::jsonb;
