export const activationSchema = `-- Additive. Deleting a user/family removes their operational guidance state.
CREATE TABLE IF NOT EXISTS activation_rollout (
  id integer PRIMARY KEY CHECK(id=1), started_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO activation_rollout(id) VALUES(1) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS activation_progress (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  family_id uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  time_zone text NOT NULL DEFAULT 'Europe/London',
  dismissed boolean NOT NULL DEFAULT false,
  reminder_opt_in boolean NOT NULL DEFAULT false,
  reminder_claimed_at timestamptz,
  reminder_status text,
  first_entry_day date,
  analytics_opt_in boolean NOT NULL DEFAULT false,
  analytics_started_at timestamptz,
  day2_return boolean NOT NULL DEFAULT false,
  day3_return boolean NOT NULL DEFAULT false,
  report_used boolean NOT NULL DEFAULT false,
  share_used boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
`;
