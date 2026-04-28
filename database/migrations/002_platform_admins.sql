BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_platform_admin boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS users_platform_admin_idx
  ON users (is_platform_admin)
  WHERE is_platform_admin = true AND deleted_at IS NULL;

COMMIT;
