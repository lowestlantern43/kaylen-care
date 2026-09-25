# FamilyTrack backup protection

## Verified 25 September 2026

- Managed PostgreSQL: kaylens-diary-prod, London, cluster e4c5932d-c82a-44fa-9e9b-547de0ca012e.
- DigitalOcean restore dialog offers latest transaction or a point within seven days. No restore was performed; latest completed backup timestamp is not yet independently verified.
- Uploaded files: familytrack bucket, lon1; console reports 5 objects, 881 KiB.
- Bucket versioning is disabled. File listing is restricted. CDN is enabled.
- Admin backup status is currently hard-coded unknown. Do not mark it working based on configuration alone.

## Proposed setup (not enabled)

1. Inspect bucket lifecycle via scripts/check-backup-storage.py using existing securely injected Spaces credentials. The script reads configuration only and prints no object keys, contents or credentials.
2. Enable versioning with a reviewed lifecycle retaining noncurrent versions for 30 days. Preserve existing lifecycle rules; never add expiration for current live objects. Confirm current Spaces lifecycle support before applying. Versioning is recovery protection, not an independent backup.
3. Add an independent encrypted repository with separate credentials. Choose its provider/location and confirm cost before provisioning. Prefer UK storage to match current location; do not copy care records to an unapproved destination.
4. Schedule nightly PostgreSQL custom-format exports using PostgreSQL 18 tools and verified TLS, plus daily uploaded-file snapshots. Store both with a common run manifest and timestamps; report any interval during which database and file captures could diverge. Retain successful snapshots for 30 days initially.
5. Encryption keys must be recoverable separately from the app and backup repository. Do not put database passwords in command arguments, logs, GitHub artifacts or source control. Backup writer credentials must not be able to destroy all retained recovery copies where the chosen service permits that separation.
6. Record start, completion, byte counts and integrity results. Success requires confirmed remote upload, not merely a successful local export. Alert on failure or no successful daily run within 26 hours. Monitor outside the main app so app downtime cannot hide backup failures.
7. Restore to an isolated database and private file destination with outbound email, notifications and Stripe jobs disabled. Validate schema, record counts and file checksums; never overwrite production for testing. Record the result and recovery duration.

## Deletion and recovery

Versioning retains deleted file bodies. Review the existing deleteSpacesObject and account-deletion paths before enabling: a normal DELETE can create a marker rather than erase older versions. Establish a restricted deletion ledger outside the restored database; reapply subsequent erasures before restored data is made available. Backups must expire under the agreed policy and never be used as an indefinite archive of deleted care information.

## Deployment boundaries

The inspection script and this plan are operational tools only: no runtime imports, migration, API changes, billing changes or iOS changes. No new backup destination, scheduled job, restore cluster, lifecycle rule or versioning setting has been created by this preparation.
