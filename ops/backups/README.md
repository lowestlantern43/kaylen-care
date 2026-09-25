# Isolated uploads backup job

This job is separate from the FamilyTrack API. It covers uploaded objects only,
not the PostgreSQL database. Production scheduling is not yet enabled.

Build context: `ops/backups`. Dockerfile: `Dockerfile` within that context.
Run as the unprivileged container user. Do not enable a public route.

Configure these **runtime secrets** on the job, never as build arguments:

| Setting | Value source |
| --- | --- |
| SOURCE_ACCESS_KEY | Saved familytrack-backup-source-readonly key ID |
| SOURCE_SECRET_KEY | Saved source key secret |
| BACKUP_ACCESS_KEY | Saved familytrack-backup-destination key ID |
| BACKUP_SECRET_KEY | Saved destination key secret |
| RESTIC_PASSWORD | New randomly generated password, at least 32 characters; keep a recovery copy in the password manager |

The repository path is fixed to the private London backup bucket, prefix uploads.
Initialize once with BACKUP_MODE=init, then remove that setting. Initialization
does not constitute a completed backup. Normal runs fail if the repository cannot
be opened; they never silently replace it. Do not regenerate the repository
password after initialization without a planned key rotation.

Before enabling a nightly schedule:

1. Confirm job compute cost and runtime secret access.
2. Run initialization, then one manual normal job. Require status=success and
   restoreVerified=true. The job reads back the encrypted snapshot and compares
   restored bytes to the staged source copy.
3. Configure failure and missed-run alerting, including no success within 26h.
4. Implement and approve 30-day Restic snapshot expiry. Do not apply a generic
   S3 age-based deletion rule to Restic data: older chunks can be shared by newer
   snapshots. This runner intentionally performs no deletion/pruning yet.
5. Record recovery instructions, secure repository password custody and how
   later account/file erasures will be applied before any production restore.

Files are staged in a private temporary container directory, then removed after
the run. Host ephemeral storage must be approved for care data; no persistent
volume or public artifact output. Source checks detect many concurrent changes,
but this is not an atomic snapshot and not a database/file consistency guarantee.
Raw subprocess logs are suppressed because filenames can identify care records.
Only aggregate counts, snapshot ID and success/failure metadata reach job logs.

Current limitations: same provider/account/region as production; destination key
can delete backups; no immutable retention; no database export; no external
monitor configured; no automatic retention yet. Do not label this complete
disaster recovery or mark the admin backup status working until live validation.

Verification:

    python -m unittest discover -s ops/backups -p 'test_*.py'
    docker build -t familytrack-backup-check ops/backups

Run integration_check.py inside that image with the ops/backups directory mounted
read-only at /checks. It uses synthetic data and a temporary local repository;
no production keys or care files are needed.
