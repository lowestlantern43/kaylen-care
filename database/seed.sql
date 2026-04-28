-- Local development seed data.
-- Password hashes are intentionally placeholders. Create real users through
-- the backend sign-up endpoint so bcrypt/argon2 hashing is used correctly.

BEGIN;

INSERT INTO users (id, email, password_hash, full_name)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'martin@example.test',
  'replace-with-real-password-hash-from-backend',
  'Martin'
)
ON CONFLICT DO NOTHING;

INSERT INTO families (id, name, created_by_user_id)
VALUES (
  '10000000-0000-0000-0000-000000000001',
  'Bellamy Family',
  '00000000-0000-0000-0000-000000000001'
)
ON CONFLICT DO NOTHING;

INSERT INTO family_members (family_id, user_id, role)
VALUES (
  '10000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  'owner'
)
ON CONFLICT DO NOTHING;

INSERT INTO children (id, family_id, first_name, date_of_birth, created_by_user_id)
VALUES (
  '20000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  'Kaylen',
  '2020-09-03',
  '00000000-0000-0000-0000-000000000001'
)
ON CONFLICT DO NOTHING;

INSERT INTO subscriptions (family_id, status, plan)
VALUES (
  '10000000-0000-0000-0000-000000000001',
  'active',
  'local-dev'
)
ON CONFLICT DO NOTHING;

COMMIT;
