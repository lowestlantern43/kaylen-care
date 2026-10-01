-- Additive; old profile updates preserve this optional setting.
ALTER TABLE child_profiles ADD COLUMN IF NOT EXISTS usual_bedtime TEXT;
