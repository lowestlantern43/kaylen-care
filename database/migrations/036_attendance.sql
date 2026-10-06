ALTER TABLE child_profiles ADD COLUMN IF NOT EXISTS attendance_enabled BOOLEAN NOT NULL DEFAULT false;
