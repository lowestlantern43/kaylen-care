BEGIN;

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS trial_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz,
  ADD COLUMN IF NOT EXISTS access_paused_at timestamptz,
  ADD COLUMN IF NOT EXISTS access_pause_reason text NOT NULL DEFAULT '';

ALTER TABLE subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_status_valid;

ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_status_valid CHECK (
    status IN (
      'inactive',
      'trialing',
      'active',
      'past_due',
      'canceled',
      'cancelled',
      'unpaid',
      'incomplete',
      'incomplete_expired'
    )
  );

UPDATE subscriptions
SET
  plan = CASE
    WHEN plan IS NULL OR trim(plan) = '' OR plan = 'free' THEN 'trial'
    ELSE plan
  END,
  status = CASE
    WHEN status IS NULL OR trim(status) = '' OR status = 'inactive' THEN 'trialing'
    ELSE status
  END,
  trial_started_at = COALESCE(trial_started_at, created_at, now()),
  trial_ends_at = COALESCE(trial_ends_at, COALESCE(created_at, now()) + interval '30 days')
WHERE plan IS NULL
   OR trim(plan) = ''
   OR plan = 'free'
   OR trial_started_at IS NULL
   OR trial_ends_at IS NULL;

COMMIT;
