ALTER TABLE child_profiles
  ADD COLUMN IF NOT EXISTS hydration_checkpoints JSONB NOT NULL DEFAULT
    '[{"time":"13:00","percent":50},{"time":"16:30","percent":70},{"time":"20:00","percent":100}]'::JSONB,
  ADD COLUMN IF NOT EXISTS hydration_notification_tone TEXT NOT NULL DEFAULT 'gentle',
  ADD COLUMN IF NOT EXISTS quiet_hours JSONB NOT NULL DEFAULT
    '{"enabled":false,"start":"21:00","end":"07:00"}'::JSONB;
