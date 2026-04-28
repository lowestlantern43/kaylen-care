-- Kaylen's Diary SaaS foundation schema.
-- Target database: DigitalOcean Managed PostgreSQL.
-- All application access should go through the Node/Express API, not directly
-- from React.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  password_hash text NOT NULL,
  full_name text NOT NULL,
  reset_token_hash text,
  reset_token_expires_at timestamptz,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT users_email_not_blank CHECK (length(trim(email)) > 3),
  CONSTRAINT users_full_name_not_blank CHECK (length(trim(full_name)) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_unique
  ON users (lower(email))
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS families (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  timezone text NOT NULL DEFAULT 'Europe/London',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT families_name_not_blank CHECK (length(trim(name)) > 0)
);

CREATE TABLE IF NOT EXISTS family_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL,
  invited_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  joined_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT family_members_role_valid CHECK (
    role IN ('owner', 'parent', 'carer', 'viewer')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS family_members_family_user_unique
  ON family_members (family_id, user_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS family_members_user_id_idx
  ON family_members (user_id)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS children (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  first_name text NOT NULL,
  last_name text,
  date_of_birth date,
  notes text,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT children_first_name_not_blank CHECK (length(trim(first_name)) > 0)
);

CREATE INDEX IF NOT EXISTS children_family_id_idx
  ON children (family_id)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS care_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  child_id uuid NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  category text NOT NULL,
  log_date date NOT NULL,
  log_time time,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text,
  source_table text,
  source_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT care_logs_category_valid CHECK (
    category IN ('food', 'medication', 'sleep', 'toileting', 'health', 'general')
  )
);

CREATE INDEX IF NOT EXISTS care_logs_family_child_date_idx
  ON care_logs (family_id, child_id, log_date DESC, log_time DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS care_logs_family_category_date_idx
  ON care_logs (family_id, category, log_date DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS care_logs_data_gin_idx
  ON care_logs USING gin (data);

CREATE INDEX IF NOT EXISTS care_logs_incomplete_sleep_idx
  ON care_logs (family_id, child_id, created_at DESC)
  WHERE category = 'sleep'
    AND deleted_at IS NULL
    AND (data->>'wake_time' IS NULL OR data->>'wake_time' = '');

CREATE TABLE IF NOT EXISTS subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL UNIQUE REFERENCES families(id) ON DELETE CASCADE,
  stripe_customer_id text,
  stripe_subscription_id text,
  status text NOT NULL DEFAULT 'inactive',
  plan text NOT NULL DEFAULT 'free',
  current_period_end timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT subscriptions_status_valid CHECK (
    status IN (
      'inactive',
      'trialing',
      'active',
      'past_due',
      'canceled',
      'unpaid',
      'incomplete',
      'incomplete_expired'
    )
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_stripe_customer_unique
  ON subscriptions (stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_stripe_subscription_unique
  ON subscriptions (stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL,
  token_hash text NOT NULL,
  invited_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  accepted_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  accepted_at timestamptz,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CONSTRAINT invitations_role_valid CHECK (
    role IN ('owner', 'parent', 'carer', 'viewer')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS invitations_token_hash_unique
  ON invitations (token_hash);

CREATE INDEX IF NOT EXISTS invitations_family_email_idx
  ON invitations (family_id, lower(email))
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid REFERENCES families(id) ON DELETE SET NULL,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip_address inet,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_logs_family_created_idx
  ON audit_logs (family_id, created_at DESC);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS users_set_updated_at ON users;
CREATE TRIGGER users_set_updated_at
BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS families_set_updated_at ON families;
CREATE TRIGGER families_set_updated_at
BEFORE UPDATE ON families
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS family_members_set_updated_at ON family_members;
CREATE TRIGGER family_members_set_updated_at
BEFORE UPDATE ON family_members
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS children_set_updated_at ON children;
CREATE TRIGGER children_set_updated_at
BEFORE UPDATE ON children
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS care_logs_set_updated_at ON care_logs;
CREATE TRIGGER care_logs_set_updated_at
BEFORE UPDATE ON care_logs
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS subscriptions_set_updated_at ON subscriptions;
CREATE TRIGGER subscriptions_set_updated_at
BEFORE UPDATE ON subscriptions
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
