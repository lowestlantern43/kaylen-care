
CREATE TABLE IF NOT EXISTS public_traffic_events (
 id uuid PRIMARY KEY, visitor_id uuid NOT NULL, occurred_at timestamptz NOT NULL DEFAULT now(),
 page text NOT NULL, kind text NOT NULL, source text NOT NULL, device text NOT NULL
);
CREATE INDEX IF NOT EXISTS public_traffic_time_idx ON public_traffic_events(occurred_at);
CREATE TABLE IF NOT EXISTS admin_digest_settings (
 id integer PRIMARY KEY CHECK(id=1), enabled boolean NOT NULL DEFAULT false,
 recipient text NOT NULL DEFAULT '', enabled_at timestamptz
);
INSERT INTO admin_digest_settings(id) VALUES(1) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS admin_digest_runs (
 period_end timestamptz PRIMARY KEY, recipient text NOT NULL, subject text NOT NULL,
 body text NOT NULL, status text NOT NULL DEFAULT 'pending', attempts integer NOT NULL DEFAULT 0,
 claimed_until timestamptz, sent_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
