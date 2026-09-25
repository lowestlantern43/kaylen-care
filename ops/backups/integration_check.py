"""Container-only smoke test using synthetic files and a temporary local repository."""
import os
import json
from pathlib import Path
import tempfile
from unittest.mock import patch
import run

with tempfile.TemporaryDirectory() as directory:
    root = Path(directory)
    source = root / 'source'
    source.mkdir()
    (source / 'example.txt').write_text('Synthetic backup verification only', encoding='utf-8')
    settings = {name: 'test-only-not-a-real-secret-' * 2 for name in run.REQUIRED}
    settings.update(PATH=os.environ['PATH'], HOME=os.environ['HOME'])
    real_command = run.command
    def local_command(args, env, cwd=None):
        args = [str(source) if arg == 'source:familytrack' else arg for arg in args]
        return real_command(args, env, cwd)
    with patch.object(run, 'REPOSITORY', str(root / 'repository')), patch.object(run, 'command', local_command):
        run.run(dict(settings, BACKUP_MODE='init'))
        _, writer = run.environments(settings)
        for host in ['familytrack-backups', 'unrelated-backup']:
            real_command(['restic', 'backup', '--host', host, '--tag', 'uploads',
                          '--time', '2020-01-01 00:00:00', str(source)], writer)
        result = run.run(settings)
        assert result['files'] == 1 and result['restoreVerified']
        snapshots = json.loads(real_command(['restic', 'snapshots', '--json'], writer))
        assert len(snapshots) == 2
        assert any(s['hostname'] == 'unrelated-backup' for s in snapshots)
        assert not any(s['hostname'] == 'familytrack-backups' and s['time'].startswith('2020') for s in snapshots)
        print('PASS: encryption, restore, retention expiry and unrelated snapshot protection')
