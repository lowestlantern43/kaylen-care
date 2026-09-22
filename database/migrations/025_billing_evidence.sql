CREATE TABLE IF NOT EXISTS billing_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid,
  user_id uuid,
  event_type text NOT NULL CHECK (length(trim(event_type)) > 0),
  event_source text NOT NULL DEFAULT 'backend' CHECK (length(trim(event_source)) > 0),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  stripe_customer_id text,
  stripe_subscription_id text,
  stripe_checkout_session_id text,
  stripe_payment_intent_id text,
  stripe_invoice_id text,
  stripe_charge_id text,
  stripe_refund_id text,
  stripe_dispute_id text,
  stripe_event_id text,
  amount_minor bigint,
  currency text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  ip_address inet,
  user_agent text,
  idempotency_key text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS billing_audit_events_stripe_event_type_unique
  ON billing_audit_events (stripe_event_id, event_type)
  WHERE stripe_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS billing_audit_events_family_occurred_idx
  ON billing_audit_events (family_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS billing_audit_events_user_occurred_idx
  ON billing_audit_events (user_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS billing_audit_events_event_type_occurred_idx
  ON billing_audit_events (event_type, occurred_at DESC);

CREATE INDEX IF NOT EXISTS billing_audit_events_stripe_customer_idx
  ON billing_audit_events (stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS billing_audit_events_stripe_subscription_idx
  ON billing_audit_events (stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS billing_audit_events_stripe_dispute_idx
  ON billing_audit_events (stripe_dispute_id)
  WHERE stripe_dispute_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS billing_consent_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid,
  user_id uuid,
  terms_version text,
  privacy_policy_version text,
  refund_policy_version text,
  price_presented_minor bigint,
  currency text,
  billing_interval text,
  trial_days_presented integer CHECK (trial_days_presented IS NULL OR trial_days_presented >= 0),
  calculated_first_payment_at timestamptz,
  accepted_at timestamptz NOT NULL,
  evidence_source text NOT NULL DEFAULT 'backend',
  ip_address inet,
  user_agent text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  idempotency_key text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS billing_consent_evidence_family_accepted_idx
  ON billing_consent_evidence (family_id, accepted_at DESC);

CREATE INDEX IF NOT EXISTS billing_consent_evidence_user_accepted_idx
  ON billing_consent_evidence (user_id, accepted_at DESC);

CREATE TABLE IF NOT EXISTS stripe_webhook_events (
  stripe_event_id text PRIMARY KEY,
  event_type text NOT NULL,
  status text NOT NULL DEFAULT 'processing',
  attempts integer NOT NULL DEFAULT 1,
  last_error text,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION reject_billing_evidence_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;

DROP TRIGGER IF EXISTS billing_audit_events_append_only ON billing_audit_events;
CREATE TRIGGER billing_audit_events_append_only
  BEFORE UPDATE OR DELETE ON billing_audit_events
  FOR EACH ROW EXECUTE FUNCTION reject_billing_evidence_mutation();

DROP TRIGGER IF EXISTS billing_consent_evidence_append_only ON billing_consent_evidence;
CREATE TRIGGER billing_consent_evidence_append_only
  BEFORE UPDATE OR DELETE ON billing_consent_evidence
  FOR EACH ROW EXECUTE FUNCTION reject_billing_evidence_mutation();
