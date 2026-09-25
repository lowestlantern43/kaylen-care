# Isolated uploads backup job

Source: codex/backup-uploads, ops/backups/Dockerfile. This job never starts or imports the FamilyTrack API. It covers uploaded files only, not PostgreSQL.

## Runtime settings

SOURCE_ACCESS_KEY and SOURCE_SECRET_KEY: source bucket read-only key.
BACKUP_ACCESS_KEY and BACKUP_SECRET_KEY: destination bucket key.
RESTIC_PASSWORD: saved encryption password (minimum 32 characters). Never change it without planned key rotation; retain a recovery copy separately.
All five are encrypted runtime variables. BACKUP_MODE=backup for normal use; init is a one-time operation only.

Repository: s3:https://lon1.digitaloceanspaces.com/familytrack-backups-lon1/uploads

## Operation

Daily at 02:00 Europe/London; 30-minute platform timeout; smallest 512MB job instance. DigitalOcean Failed Job Invocation email enabled for the account owner. Failed Deployment email also enabled.

Every run downloads uploads into private ephemeral storage, checks them against source, encrypts a snapshot, restores it into a temporary directory and compares the bytes. Only then does Restic expire this host/tag's snapshots older than 30 days relative to the latest snapshot, preserving the latest copy. It prunes unreferenced data and checks repository integrity. Any failed step exits non-zero. Source files are never deleted by this job. Do not add S3 age-based expiration to Restic chunks.

Logs contain only aggregate counts, timestamp, snapshot ID and safe error categories. Source filenames and raw subprocess output are suppressed.

## Recovery

Use the saved repository password and destination credentials through environment variables on a trusted isolated machine. Use restic snapshots to select a recovery point, restic check to validate the repository, then restic restore SNAPSHOT --target PRIVATE_EMPTY_DIRECTORY --verify. Do not restore directly over production. Reconcile erased accounts/files and the database recovery point before making recovered data available. Securely remove temporary plaintext afterwards.

## Verified evidence

2026-09-25 12:27 UTC: first live backup and restore verification succeeded: 5 files / 901587 bytes. Snapshot d8d8e8bc0342f4bb4757ced94ade7beb3a951d216d12876097de0984d073fc2e.
Retention unit tests and actual synthetic Restic integration verify expiry, current-copy recovery and unrelated-snapshot protection.

## Remaining limitations

No independent missed-run/dead-man monitor: provider failure emails do not detect a scheduler that never starts a job. No database export or database restore rehearsal. Same provider/account/region as production, no immutable retention, and destination key can delete backups. File capture is not atomic with the database. If runs stop, expiry also stops. This is not complete disaster recovery. Never infer backup health solely from the configured schedule.

## Tests

python -m unittest discover -s ops/backups -p test_run.py
Run integration_check.py inside the backup image with this directory mounted read-only at /checks; it uses only synthetic data and a temporary local repository.
