BEGIN;

ALTER TABLE families
  ADD COLUMN IF NOT EXISTS platform_status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS platform_admin_notes text;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS platform_status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS platform_admin_notes text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'families_platform_status_valid'
  ) THEN
    ALTER TABLE families
      ADD CONSTRAINT families_platform_status_valid
      CHECK (platform_status IN ('active', 'suspended', 'watch'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'users_platform_status_valid'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_platform_status_valid
      CHECK (platform_status IN ('active', 'suspended', 'watch'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS families_platform_status_idx
  ON families (platform_status)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS users_platform_status_idx
  ON users (platform_status)
  WHERE deleted_at IS NULL;

COMMIT;
