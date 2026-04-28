BEGIN;

CREATE TABLE IF NOT EXISTS child_profiles (
  child_id uuid PRIMARY KEY REFERENCES children(id) ON DELETE CASCADE,
  family_id uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  diagnosis_needs text,
  communication_style text,
  key_needs text,
  current_medications text,
  allergies text,
  emergency_notes text,
  likes text,
  dislikes text,
  triggers text,
  calming_strategies text,
  eating_preferences text,
  sleep_preferences text,
  toileting_notes text,
  sensory_needs text,
  school_ehcp_notes text,
  medical_notes text,
  updated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS child_profiles_family_idx
  ON child_profiles (family_id);

CREATE TABLE IF NOT EXISTS important_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  child_id uuid NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  event_date date NOT NULL,
  event_time time,
  event_type text NOT NULL,
  notes text,
  action_taken text,
  outcome text,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT important_events_type_valid CHECK (
    event_type IN (
      'seizure',
      'injury',
      'meltdown',
      'hospital_visit',
      'medication_reaction',
      'illness',
      'other'
    )
  )
);

CREATE INDEX IF NOT EXISTS important_events_child_date_idx
  ON important_events (family_id, child_id, event_date DESC)
  WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS child_profiles_set_updated_at ON child_profiles;
CREATE TRIGGER child_profiles_set_updated_at
BEFORE UPDATE ON child_profiles
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS important_events_set_updated_at ON important_events;
CREATE TRIGGER important_events_set_updated_at
BEFORE UPDATE ON important_events
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
