"""Isolated uploaded-file backup. Never imports or starts the FamilyTrack server."""
import datetime
import json
import os
from pathlib import Path
import subprocess
import tempfile

REPOSITORY = 's3:https://lon1.digitaloceanspaces.com/familytrack-backups-lon1/uploads'
REQUIRED = ('SOURCE_ACCESS_KEY', 'SOURCE_SECRET_KEY', 'BACKUP_ACCESS_KEY',
            'BACKUP_SECRET_KEY', 'RESTIC_PASSWORD')


class BackupError(Exception):
    pass


def command(args, env, cwd=None):
    # Tool errors can contain object names or credentials; do not forward them.
    result = subprocess.run(args, env=env, cwd=cwd, capture_output=True, timeout=3600)
    if result.returncode:
        raise BackupError(f'{args[0]} {args[1]} failed (exit {result.returncode})')
    return result.stdout


def environments(source):
    missing = [name for name in REQUIRED if not source.get(name)]
    if missing:
        raise BackupError('Missing secret settings: ' + ', '.join(missing))
    if len(source['RESTIC_PASSWORD']) < 32:
        raise BackupError('Use a randomly generated repository password of at least 32 characters')
    # Do not pass arbitrary app credentials or user rclone configuration through.
    base = {k: source[k] for k in ('PATH', 'HOME', 'TMPDIR', 'SSL_CERT_FILE') if k in source}
    reader = dict(base, RCLONE_CONFIG='/dev/null', RCLONE_CONFIG_SOURCE_TYPE='s3',
                  RCLONE_CONFIG_SOURCE_PROVIDER='DigitalOcean',
                  RCLONE_CONFIG_SOURCE_ENDPOINT='https://lon1.digitaloceanspaces.com',
                  RCLONE_CONFIG_SOURCE_REGION='lon1',
                  RCLONE_CONFIG_SOURCE_ACCESS_KEY_ID=source['SOURCE_ACCESS_KEY'],
                  RCLONE_CONFIG_SOURCE_SECRET_ACCESS_KEY=source['SOURCE_SECRET_KEY'])
    writer = dict(base, RESTIC_REPOSITORY=REPOSITORY, RESTIC_PASSWORD=source['RESTIC_PASSWORD'],
                  AWS_ACCESS_KEY_ID=source['BACKUP_ACCESS_KEY'],
                  AWS_SECRET_ACCESS_KEY=source['BACKUP_SECRET_KEY'], AWS_DEFAULT_REGION='lon1')
    return reader, writer


def run(source=None):
    source = dict(os.environ) if source is None else source
    reader, writer = environments(source)
    # Initialization is a separate, explicit one-time operation. An inaccessible
    # repository must never silently trigger creation of a replacement repository.
    if source.get('BACKUP_MODE') == 'init':
        command(['restic', 'init'], writer)
        return {'status': 'repository_initialized', 'backupCompleted': False}
    command(['restic', 'cat', 'config'], writer)
    started = datetime.datetime.now(datetime.timezone.utc).isoformat()
    os.umask(0o077)
    with tempfile.TemporaryDirectory(prefix='familytrack-backup-') as directory:
        root = Path(directory)
        uploads = root / 'uploads'
        uploads.mkdir()
        command(['rclone', 'copy', 'source:familytrack', str(uploads),
                 '--log-level', 'ERROR', '--stats', '0'], reader)
        # A failed download, changed source or missing file prevents success.
        command(['rclone', 'check', 'source:familytrack', str(uploads),
                 '--download', '--log-level', 'ERROR', '--stats', '0'], reader)
        files = list(uploads.rglob('*'))
        count = sum(p.is_file() for p in files)
        total = sum(p.stat().st_size for p in files if p.is_file())
        (root / 'manifest.json').write_text(json.dumps({
            'format': 1, 'scope': 'uploaded_files_only', 'startedAt': started,
            'files': count, 'bytes': total,
            'consistency': 'Files checked against source; not an atomic database/file snapshot',
        }), encoding='utf-8')
        raw = command(['restic', 'backup', '--json', '--host', 'familytrack-backups',
                       '--tag', 'uploads', 'uploads', 'manifest.json'], writer, cwd=directory)
        summaries = [json.loads(line) for line in raw.splitlines() if line.strip()]
        summary = next((v for v in summaries if v.get('message_type') == 'summary'), {})
        snapshot = summary.get('snapshot_id')
        if not snapshot:
            raise BackupError('Backup returned no snapshot ID')
        # Decrypt and read back this run into the disposable directory. This
        # checks recoverability, not merely that an upload request succeeded.
        restored = root / 'restore-check'
        command(['restic', 'restore', snapshot, '--target', str(restored), '--verify'], writer)
        command(['rclone', 'check', str(uploads), str(restored / 'uploads'),
                 '--download', '--log-level', 'ERROR', '--stats', '0'], reader)
        return {'status': 'success', 'scope': 'uploaded_files_only', 'snapshot': snapshot,
                'files': count, 'bytes': total, 'restoreVerified': True,
                'completedAt': datetime.datetime.now(datetime.timezone.utc).isoformat()}


if __name__ == '__main__':
    try:
        print(json.dumps(run()), flush=True)
    except Exception as error:
        detail = str(error) if isinstance(error, BackupError) else type(error).__name__
        print(json.dumps({'status': 'failed', 'detail': detail}), flush=True)
        raise SystemExit(1)
