CREATE TABLE IF NOT EXISTS admin_digest_tests (
 slot bigint PRIMARY KEY,
 created_at timestamptz NOT NULL DEFAULT now(),
 status text NOT NULL DEFAULT 'sending'
);
